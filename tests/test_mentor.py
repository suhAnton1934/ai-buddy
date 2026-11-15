"""API-тесты демонстрационной интеграции кабинета наставника."""
import sqlite3

import pytest
from flask import Flask

import db
from routes.mentor import mentor_bp
from routes.tasks import tasks_bp


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "mentor-test.db")
    db.init_db()
    app = Flask(__name__)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(mentor_bp)
    app.config["TESTING"] = True
    return app.test_client()


def test_assign_task_with_deadline_and_description(client):
    response = client.post("/mentor/tasks", json={
        "user_id": 1, "title": "  Изучить Git Flow  ",
        "description": "Пройти учебный сценарий", "due_date": "2026-11-20"
    })
    assert response.status_code == 201
    task = response.json["task"]
    assert task["title"] == "Изучить Git Flow"
    assert task["description"] == "Пройти учебный сценарий"
    assert task["due_date"] == "2026-11-20"
    assert task["status"] == "pending"
    student_tasks = client.get("/users/1/tasks").json["tasks"]
    assert any(t["id"] == task["id"] and t["due_date"] == "2026-11-20" for t in student_tasks)
    assert client.patch(f"/tasks/{task['id']}", json={"status": "completed"}).status_code == 200
    mentor_tasks = client.get("/mentor/tasks?user_id=1").json["tasks"]
    assert next(t for t in mentor_tasks if t["id"] == task["id"])["status"] == "completed"


def test_assign_task_without_deadline(client):
    response = client.post("/mentor/tasks", json={"user_id": 1, "title": "Познакомиться с командой"})
    assert response.status_code == 201
    assert response.json["task"]["due_date"] is None
    assert response.json["task"]["description"] == ""


@pytest.mark.parametrize("bad_date", ["20.11.2026", "2026-02-30", "2026-2-3", "yesterday", 42])
def test_reject_invalid_deadline(client, bad_date):
    response = client.post("/mentor/tasks", json={"user_id": 1, "title": "Задача", "due_date": bad_date})
    assert response.status_code == 400


@pytest.mark.parametrize("bad_title", ["", "  ", "x" * 121, 1, None])
def test_reject_invalid_task_title(client, bad_title):
    response = client.post("/mentor/tasks", json={"user_id": 1, "title": bad_title})
    assert response.status_code == 400


def test_only_one_demo_user(client):
    assert client.post("/mentor/tasks", json={"user_id": 2, "title": "Нет"}).status_code == 403
    assert client.get("/mentor/tasks?user_id=2").status_code == 403
    assert client.post("/mentor/questions", json={"user_id": 2, "text": "Нет"}).status_code == 403
    assert client.get("/mentor/questions?user_id=2").status_code == 403


def test_student_sends_question_and_mentor_replies(client):
    created = client.post("/mentor/questions", json={"user_id": 1, "text": "Как открыть доступ к репозиторию?"})
    assert created.status_code == 201
    question_id = created.json["question"]["id"]
    assert created.json["question"]["status"] == "open"
    assert created.json["question"]["reply"] is None
    replied = client.post(f"/mentor/questions/{question_id}/reply", json={"reply": "Напиши заявку наставнику"})
    assert replied.status_code == 200
    assert replied.json["question"]["status"] == "answered"
    questions = client.get("/mentor/questions?user_id=1").json["questions"]
    assert questions[0]["reply"] == "Напиши заявку наставнику"
    assert questions[0]["answered_at"] is not None


def test_empty_question_and_reply_rejected(client):
    assert client.post("/mentor/questions", json={"user_id": 1, "text": " "}).status_code == 400
    assert client.post("/mentor/questions", json={"user_id": 1, "text": "a" * 2001}).status_code == 400
    qid = client.post("/mentor/questions", json={"user_id": 1, "text": "Как дела?"}).json["question"]["id"]
    assert client.post(f"/mentor/questions/{qid}/reply", json={"reply": "  "}).status_code == 400
    assert client.post("/mentor/questions/999999/reply", json={"reply": "Ответ"}).status_code == 404


def test_migrate_legacy_database_without_losing_tasks(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TABLE tasks (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        )""")
        connection.execute("INSERT INTO tasks VALUES (10, 1, 'Старая задача', 'completed')")
    db.init_db()
    db.init_db()  # Миграция повторно не ломает таблицы и не создаёт дубли.
    with db.get_connection() as connection:
        row = connection.execute("SELECT title, status, due_date, description FROM tasks WHERE id=10").fetchone()
        count = connection.execute("SELECT COUNT(*) FROM tasks WHERE id=10").fetchone()[0]
    assert dict(row) == {
        "title": "Старая задача", "status": "completed", "due_date": None, "description": ""
    }
    assert count == 1
