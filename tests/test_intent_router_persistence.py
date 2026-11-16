"""Verify a mock corporate action actually persists and is not merely reported successful."""
from contextlib import closing
import db
from intent_router import detect_intent, execute_corporate_action


def test_corporate_request_is_saved(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'requests.db')
    db.init_db()
    assert detect_intent('Помоги оформить отгул на пятницу') == 'ACTION_CORPORATE'
    response = execute_corporate_action('Помоги оформить отгул на пятницу', mode='demo')
    assert response['proposed_action']['ticket_id'] is not None
    assert 'демонстрационная' in response['answer']
    with closing(db.get_connection()) as connection:
        row = connection.execute('SELECT text FROM mentor_questions WHERE id=?',
                                 (response['proposed_action']['ticket_id'],)).fetchone()
    assert row is not None and 'отгул' in row['text']


def test_failure_does_not_report_success(monkeypatch):
    def broken_connection():
        raise OSError('db offline')
    monkeypatch.setattr('intent_router.get_connection', broken_connection)
    response = execute_corporate_action('Хочу оформить отгул')
    assert response['proposed_action'] is None
    assert 'Не удалось' in response['answer']
