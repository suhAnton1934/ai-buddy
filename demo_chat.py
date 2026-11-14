from flask import Blueprint, jsonify, request
from db import get_connection
from config import DEMO_USER_ID

demo_chat_bp = Blueprint("demo_chat", __name__)

# В демонстрационном режиме используется один стажёр.
DEMO_USER_ID = 1


@demo_chat_bp.route("/chat", methods=["POST"])
def demo_chat():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Некорректный JSON"}), 400

    message = data.get("message")

    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Пустое сообщение"}), 400

    message = message.strip().lower()

    with get_connection() as connection:

        # Сценарий 1: показать незавершённые задачи
        if "задач" in message or (
            "что" in message and "делать" in message
        ):
            rows = connection.execute(
                """
                SELECT title FROM tasks
                WHERE user_id = ? AND status = 'pending'
                ORDER BY id
                """,
                (DEMO_USER_ID,)
            ).fetchall()

            if not rows:
                answer = "Все задачи выполнены!"
            else:
                titles = [row["title"] for row in rows]
                answer = "Тебе осталось:\n" + "\n".join(
                    f"• {title}" for title in titles
                )

            return jsonify({
                "answer": answer,
                "sources": [],
                "mode": "demo",
                "task_updated": False
            })

        # Сценарий 2: выполнить задачу настройки Git
        if (
            "git" in message
            and ("отмет" in message or "выполнил" in message)
            and ("выполн" in message or "готов" in message)
        ):
            task = connection.execute(
                """
                SELECT id, title, status FROM tasks
                WHERE user_id = ? AND LOWER(title) LIKE ?
                LIMIT 1
                """,
                (DEMO_USER_ID, "%git%")
            ).fetchone()

            if task is None:
                return jsonify({
                    "answer": "Задача настройки Git не найдена.",
                    "sources": [],
                    "mode": "demo",
                    "task_updated": False
                })

            if task["status"] == "completed":
                answer = "Настройка Git уже отмечена выполненной."
                updated = False
            else:
                connection.execute(
                    "UPDATE tasks SET status = 'completed' WHERE id = ? AND user_id = ?",
                    (task["id"], DEMO_USER_ID)
                )
                connection.commit()

                answer = "Готово! Задача «Настроить Git» выполнена."
                updated = True

            return jsonify({
                "answer": answer,
                "sources": [],
                "mode": "demo",
                "task_updated": updated
            })

        # Сценарий 3: подсказка по Git
        if "git" in message:
            return jsonify({
                "answer": (
                    "Для настройки доступа к Git-репозиторию "
                    "посмотри тестовую инструкцию knowledge/ssh_guide.txt. "
                    "В демонстрационном режиме поиск по документам "
                    "пока не выполняется."
                ),
                "sources": ["knowledge/ssh_guide.txt"],
                "mode": "demo",
                "task_updated": False
            })

    return jsonify({
        "answer": (
            "Это демонстрационный режим. "
            "Попробуй спросить: «Какие у меня задачи?» "
            "или «Как настроить Git?»"
        ),
        "sources": [],
        "mode": "demo",
        "task_updated": False
    })
