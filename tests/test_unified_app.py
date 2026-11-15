"""Интеграционные проверки единого сервера, без реального Yandex API."""

import pytest

import db
from unified_app import create_app


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'ai_buddy.db')


class DummyDocument:
    metadata = {'source': 'knowledge/ssh_guide.txt'}
    page_content = 'Тестовая инструкция'


class DummyChain:
    def __init__(self):
        self.last_query = None

    def invoke(self, payload):
        self.last_query = payload['query']
        return {'result': 'Начни с настройки Git.', 'source_documents': [DummyDocument()]}


def test_demo_mode_keeps_tasks_and_mentor():
    client = create_app(ai_mode='demo').test_client()
    assert client.get('/').status_code == 200
    assert client.get('/health').json['mode'] == 'demo'
    response = client.post('/mentor/tasks', json={
        'user_id': 1, 'title': 'Изучить API', 'description': 'Проверить маршруты',
        'due_date': '2027-01-10',
    })
    assert response.status_code == 201
    tasks = client.get('/users/1/tasks').json['tasks']
    assert any(t['title'] == 'Изучить API' for t in tasks)
    chat = client.post('/chat', json={'message': 'Какие у меня задачи?'})
    assert chat.status_code == 200
    assert chat.json['mode'] == 'demo'


def test_rag_receives_profile_and_tasks_and_returns_sources():
    chain = DummyChain()
    client = create_app(ai_mode='rag', rag_factory=lambda: chain).test_client()
    assert client.get('/health').json['rag_ready'] is True
    response = client.post('/chat', json={
        'message': 'Что мне изучить?',
        'user_context': {'role': 'Backend', 'team': 'Платформа', 'stage': 'Неделя 1'},
    })
    assert response.status_code == 200
    assert response.json['mode'] == 'rag'
    assert response.json['sources'] == [{'file': 'ssh_guide.txt'}]
    assert 'Команда: Платформа' in chain.last_query
    assert 'Настроить Git' in chain.last_query


def test_rag_proposes_but_does_not_mutate_task():
    client = create_app(ai_mode='rag', rag_factory=DummyChain).test_client()
    response = client.post('/chat', json={'message': 'Отметь задачу «Настроить Git» выполненной'})
    assert response.status_code == 200
    action = response.json['proposed_action']
    assert action['type'] == 'complete_task'
    assert action['task_id'] == 1
    assert client.get('/users/1/tasks').json['tasks'][0]['status'] == 'pending'
    # Изменение данных происходит только после отдельного подтверждения.
    updated = client.patch('/tasks/1', json={'status': 'completed'})
    assert updated.status_code == 200
    assert updated.json['task']['status'] == 'completed'


def test_rag_does_not_propose_ambiguous_or_unsolicited_actions():
    client = create_app(ai_mode='rag', rag_factory=DummyChain).test_client()
    for message in ['Как настроить Git?', 'Отметь задачу выполненной', 'Я хочу удалить всё']:
        response = client.post('/chat', json={'message': message})
        assert response.status_code == 200
        assert response.json['proposed_action'] is None


def test_rag_input_validation():
    client = create_app(ai_mode='rag', rag_factory=DummyChain).test_client()
    for payload in [None, {}, {'message': ''}, {'message': []},
                    {'message': 'hi', 'user_context': 'not object'},
                    {'message': 'x' * 2001}]:
        response = client.post('/chat', json=payload)
        assert response.status_code == 400


def test_rag_startup_failure_falls_back_without_crashing():
    def broken_chain():
        raise RuntimeError('No API key')
    client = create_app(ai_mode='rag', rag_factory=broken_chain).test_client()
    status = client.get('/health').json
    assert status['mode'] == 'demo'
    assert status['status'] == 'degraded'
    assert status['requested_mode'] == 'rag'
    assert client.post('/chat', json={'message': 'Какие у меня задачи?'}).status_code == 200
    assert client.get('/mentor/tasks?user_id=1').status_code == 200


def test_rag_service_failure_does_not_break_backend():
    class FaultyChain:
        def invoke(self, payload):
            raise TimeoutError('API failure')
    client = create_app(ai_mode='rag', rag_factory=FaultyChain).test_client()
    assert client.post('/chat', json={'message': 'Помоги'}).status_code == 503
    assert client.get('/users/1/tasks').status_code == 200
    assert client.get('/health').json['status'] == 'ok'
