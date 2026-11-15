"""Демонстрационные маршруты наставника. НЕ использовать как production auth."""
from contextlib import closing
from datetime import date

from flask import Blueprint, jsonify, request

from config import DEMO_USER_ID
from db import get_connection

mentor_bp = Blueprint("mentor", __name__)


def _payload():
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else None


def _demo_user(value):
    return type(value) is int and value == DEMO_USER_ID


def _validate_due_date(value):
    """Допускаются null/пустое значение либо строгая дата YYYY-MM-DD."""
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Дедлайн должен быть в формате ГГГГ-ММ-ДД")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Некорректная дата дедлайна") from exc
    if parsed.isoformat() != value:
        raise ValueError("Дедлайн должен быть в формате ГГГГ-ММ-ДД")
    return value


@mentor_bp.get("/mentor/tasks")
def list_mentor_tasks():
    user_id = request.args.get("user_id", type=int)
    if not _demo_user(user_id):
        return jsonify({"error": "Доступен только тестовый стажёр №1"}), 403
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """SELECT id, user_id, title, description, status, due_date
               FROM tasks WHERE user_id = ? ORDER BY id DESC""",
            (user_id,)
        ).fetchall()
    return jsonify({"tasks": [dict(row) for row in rows]})


@mentor_bp.post("/mentor/tasks")
def create_mentor_task():
    data = _payload()
    if data is None:
        return jsonify({"error": "Ожидается JSON-объект"}), 400
    if not _demo_user(data.get("user_id")):
        return jsonify({"error": "Доступен только тестовый стажёр №1"}), 403

    title = data.get("title")
    description = data.get("description", "")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        return jsonify({"error": "Название задачи: от 1 до 120 символов"}), 400
    if not isinstance(description, str) or len(description) > 1000:
        return jsonify({"error": "Описание задачи: не более 1000 символов"}), 400
    try:
        due_date = _validate_due_date(data.get("due_date"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    with closing(get_connection()) as connection, connection:
        cursor = connection.execute(
            """INSERT INTO tasks (user_id, title, description, due_date, status)
               VALUES (?, ?, ?, ?, 'pending')""",
            (DEMO_USER_ID, title.strip(), description.strip(), due_date)
        )
        row = connection.execute(
            """SELECT id, user_id, title, description, status, due_date
               FROM tasks WHERE id = ?""",
            (cursor.lastrowid,)
        ).fetchone()
    return jsonify({"task": dict(row)}), 201


@mentor_bp.get("/mentor/questions")
def list_questions():
    user_id = request.args.get("user_id", type=int)
    if not _demo_user(user_id):
        return jsonify({"error": "Доступен только тестовый стажёр №1"}), 403
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """SELECT id, user_id, text, reply, status, created_at, answered_at
               FROM mentor_questions WHERE user_id = ? ORDER BY id DESC""",
            (user_id,)
        ).fetchall()
    return jsonify({"questions": [dict(row) for row in rows]})


@mentor_bp.post("/mentor/questions")
def create_question():
    data = _payload()
    if data is None:
        return jsonify({"error": "Ожидается JSON-объект"}), 400
    if not _demo_user(data.get("user_id")):
        return jsonify({"error": "Доступен только тестовый стажёр №1"}), 403
    message = data.get("text")
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 2000:
        return jsonify({"error": "Вопрос: от 1 до 2000 символов"}), 400
    with closing(get_connection()) as connection, connection:
        cursor = connection.execute(
            "INSERT INTO mentor_questions (user_id, text) VALUES (?, ?)",
            (DEMO_USER_ID, message.strip())
        )
        row = connection.execute(
            "SELECT * FROM mentor_questions WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return jsonify({"question": dict(row)}), 201


@mentor_bp.post("/mentor/questions/<int:question_id>/reply")
def reply_to_question(question_id):
    data = _payload()
    if data is None:
        return jsonify({"error": "Ожидается JSON-объект"}), 400
    reply = data.get("reply")
    if not isinstance(reply, str) or not 1 <= len(reply.strip()) <= 2000:
        return jsonify({"error": "Ответ: от 1 до 2000 символов"}), 400
    with closing(get_connection()) as connection, connection:
        row = connection.execute(
            "SELECT id FROM mentor_questions WHERE id = ? AND user_id = ?",
            (question_id, DEMO_USER_ID)
        ).fetchone()
        if row is None:
            return jsonify({"error": "Обращение не найдено"}), 404
        connection.execute(
            """UPDATE mentor_questions
               SET reply = ?, status = 'answered', answered_at = CURRENT_TIMESTAMP
               WHERE id = ? AND user_id = ?""",
            (reply.strip(), question_id, DEMO_USER_ID)
        )
        updated = connection.execute(
            "SELECT * FROM mentor_questions WHERE id = ?", (question_id,)
        ).fetchone()
    return jsonify({"question": dict(updated)})
