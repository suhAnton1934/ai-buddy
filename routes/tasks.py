
from flask import Blueprint, jsonify, request
from db import get_connection
from config import DEMO_USER_ID

tasks_bp = Blueprint("tasks", __name__)


@tasks_bp.route("/users/<int:user_id>/tasks", methods=["GET"])
def get_tasks(user_id):
    # Запрещаем просмотр чужих задач
    if user_id != DEMO_USER_ID:
        return jsonify({"error": "Доступ запрещён"}), 403

    connection = get_connection()

    try:
        rows = connection.execute(
            "SELECT id, title, status FROM tasks WHERE user_id = ?",
            (DEMO_USER_ID,)
        ).fetchall()

        if not rows:
            return jsonify({"tasks": []}), 200

        return jsonify({
            "tasks": [dict(row) for row in rows]
        })

    finally:
        connection.close()


@tasks_bp.route("/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Некорректный JSON"}), 400

    status = data.get("status")

    if status not in ("pending", "completed"):
        return jsonify({"error": "Недопустимый статус"}), 400

    connection = get_connection()

    try:
        task = connection.execute(
            "SELECT id, user_id, title, status FROM tasks WHERE id = ?",
            (task_id,)
        ).fetchone()

        if task is None:
            return jsonify({"error": "Задача не найдена"}), 404

        # Проверяем владельца задачи
        if task["user_id"] != DEMO_USER_ID:
            return jsonify({"error": "Доступ запрещён"}), 403

        connection.execute(
            """
            UPDATE tasks
            SET status = ?
            WHERE id = ? AND user_id = ?
            """,
            (status, task_id, DEMO_USER_ID)
        )
        connection.commit()

        updated_task = connection.execute(
            """
            SELECT id, title, status
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, DEMO_USER_ID)
        ).fetchone()

        return jsonify({"task": dict(updated_task)})

    finally:
        connection.close()
