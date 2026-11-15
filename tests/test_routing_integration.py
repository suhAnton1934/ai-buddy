from pathlib import Path
import pytest
import db
from unified_app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test_ai_buddy.db"
    for attr in ("DB_PATH", "DATABASE_PATH", "DATABASE"):
        if hasattr(db, attr):
            current_val = getattr(db, attr)
            new_val = db_file if isinstance(current_val, Path) else str(db_file)
            monkeypatch.setattr(db, attr, new_val)

    def fake_rag_chain():
        class FakeDoc:
            metadata = {"source": "knowledge/vpn_guide.txt"}

        class FakeChain:
            def invoke(self, payload):
                return {
                    "result": f"Ответ из RAG по запросу: {payload['query'][:40]}",
                    "source_documents": [FakeDoc()],
                }

        return FakeChain()

    app = create_app(ai_mode="rag", rag_factory=fake_rag_chain)
    app.config["TESTING"] = True
    return app.test_client()


def test_checklist_and_task_status_flow(client):
    res = client.get("/users/1/tasks")
    assert res.status_code == 200
    tasks = res.get_json()["tasks"]
    assert len(tasks) > 0

    first_task = tasks[0]
    new_status = "completed" if first_task["status"] == "pending" else "pending"

    patch_res = client.patch(
        f"/tasks/{first_task['id']}",
        json={"status": new_status},
    )
    assert patch_res.status_code == 200
    assert patch_res.get_json()["task"]["status"] == new_status


def test_routing_corporate_action_day_off(client):
    res = client.post("/chat", json={"message": "Помоги оформить отгул на пятницу"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["intent"] == "ACTION"
    assert data["proposed_action"]["type"] == "day_off"
    assert "отгул" in data["answer"].lower()


def test_routing_to_rag(client):
    res = client.post(
        "/chat",
        json={
            "message": "Как настроить корпоративный VPN по инструкции?",
            "user_context": {"role": "C++ Developer", "team": "Core", "stage": "Первая неделя"},
        },
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["mode"] == "rag"
    assert data["intent"] == "RAG"
    assert any(s["file"] == "vpn_guide.txt" for s in data["sources"])