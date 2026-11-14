
from flask import Flask, send_from_directory

from db import init_db
from routes.tasks import tasks_bp
from demo_chat import demo_chat_bp

app = Flask(__name__)

app.register_blueprint(tasks_bp)
app.register_blueprint(demo_chat_bp)

init_db()


@app.get("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory("frontend", filename)


if __name__ == "__main__":
    app.run(debug=True, port=5001)
