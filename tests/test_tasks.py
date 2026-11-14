import pytest
import db

from flask import Flask
from routes.tasks import tasks_bp


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()

    app = Flask(__name__)
    app.register_blueprint(tasks_bp)
    app.config["TESTING"] = True

    return app.test_client()


def test_get_tasks(client):
    response = client.get("/users/1/tasks")

    assert response.status_code == 200
    assert len(response.json["tasks"]) == 2


def test_access_denied_for_other_user(client):
    response = client.get("/users/999/tasks")

    assert response.status_code == 403
    assert response.get_json()["error"] == "Доступ запрещён"


def test_update_task(client):
    response = client.patch(
        "/tasks/1",
        json={"status": "completed"}
    )

    assert response.status_code == 200
    assert response.json["task"]["status"] == "completed"

    response = client.get("/users/1/tasks")

    assert response.json["tasks"][0]["status"] == "completed"


def test_invalid_status(client):
    response = client.patch(
        "/tasks/1",
        json={"status": "unknown"}
    )

    assert response.status_code == 400


def test_task_not_found(client):
    response = client.patch(
        "/tasks/999",
        json={"status": "completed"}
    )

    assert response.status_code == 404

def test_cannot_read_another_users_tasks(client):
    response = client.get("/users/2/tasks")

    assert response.status_code == 403
    assert response.get_json()["error"] == "Доступ запрещён"


def test_cannot_update_another_users_task(client):
    response = client.patch(
        "/tasks/3",
        json={"status": "completed"}
    )

    assert response.status_code == 403

    # Убедимся, что чужая задача осталась без изменений.
    from db import get_connection

    with get_connection() as connection:
        task = connection.execute(
            "SELECT status FROM tasks WHERE id = ?",
            (3,)
        ).fetchone()

    assert task["status"] == "pending"
