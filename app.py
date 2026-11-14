from flask import Flask, request, jsonify, send_from_directory
from db import init_db
from rag import build_rag_chain
from routes.tasks import tasks_bp

app = Flask(__name__)
app.register_blueprint(tasks_bp)

init_db()


@app.get("/")
def index():
    return send_from_directory("frontend", "index.html")

# Создаем RAG-цепочку при старте сервера
print("Загружаем базу знаний и инициализируем RAG...")
qa_chain = build_rag_chain()
print("Готово! Сервер запускается.")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/chat", methods=["POST"])
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

    # Формируем расширенный вопрос с контекстом для промпта
    enriched_question = (
        f"Информация о стажёре: Роль: {role}, Команда: {team}, Этап: {stage}.\n"
        f"Вопрос: {user_message}"
    )

    try:
        # Отправляем вопрос в RAG-систему (передаем только query)
        result = qa_chain.invoke({"query": enriched_question})

        # Достаем источники
        sources = []
        for doc in result.get("source_documents", []):
            sources.append({
                "file": doc.metadata.get("source", "unknown"),
                "content": doc.page_content
            })

        return jsonify({
            "answer": result["result"],
            "sources": sources
        })
        
    except Exception as e:
        print(f"Ошибка при обработке запроса: {e}")
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5001)