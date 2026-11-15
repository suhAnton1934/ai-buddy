"""Team Intelligence regression tests: no cloud requests, no writes to real repo."""
import json

import pytest

import db
import mentor_intelligence as coach
from knowledge_sync import DocumentSync, init_sync_db
from unified_app import create_app


class Chain:
    def invoke(self, _):
        return {'result': 'Учебный RAG', 'source_documents': []}


@pytest.fixture
def rag_client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'unit.db')
    monkeypatch.setattr(coach, '_model_text', lambda _: json.dumps({
        'summary': 'Наставник просит создать отдельную ветку и открыть PR.',
        'steps': ['Создать отдельную ветку', 'Открыть Pull Request'],
        'clarifications': ['В каком репозитории?']}, ensure_ascii=False))
    return create_app(ai_mode='rag', rag_factory=lambda: Chain()).test_client()


def _question(client):
    response = client.post('/mentor/questions', json={'user_id': 1, 'text': 'Как отправить изменения?'})
    assert response.status_code == 201
    qid = response.json['question']['id']
    response = client.post(f'/mentor/questions/{qid}/reply', json={
        'reply': 'Создай отдельную ветку, внеси изменения и открой Pull Request.'})
    assert response.status_code == 200
    return qid


def test_explanation_and_followup_keep_mentor_context(rag_client, monkeypatch):
    qid = _question(rag_client)
    seen = []
    def fake(prompt):
        seen.append(prompt)
        return json.dumps({'summary': 'Пошаговая помощь', 'steps': ['Создать ветку'],
                           'clarifications': []})
    monkeypatch.setattr(coach, '_model_text', fake)
    first = rag_client.post('/mentor-ai/analyze', json={'question_id': qid})
    assert first.status_code == 200
    assert first.json['steps'] == ['Создать ветку']
    second = rag_client.post('/mentor-ai/analyze', json={
        'question_id': qid, 'followup': 'А что такое Pull Request?'})
    assert second.status_code == 200
    assert 'Создай отдельную ветку' in seen[-1]
    assert 'А что такое Pull Request?' in seen[-1]
    assert 'Пошаговая помощь' in seen[-1]


def test_no_auto_task_creation_and_mentor_approves(rag_client):
    qid = _question(rag_client)
    before = len(rag_client.get('/users/1/tasks').json['tasks'])
    assert rag_client.post('/mentor-ai/analyze', json={'question_id': qid}).status_code == 200
    assert len(rag_client.get('/users/1/tasks').json['tasks']) == before
    result = rag_client.post('/mentor-ai/proposals', json={'question_id': qid})
    assert result.status_code == 201
    assert len(rag_client.get('/users/1/tasks').json['tasks']) == before
    pid = result.json['proposal_id']
    assert rag_client.get('/mentor-ai/proposals?user_id=1').json['proposals'][0]['id'] == pid
    approved = rag_client.post(f'/mentor-ai/proposals/{pid}/approve')
    assert approved.status_code == 200
    rows = rag_client.get('/users/1/tasks').json['tasks']
    assert len(rows) == before + 2
    assert rag_client.post(f'/mentor-ai/proposals/{pid}/approve').status_code == 409
    assert len(rag_client.get('/users/1/tasks').json['tasks']) == before + 2


def test_edit_reply_invalidates_ai_context_and_plan(rag_client):
    qid = _question(rag_client)
    rag_client.post('/mentor-ai/analyze', json={'question_id': qid})
    pid = rag_client.post('/mentor-ai/proposals', json={'question_id': qid}).json['proposal_id']
    assert rag_client.post(f'/mentor/questions/{qid}/reply', json={'reply': 'Другая процедура.'}).status_code == 200
    assert rag_client.get('/mentor-ai/proposals?user_id=1').json['proposals'] == []
    assert rag_client.post(f'/mentor-ai/proposals/{pid}/approve').status_code == 409
    assert rag_client.post('/mentor-ai/proposals', json={'question_id': qid}).status_code == 409


def test_demo_rejects_ai_analysis_but_old_endpoints_work(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'demo.db')
    c = create_app(ai_mode='demo').test_client()
    qid = _question(c)
    assert c.post('/mentor-ai/analyze', json={'question_id': qid}).status_code == 503
    assert c.get('/users/1/tasks').status_code == 200
    assert c.post('/chat', json={'message': 'Какие у меня задачи?'}).status_code == 200


def test_sync_only_changed_docs_and_keep_handwritten_docs(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'docs.db')
    init_sync_db()
    source = tmp_path / 'mock_corporate_docs'
    source.mkdir()
    (source / 'backend.txt').write_text('Сначала настрой Git.', encoding='utf-8')
    manual = tmp_path / 'knowledge' / 'handwritten.txt'
    manual.parent.mkdir()
    manual.write_text('Ручная инструкция', encoding='utf-8')
    rebuilt = []
    sync = DocumentSync(tmp_path, rebuild_callback=lambda: rebuilt.append('ok'))
    first = sync.run()
    assert first['updated'] == ['backend']
    assert first['index_ready']
    second = sync.run()
    assert second['updated'] == []
    assert rebuilt == ['ok']  # no costly repeated embeddings
    (source / 'backend.txt').write_text('Теперь настрой SSH.', encoding='utf-8')
    third = sync.run()
    assert third['updated'] == ['backend']
    assert 'SSH' in (tmp_path / 'knowledge' / 'synced' / 'backend.txt').read_text()
    (source / 'backend.txt').unlink()
    fourth = sync.run()
    assert fourth['removed'] == ['backend']
    assert manual.read_text() == 'Ручная инструкция'


def test_sync_rebuild_failure_keeps_previous_retriever(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'docs.db')
    init_sync_db()
    folder = tmp_path / 'mock_corporate_docs'
    folder.mkdir()
    (folder / 'demo.txt').write_text('Учебный документ.', encoding='utf-8')
    sync = DocumentSync(tmp_path, rebuild_callback=lambda: (_ for _ in ()).throw(RuntimeError('fake AI error')))
    result = sync.run()
    assert not result['index_ready']
    assert 'Ошибка обновления RAG-индекса' in result['last_error']
    assert (tmp_path / 'knowledge' / 'synced' / 'demo.txt').exists()


def test_sync_rejects_unsafe_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'docs.db')
    init_sync_db()
    source = tmp_path / 'mock_corporate_docs'
    source.mkdir()
    (source / '..evil.txt').write_text('Bad data', encoding='utf-8')
    sync = DocumentSync(tmp_path)
    with pytest.raises(ValueError):
        sync.run()
