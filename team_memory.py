"""Team Memory: mentor-approved answers for the single-user AI-buddy demo.

This is retrieval from verified SQLite Q&A, NOT fine-tuning. Only approved,
unchanged replies can be returned to a trainee. Production needs real auth,
team-level access controls, audit, and content moderation.
"""

import re
from contextlib import closing

from flask import Blueprint, jsonify, request

from config import DEMO_USER_ID
from db import get_connection

team_memory_bp = Blueprint('team_memory', __name__)

# These common words contribute little to similarity in Russian questions.
_STOP = {
    'как', 'где', 'что', 'это', 'мне', 'нам', 'можно', 'нужно', 'надо', 'чтобы',
    'для', 'при', 'или', 'про', 'его', 'моя', 'мой', 'мою', 'наша', 'нашей', 'какой',
    'какие', 'какая', 'кому', 'куда', 'кто', 'пожалуйста', 'подскажи', 'помоги',
    'бы', 'же', 'ли', 'еще', 'ещё', 'свой', 'свои', 'есть', 'будет', 'сейчас',
    'the', 'how', 'can', 'where', 'what', 'please', 'for', 'and', 'with', 'you',
}
_ACTION_COMMAND = re.compile(
    r'(?<![\w])(?:отметь|заверши|выполни|удали|назначь|измени|обнови|отправь|закрой|добавь)(?![\w])',
    re.IGNORECASE,
)


def init_team_memory_db():
    """Idempotent additive migration; does not touch the tasks table."""
    with closing(get_connection()) as connection, connection:
        connection.execute('''
            CREATE TABLE IF NOT EXISTS knowledge_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id INTEGER NOT NULL UNIQUE,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Every change to the mentor reply invalidates previous approval,
        # even if the text is later changed back to the same words.
        connection.execute('''
            CREATE TRIGGER IF NOT EXISTS tm_revoke_on_reply_edit
            AFTER UPDATE OF reply ON mentor_questions
            WHEN OLD.reply IS NOT NEW.reply
            BEGIN
                DELETE FROM knowledge_entries WHERE question_id = NEW.id;
            END
        ''')


def _approved_query():
    # A mentor editing an answer automatically invalidates its old approval.
    return '''
        SELECT k.id, k.question_id, k.question, k.answer, k.approved_at
        FROM knowledge_entries AS k
        INNER JOIN mentor_questions AS q
          ON q.id = k.question_id AND q.user_id = ?
        WHERE q.status = 'answered' AND q.reply = k.answer
          AND q.text = k.question
          AND TRIM(k.answer) != ''
    '''


def list_approved():
    with closing(get_connection()) as connection:
        rows = connection.execute(
            _approved_query() + ' ORDER BY k.id DESC LIMIT 100',
            (DEMO_USER_ID,),
        ).fetchall()
    return [dict(row) for row in rows]


def _tokens(text):
    words = re.findall(r'[^\W_]+', text.casefold().replace('ё', 'е'), flags=re.UNICODE)
    # Very light suffix tolerance: тестовому/тестовый, серверу/сервер.
    # Conservative threshold below still prevents one-word accidental matches.
    return {w[:5] if len(w) >= 6 else w for w in words
            if len(w) >= 3 and w not in _STOP}


def find_approved_answer(message):
    """Conservative deterministic retrieval without an embedding API key.

    We prefer a missed match over a wrong/sensitive answer. No LLM is called.
    """
    if not isinstance(message, str) or not 5 <= len(message.strip()) <= 2000:
        return None
    normalized = message.casefold().replace('ё', 'е')
    if _ACTION_COMMAND.search(normalized):
        return None
    tokens = _tokens(message)
    if not tokens:
        return None
    best = None
    best_score = 0.0
    for entry in list_approved():
        question_tokens = _tokens(entry['question'])
        if not question_tokens:
            continue
        common = len(question_tokens & tokens)
        equal_question = normalized.strip(' ?.!,') == entry['question'].casefold().replace('ё', 'е').strip(' ?.!,')
        # Two distinct meaningful terms, substantial overlap, or exact wording.
        if not equal_question and (common < 2 or common / max(len(tokens), len(question_tokens)) < 0.6):
            continue
        score = 1.0 if equal_question else common / max(len(tokens), len(question_tokens))
        if score > best_score:
            best, best_score = entry, score
    return best


def chat_answer(entry, mode):
    """Return the mentor's exact approved answer, visibly attributed.

    This is NOT synthesized by the language model; intentionally deterministic.
    """
    return {
        'answer': entry['answer'],
        'sources': [{'file': f'Team Memory #{entry["id"]} · проверено наставником'}],
        'mode': mode,
        'answer_origin': 'mentor_verified',
        'task_updated': False,
        'proposed_action': None,
    }


@team_memory_bp.get('/team-memory/entries')
def get_entries():
    return jsonify({'entries': list_approved()})


@team_memory_bp.post('/team-memory/publish')
def publish_answer():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'Ожидается JSON-объект'}), 400
    question_id = payload.get('question_id')
    if type(question_id) is not int or question_id <= 0:
        return jsonify({'error': 'Некорректный ID обращения'}), 400
    with closing(get_connection()) as connection, connection:
        question = connection.execute(
            '''SELECT id, text, reply, status FROM mentor_questions
               WHERE id = ? AND user_id = ?''',
            (question_id, DEMO_USER_ID),
        ).fetchone()
        if question is None:
            return jsonify({'error': 'Обращение не найдено'}), 404
        if question['status'] != 'answered' or not isinstance(question['reply'], str) or not question['reply'].strip():
            return jsonify({'error': 'Сначала наставник должен ответить на обращение'}), 409
        # Limit content lengths; both are also validated by the original mentor API.
        if len(question['text']) > 2000 or len(question['reply']) > 2000:
            return jsonify({'error': 'Слишком длинный вопрос или ответ'}), 400
        connection.execute(
            '''INSERT INTO knowledge_entries (question_id, question, answer)
               VALUES (?, ?, ?)
               ON CONFLICT(question_id) DO UPDATE SET
                   question = excluded.question,
                   answer = excluded.answer,
                   approved_at = CURRENT_TIMESTAMP''',
            (question_id, question['text'], question['reply']),
        )
        entry = connection.execute(
            '''SELECT id, question_id, question, answer, approved_at
               FROM knowledge_entries WHERE question_id = ?''',
            (question_id,),
        ).fetchone()
    return jsonify({'entry': dict(entry)}), 201


@team_memory_bp.delete('/team-memory/entries/<int:entry_id>')
def revoke_answer(entry_id):
    with closing(get_connection()) as connection, connection:
        row = connection.execute(
            '''SELECT k.id FROM knowledge_entries AS k
               JOIN mentor_questions AS q ON q.id = k.question_id
               WHERE k.id = ? AND q.user_id = ?''',
            (entry_id, DEMO_USER_ID),
        ).fetchone()
        if row is None:
            return jsonify({'error': 'Знание не найдено'}), 404
        connection.execute('DELETE FROM knowledge_entries WHERE id = ?', (entry_id,))
    return jsonify({'ok': True})
