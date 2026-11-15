"""Safe lifecycle tests: archive is separate from question and knowledge rows."""
import pytest
from flask import Flask

import db
from routes.mentor import mentor_bp
from tickets import tickets_bp, init_ticket_db


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'tickets.db')
    db.init_db()
    init_ticket_db()
    app = Flask(__name__)
    app.register_blueprint(mentor_bp)
    app.register_blueprint(tickets_bp)
    app.config['TESTING'] = True
    return app.test_client()


def _question(client, reply=None):
    result = client.post('/mentor/questions', json={'user_id': 1, 'text': 'Как настроить окружение?'})
    assert result.status_code == 201
    question_id = result.json['question']['id']
    if reply:
        response = client.post(f'/mentor/questions/{question_id}/reply', json={'reply': reply})
        assert response.status_code == 200
    return question_id


def test_can_close_and_reopen_answered_ticket_without_losing_reply(client):
    qid = _question(client, 'Запусти проект локально и проверь Git.')
    response = client.post(f'/mentor/tickets/{qid}/close', json={'user_id': 1})
    assert response.status_code == 200
    assert response.json['closed'] is True
    closed = client.get('/mentor/tickets?user_id=1').json['closed']
    assert closed[0]['question_id'] == qid
    questions = client.get('/mentor/questions?user_id=1').json['questions']
    assert questions[0]['reply'] == 'Запусти проект локально и проверь Git.'
    assert questions[0]['status'] == 'answered'
    assert client.post(f'/mentor/tickets/{qid}/reopen', json={'user_id': 1}).json['closed'] is False
    assert client.get('/mentor/tickets?user_id=1').json['closed'] == []


def test_can_close_duplicate_unanswered_ticket(client):
    qid = _question(client)
    assert client.post(f'/mentor/tickets/{qid}/close', json={'user_id': 1}).status_code == 200
    row = client.get('/mentor/questions?user_id=1').json['questions'][0]
    assert row['status'] == 'open'
    assert row['reply'] is None


def test_idempotent_close_and_migration(client):
    qid = _question(client)
    init_ticket_db()
    assert client.post(f'/mentor/tickets/{qid}/close', json={'user_id': 1}).status_code == 200
    assert client.post(f'/mentor/tickets/{qid}/close', json={'user_id': 1}).status_code == 200
    assert len(client.get('/mentor/tickets?user_id=1').json['closed']) == 1
    assert client.post(f'/mentor/tickets/{qid}/reopen', json={'user_id': 1}).status_code == 200
    assert client.post(f'/mentor/tickets/{qid}/reopen', json={'user_id': 1}).status_code == 200


def test_rejects_other_users_and_missing_ticket(client):
    qid = _question(client)
    assert client.get('/mentor/tickets?user_id=2').status_code == 403
    assert client.post(f'/mentor/tickets/{qid}/close', json={'user_id': 2}).status_code == 403
    assert client.post(f'/mentor/tickets/{qid}/close', json={}).status_code == 403
    assert client.post('/mentor/tickets/999999/close', json={'user_id': 1}).status_code == 404


def test_old_questions_survive_migration(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'old.db')
    db.init_db()
    with db.get_connection() as con:
        con.execute('INSERT INTO mentor_questions(user_id, text, reply, status) VALUES (1, ?, ?, ?)',
                    ('Старый вопрос', 'Старый ответ', 'answered'))
    init_ticket_db()
    init_ticket_db()
    with db.get_connection() as con:
        row = con.execute("SELECT text, reply, status FROM mentor_questions WHERE text='Старый вопрос'").fetchone()
    assert dict(row) == {'text': 'Старый вопрос', 'reply': 'Старый ответ', 'status': 'answered'}
