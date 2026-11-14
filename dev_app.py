
from flask import Flask, send_from_directory, request, jsonify

from db import init_db
from routes.tasks import tasks_bp

app = Flask(__name__)
app.register_blueprint(tasks_bp)

init_db()


@app.get("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.post("/chat")
def chat():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Некорректный запрос"}), 400

    message = data.get("message", "")

    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Сообщение не может быть пустым"}), 400

    return jsonify({
        "answer": "Чебуречная жизнь тяжелая, тестовый ответ AI-buddy. Скоро здесь будет YandexГЭПЭТЭ.",
        "sources": []
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
