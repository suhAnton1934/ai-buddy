from flask import Blueprint, jsonify

tasks_bp = Blueprint("tasks", __name__)

tasks = {
    1: [
        {"id": 1, "title": "Настроить Git", "status": "pending"},
        {"id": 2, "title": "Изучить документацию", "status": "pending"}
    ],
    2: [
        {"id": 3, "title": "Познакомиться с наставником", "status": "pending"}
    ]
}


@tasks_bp.route("/users/<int:user_id>/tasks", methods=["GET"])
def get_tasks(user_id):
    if user_id not in tasks:
        return jsonify({"error": "Пользователь не найден"}), 404

    return jsonify({"tasks": tasks[user_id]})

from flask import request

@tasks_bp.route("/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Некорректный JSON"}), 400

    status = data.get("status")

    if status not in ("pending", "completed"):
        return jsonify({"error": "Недопустимый статус"}), 400

    for user_id, user_tasks in tasks.items():
        for task in user_tasks:
            if task["id"] == task_id:
                task["status"] = status
                return jsonify({"task": task})

    return jsonify({"error": "Задача не найдена"}), 404