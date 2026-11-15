from flask import Flask, request, jsonify, send_from_directory
from db import init_db, get_connection
from rag import build_rag_chain
from routes.tasks import tasks_bp
from config import DEMO_USER_ID

app = Flask(__name__)
app.register_blueprint(tasks_bp)

# Инициализируем базу данных при старте
init_db()

# Создаем RAG-цепочку при старте сервера
print("Загружаем базу знаний и инициализируем RAG...")
qa_chain = build_rag_chain()
print("Готово! Сервер запускается.")

# --- ОТДАЧА ФРОНТЕНДА (Камила) ---
@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")

@app.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory("frontend", filename)


# --- СЛУЖЕБНЫЕ ЭНДПОИНТЫ ---
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# --- ГЛАВНЫЙ ЭНДПОИНТ ЧАТА (Твой RAG) ---
@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Empty request body"}), 400
        
    user_message = data.get("message", "")
    if not user_message:
        return jsonify({"error": "Поле 'message' обязательно"}), 400

    # Достаем контекст стажёра (если не передан, ставим заглушки)
    user_context = data.get("user_context", {})
    role = user_context.get("role", "Стажёр")
    team = user_context.get("team", "Не указана")
    stage = user_context.get("stage", "Не указан")

    # --- ИНТЕГРАЦИЯ С БАЗОЙ ЗАДАЧ (Артём) ---
    # Если пользователь спрашивает про задачи, достаем их из БД
    connection = get_connection()
    tasks_text = ""
    try:
        if "задач" in user_message.lower() or "делать" in user_message.lower():
            rows = connection.execute(
                "SELECT title FROM tasks WHERE user_id = ? AND status = 'pending' ORDER BY id",
                (DEMO_USER_ID,)
            ).fetchall()
            if rows:
                titles = [row["title"] for row in rows]
                tasks_text = f"\nТекущие незавершенные задачи стажёра:\n- " + "\n- ".join(titles)
    finally:
        connection.close()

    # Формируем расширенный вопрос с контекстом для промпта
    enriched_question = (
        f"Информация о стажёре: Роль: {role}, Команда: {team}, Этап: {stage}.\n"
        f"Вопрос: {user_message}"
        f"{tasks_text}" # Добавляем задачи в контекст вопроса
    )

    try:
        # Отправляем вопрос в RAG-систему
        result = qa_chain.invoke({"query": enriched_question})

        # Достаем источники
        sources = []
        for doc in result.get("source_documents", []):
            sources.append({
                "file": doc.metadata.get("source", "unknown"),
                "content": doc.page_content
            })

        # Возвращаем ответ (поле task_updated нужно для фронтенда Камилы)
        return jsonify({
            "answer": result["result"],
            "sources": sources,
            "task_updated": False 
        })
        
    except Exception as e:
        print(f"Ошибка при обработке запроса: {e}")
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001)