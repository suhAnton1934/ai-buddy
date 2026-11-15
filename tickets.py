"""Demo ticket lifecycle, kept separate from mentor_questions' status CHECK.

Closed questions remain intact: replies, AI explanations, and Team Memory links
continue to reference the original mentor_questions row. No production auth.
"""
from contextlib import closing
from flask import Blueprint, jsonify, request

from config import DEMO_USER_ID
from db import get_connection


tickets_bp = Blueprint('tickets', __name__)


def init_ticket_db():
    """Idempotent additive migration; never changes old question rows."""
    with closing(get_connection()) as connection, connection:
        connection.execute('''
            CREATE TABLE IF NOT EXISTS mentor_ticket_closures (
                question_id INTEGER PRIMARY KEY,
                closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')


def _demo_user(value):
    return type(value) is int and value == DEMO_USER_ID


@tickets_bp.get('/mentor/tickets')
def get_ticket_states():
    user_id = request.args.get('user_id', type=int)
    if not _demo_user(user_id):
        return jsonify({'error': 'Доступен только тестовый стажёр №1'}), 403
    with closing(get_connection()) as connection:
        rows = connection.execute('''
            SELECT m.question_id, m.closed_at
            FROM mentor_ticket_closures AS m
            JOIN mentor_questions AS q ON q.id = m.question_id
            WHERE q.user_id = ? ORDER BY m.question_id DESC
        ''', (DEMO_USER_ID,)).fetchall()
    return jsonify({'closed': [dict(row) for row in rows]})


def _change_ticket(question_id, close):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'Ожидается JSON-объект'}), 400
    if not _demo_user(payload.get('user_id')):
        return jsonify({'error': 'Доступен только тестовый стажёр №1'}), 403
    with closing(get_connection()) as connection, connection:
        row = connection.execute('''
            SELECT id FROM mentor_questions WHERE id = ? AND user_id = ?
        ''', (question_id, DEMO_USER_ID)).fetchone()
        if row is None:
            return jsonify({'error': 'Обращение не найдено'}), 404
        if close:
            connection.execute('''
                INSERT OR IGNORE INTO mentor_ticket_closures (question_id)
                VALUES (?)
            ''', (question_id,))
        else:
            connection.execute('''
                DELETE FROM mentor_ticket_closures WHERE question_id = ?
            ''', (question_id,))
        result = connection.execute('''
            SELECT closed_at FROM mentor_ticket_closures WHERE question_id = ?
        ''', (question_id,)).fetchone()
    return jsonify({
        'question_id': question_id,
        'closed': result is not None,
        'closed_at': result['closed_at'] if result is not None else None,
    })


@tickets_bp.post('/mentor/tickets/<int:question_id>/close')
def close_ticket(question_id):
    return _change_ticket(question_id, True)


@tickets_bp.post('/mentor/tickets/<int:question_id>/reopen')
def reopen_ticket(question_id):
    return _change_ticket(question_id, False)
