"""Opt-in synchronisation of *approved* demo documentation into RAG's txt loader.

Default source is local synthetic docs. A real HTTPS JSON source can be configured
by the service owner; no user supplied URLs. Only manages knowledge/synced/.
No embedding requests happen in demo mode. In RAG mode it rebuilds a NEW FAISS
chain then swaps it in, keeping the existing chain if reindexing fails.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import urllib.parse
import urllib.request
from contextlib import closing
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from db import get_connection

SOURCE_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,50}$')
MAX_DOCS = 40
MAX_DOCUMENT_SIZE = 20_000
MAX_PAYLOAD_BYTES = 400_000


def _source_documents(root):
    url = os.getenv('CORP_DOCS_JSON_URL', '').strip()
    if url:
        parsed = urllib.parse.urlparse(url)
        allowed = os.getenv('CORP_DOCS_ALLOWED_HOST', '').strip().lower()
        if parsed.scheme != 'https' or not allowed or parsed.hostname != allowed or parsed.username or parsed.password:
            raise ValueError('Разрешён только HTTPS API с CORP_DOCS_ALLOWED_HOST')
        headers = {'Accept': 'application/json'}
        token = os.getenv('CORP_DOCS_API_TOKEN', '').strip()
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as response:
            raw = response.read(MAX_PAYLOAD_BYTES + 1)
        if len(raw) > MAX_PAYLOAD_BYTES:
            raise ValueError('Ответ корпоративного API слишком большой')
        data = json.loads(raw.decode('utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('documents'), list):
            raise ValueError('API должен возвращать {"documents": [...]}')
        return data['documents'], 'https-api'
    directory = root / 'mock_corporate_docs'
    if not directory.is_dir():
        raise ValueError('Нет каталога mock_corporate_docs')
    files = sorted(directory.glob('*.txt'))
    if len(files) > MAX_DOCS:
        raise ValueError('Слишком много документов')
    docs = []
    for file in files:
        if file.is_symlink() or not file.is_file():
            raise ValueError('Символические ссылки в mock_corporate_docs запрещены')
        docs.append({'id': file.stem, 'title': file.stem.replace('_', ' '),
                     'content': file.read_text(encoding='utf-8')})
    return docs, 'mock'


def _validate_documents(docs):
    if len(docs) > MAX_DOCS:
        raise ValueError('Слишком много документов')
    prepared = {}
    for item in docs:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str):
            raise ValueError('Документ должен содержать id')
        source_id = item['id']
        title = item.get('title', source_id)
        content = item.get('content')
        if (not SOURCE_ID_RE.fullmatch(source_id) or source_id in prepared or
            not isinstance(title, str) or len(title) > 160 or
            not isinstance(content, str) or not 1 <= len(content) <= MAX_DOCUMENT_SIZE):
            raise ValueError('Некорректный документ или повторяющийся id')
        content_to_index = f'Документ: {title}\n\n{content.strip()}\n'
        digest = hashlib.sha256(content_to_index.encode('utf-8')).hexdigest()
        prepared[source_id] = {'source_id': source_id, 'title': title,
                               'content': content_to_index, 'digest': digest}
    return prepared


def init_sync_db():
    with closing(get_connection()) as c, c:
        c.execute('''CREATE TABLE IF NOT EXISTS synced_documents (
            source_id TEXT PRIMARY KEY, title TEXT NOT NULL, sha256 TEXT NOT NULL,
            synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS sync_state (
            id INTEGER PRIMARY KEY CHECK(id=1),
            last_sync TEXT, source_mode TEXT, last_error TEXT,
            index_ready INTEGER NOT NULL DEFAULT 0
        )''')
        c.execute('INSERT OR IGNORE INTO sync_state(id) VALUES(1)')


class DocumentSync:
    def __init__(self, root, rebuild_callback=None):
        self.root = Path(root)
        self.rebuild = rebuild_callback
        self.lock = threading.RLock()
        self.last_error = None

    def status(self):
        with closing(get_connection()) as c:
            state = c.execute('SELECT * FROM sync_state WHERE id=1').fetchone()
            docs = c.execute('SELECT source_id,title,sha256,synced_at FROM synced_documents ORDER BY source_id').fetchall()
        return {'count': len(docs), 'documents': [dict(x) for x in docs],
                'last_sync': state['last_sync'], 'source_mode': state['source_mode'] or 'mock',
                'index_ready': bool(state['index_ready']) if self.rebuild else False,
                'last_error': self.last_error or state['last_error'],
                'rag_enabled': self.rebuild is not None}

    def run(self):
        with self.lock:
            docs_raw, mode = _source_documents(self.root)
            prepared = _validate_documents(docs_raw)
            target_dir = self.root / 'knowledge' / 'synced'
            target_dir.mkdir(parents=True, exist_ok=True)
            with closing(get_connection()) as c:
                old = {r['source_id']: r['sha256'] for r in
                       c.execute('SELECT source_id, sha256 FROM synced_documents').fetchall()}
                old_index_ready = bool(c.execute('SELECT index_ready FROM sync_state WHERE id=1').fetchone()['index_ready'])
            def file_matches(key):
                path = target_dir / (key + '.txt')
                return (path.is_file() and not path.is_symlink()
                        and hashlib.sha256(path.read_bytes()).hexdigest() == prepared[key]['digest'])
            changed = {key for key in prepared if
                       key not in old or old[key] != prepared[key]['digest'] or not file_matches(key)}
            deleted = set(old) - set(prepared)
            # Only documents created by this synchronizer live in this directory.
            for key in changed:
                tmp = target_dir / (key + '.txt.tmp')
                tmp.write_text(prepared[key]['content'], encoding='utf-8')
                os.replace(tmp, target_dir / (key + '.txt'))
            for key in deleted:
                (target_dir / (key + '.txt')).unlink(missing_ok=True)
            with closing(get_connection()) as c, c:
                for key, item in prepared.items():
                    c.execute('''INSERT INTO synced_documents(source_id,title,sha256)
                                 VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET
                                   title=excluded.title, sha256=excluded.sha256,
                                   synced_at=CURRENT_TIMESTAMP''',
                              (key, item['title'], item['digest']))
                for key in deleted:
                    c.execute('DELETE FROM synced_documents WHERE source_id=?', (key,))
                c.execute('''UPDATE sync_state SET last_sync=CURRENT_TIMESTAMP,
                             source_mode=?, index_ready=CASE WHEN ? THEN 0 ELSE index_ready END,
                             last_error=NULL WHERE id=1''',
                          (mode, int(bool(changed or deleted))))
            # Only swap to the new RAG chain if it built successfully.
            index_ready = old_index_ready if self.rebuild is not None else False
            if self.rebuild is not None and (changed or deleted or not old_index_ready):
                try:
                    self.rebuild()
                    index_ready = True
                except Exception as exc:
                    index_ready = False
                    self.last_error = 'Ошибка обновления RAG-индекса: ' + type(exc).__name__
                    with closing(get_connection()) as c, c:
                        c.execute('UPDATE sync_state SET last_error=?, index_ready=0 WHERE id=1',
                                  (self.last_error,))
            if index_ready:
                self.last_error = None
                with closing(get_connection()) as c, c:
                    c.execute('UPDATE sync_state SET last_error=NULL, index_ready=1 WHERE id=1')
            return {'updated': sorted(changed), 'removed': sorted(deleted),
                    'index_ready': index_ready, **self.status()}


def register_knowledge_sync(app, root, rebuild_callback=None):
    init_sync_db()
    manager = DocumentSync(root, rebuild_callback)
    bp = Blueprint('knowledge_sync', __name__)

    @bp.get('/knowledge-sync/status')
    def get_status():
        return jsonify(manager.status())

    @bp.post('/knowledge-sync/run')
    def run_sync():
        try:
            result = manager.run()
            return jsonify(result)
        except (ValueError, OSError, json.JSONDecodeError, UnicodeError) as exc:
            # Never leak API credentials or remote URLs in response text.
            app.logger.warning('Documentation sync failed: %s', type(exc).__name__)
            return jsonify({'error': 'Синхронизация не выполнена: проверь источник документов.'}), 503

    app.register_blueprint(bp)
    app.extensions['ai_buddy_doc_sync'] = manager

    # Explicit opt-in: don't create daemon threads during tests or normal demo startup.
    if os.getenv('DOC_SYNC_AUTO') == '1':
        def worker():
            interval = max(60, int(os.getenv('DOC_SYNC_INTERVAL_SECONDS', '300')))
            stop = threading.Event()
            while True:
                try:
                    manager.run()  # First pass immediately after startup.
                except Exception:
                    app.logger.exception('Background documentation sync failed')
                if stop.wait(interval):
                    break
        thread = threading.Thread(target=worker, daemon=True, name='ai-buddy-doc-sync')
        thread.start()
    return manager
