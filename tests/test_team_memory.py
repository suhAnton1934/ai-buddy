"""Isolated Team Memory tests: no Yandex token or external service needed."""
import pytest

import db
from team_memory import find_approved_answer, init_team_memory_db
from unified_app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'ai_buddy.db')
    return create_app(ai_mode='demo').test_client()


def question(client, text='Как получить доступ к тестовому серверу?', reply=None):
    response = client.post('/mentor/questions', json={'user_id': 1, 'text': text})
    assert response.status_code == 201
    item = response.json['question']
    if reply is not None:
        result = client.post(f'/mentor/questions/{item["id"]}/reply', json={'reply': reply})
        assert result.status_code == 200
    return item['id']


def publish(client, question_id):
    return client.post('/team-memory/publish', json={'question_id': question_id})


def test_unapproved_answers_are_not_retrievable(client):
    qid = question(client, reply='Оформи заявку в учебном портале.')
    assert client.get('/team-memory/entries').json['entries'] == []
    assert find_approved_answer('Как получить доступ к тестовому серверу?') is None
    assert client.post('/chat', json={'message': 'Как получить доступ к тестовому серверу?'}).json.get('answer_origin') is None
    assert publish(client, qid).status_code == 201


def test_mentor_approval_becomes_searchable_in_demo_and_rag(client):
    qid = question(client, reply='Создай учебную заявку на доступ в разделе Backend.')
    result = publish(client, qid)
    assert result.status_code == 201
    answer = client.post('/chat', json={'message': 'Как получить доступ к тестовому серверу?'}).json
    assert answer['answer'] == 'Создай учебную заявку на доступ в разделе Backend.'
    assert find_approved_answer('Как получить доступ на тестовый сервер?') is not None
    assert answer['answer_origin'] == 'mentor_verified'
    assert answer['sources'][0]['file'].startswith('Team Memory #')
    assert answer['task_updated'] is False
    assert client.get('/users/1/tasks').status_code == 200

    class Chain:
        called = False
        def invoke(self, payload):
            self.called = True
            return {'result': 'Ответ из обычного RAG', 'source_documents': []}
    chain = Chain()
    rag = create_app(ai_mode='rag', rag_factory=lambda: chain).test_client()
    rag_response = rag.post('/chat', json={'message': 'Как получить доступ к тестовому серверу?'}).json
    assert rag_response['answer_origin'] == 'mentor_verified'
    assert chain.called is False
    rag.post('/chat', json={'message': 'Что мне изучить сегодня?'})
    assert chain.called is True


def test_must_reply_before_publishing_and_validate_id(client):
    qid = question(client)
    assert publish(client, qid).status_code == 409
    for bad in (None, '1', True, -1):
        assert client.post('/team-memory/publish', json={'question_id': bad}).status_code == 400
    assert publish(client, 999999).status_code == 404


def test_revised_mentor_answer_requires_reapproval(client):
    qid = question(client, reply='Старая инструкция.')
    assert publish(client, qid).status_code == 201
    assert len(client.get('/team-memory/entries').json['entries']) == 1
    update = client.post(f'/mentor/questions/{qid}/reply', json={'reply': 'Новая проверенная инструкция.'})
    assert update.status_code == 200
    assert client.get('/team-memory/entries').json['entries'] == []
    assert find_approved_answer('Как получить доступ к тестовому серверу?') is None
    assert publish(client, qid).status_code == 201
    assert client.get('/team-memory/entries').json['entries'][0]['answer'] == 'Новая проверенная инструкция.'


def test_revocation_prevents_future_retrieval(client):
    qid = question(client, reply='Временная инструкция.')
    eid = publish(client, qid).json['entry']['id']
    assert client.delete(f'/team-memory/entries/{eid}').status_code == 200
    assert client.get('/team-memory/entries').json['entries'] == []
    assert client.delete(f'/team-memory/entries/{eid}').status_code == 404


def test_not_an_unrelated_or_mutating_query(client):
    qid = question(client, reply='Только для учебного тестового сервера.')
    publish(client, qid)
    assert find_approved_answer('Расскажи про графы и сортировку') is None
    assert find_approved_answer('Отметь задачу доступ к тестовому серверу выполненной') is None


def test_idempotent_db_migration_preserves_tasks(client):
    response = client.patch('/tasks/1', json={'status': 'completed'})
    assert response.status_code == 200
    init_team_memory_db()
    init_team_memory_db()
    row = client.get('/users/1/tasks').json['tasks'][0]
    assert row['status'] == 'completed'
