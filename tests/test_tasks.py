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


def test_user_not_found(client):
    response = client.get("/users/999/tasks")

    assert response.status_code == 404


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