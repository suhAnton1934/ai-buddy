from flask import Flask
from routes.tasks import tasks_bp


def test_get_tasks():
    app = Flask(__name__)
    app.register_blueprint(tasks_bp)
    client = app.test_client()

    response = client.get("/users/1/tasks")

    assert response.status_code == 200
    assert len(response.json["tasks"]) == 2


def test_user_not_found():
    app = Flask(__name__)
    app.register_blueprint(tasks_bp)
    client = app.test_client()

    response = client.get("/users/999/tasks")

    assert response.status_code == 404