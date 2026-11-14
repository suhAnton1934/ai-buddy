import pytest
import db

from flask import Flask
from demo_chat import demo_chat_bp


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Отдельная временная база для каждого теста
    monkeypatch.setattr(
        db,
        "DB_PATH",
        tmp_path / "test_chat.db"
    )

    db.init_db()

    app = Flask(__name__)
    app.register_blueprint(demo_chat_bp)
    app.config["TESTING"] = True

    return app.test_client()


def test_get_pending_tasks(client):
    response = client.post(
        "/chat",
        json={"message": "Какие у меня задачи?"}
    )

    assert response.status_code == 200

    data = response.get_json()

    assert "Настроить Git" in data["answer"]
    assert "Изучить документацию" in data["answer"]
    assert data["mode"] == "demo"


def test_git_help(client):
    response = client.post(
        "/chat",
        json={"message": "Как настроить Git?"}
    )

    assert response.status_code == 200

    data = response.get_json()

    assert "knowledge/ssh_guide.txt" in data["answer"]
    assert data["task_updated"] is False


def test_complete_git_task(client):
    response = client.post(
        "/chat",
        json={
            "message": "Отметь настройку Git выполненной"
        }
    )

    assert response.status_code == 200

    data = response.get_json()

    assert data["task_updated"] is True

    # Проверяем реальное изменение в базе
    connection = db.get_connection()

    try:
        task = connection.execute(
            "SELECT status FROM tasks WHERE id = 1"
        ).fetchone()

        assert task["status"] == "completed"

    finally:
        connection.close()


def test_git_already_completed(client):
    # Сначала выполняем задачу
    client.post(
        "/chat",
        json={
            "message": "Отметь настройку Git выполненной"
        }
    )

    # Пробуем выполнить повторно
    response = client.post(
        "/chat",
        json={
            "message": "Отметь настройку Git выполненной"
        }
    )

    data = response.get_json()

    assert data["task_updated"] is False
    assert "уже отмечена" in data["answer"]


def test_empty_message(client):
    response = client.post(
        "/chat",
        json={"message": ""}
    )

    assert response.status_code == 400


def test_invalid_json(client):
    response = client.post(
        "/chat",
        data="not-json",
        content_type="application/json"
    )

    assert response.status_code == 400


def test_unknown_question(client):
    response = client.post(
        "/chat",
        json={"message": "Какая сегодня погода?"}
    )

    assert response.status_code == 200

    data = response.get_json()

    assert data["mode"] == "demo"
    assert data["task_updated"] is False
