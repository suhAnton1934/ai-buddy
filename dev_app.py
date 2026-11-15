
from flask import Flask, send_from_directory, jsonify, request

from db import init_db
from routes.tasks import tasks_bp
from routes.mentor import mentor_bp
from demo_chat import demo_chat_bp
from pathlib import Path
from mentor_intelligence import mentor_intelligence_bp, init_mentor_intelligence_db
from knowledge_sync import register_knowledge_sync
from team_memory import (team_memory_bp, init_team_memory_db,
                         find_approved_answer, chat_answer)

app = Flask(__name__)

app.register_blueprint(tasks_bp)
app.register_blueprint(mentor_bp)
app.register_blueprint(demo_chat_bp)
app.register_blueprint(team_memory_bp)
app.register_blueprint(mentor_intelligence_bp)
app.config['AI_MODE_ACTUAL'] = 'demo'

init_db()
init_team_memory_db()
init_mentor_intelligence_db()
register_knowledge_sync(app, Path(__file__).resolve().parent)

@app.before_request
def verified_mentor_answer_demo():
    if request.path != '/chat' or request.method != 'POST':
        return None
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None
    match = find_approved_answer(payload.get('message'))
    if match is not None:
        return jsonify(chat_answer(match, 'demo'))
    return None


@app.get("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory("frontend", filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
