from contextlib import closing
from config import DEMO_USER_ID
from db import get_connection

CORPORATE_ACTION_WORDS = (
    "отгул",
    "отпуск",
    "больничн",
    "справк",
    "оформить заявк",
    "оформи заявк",
)


def detect_intent(message: str) -> str:
    if not isinstance(message, str):
        return "RAG"
    msg = message.strip().casefold()

    if any(word in msg for word in CORPORATE_ACTION_WORDS):
        return "ACTION_CORPORATE"

    if ("отмет" in msg or "заверш" in msg or "выполнил" in msg) and (
        "выполн" in msg or "готов" in msg
    ):
        return "ACTION_TASK"

    if (
        "задач" in msg
        or "чек-лист" in msg
        or "чеклист" in msg
        or ("что" in msg and "делать" in msg)
        or "дальше" in msg
    ):
        return "CHECKLIST"

    return "RAG"


def execute_corporate_action(message: str, mode: str = "demo") -> dict:
    msg = message.strip()
    normalized = msg.casefold()

    if "отгул" in normalized:
        action_type = "day_off"
        title = "Оформление отгула"
        answer = (
            "Запрос на оформление отгула принят"
        )
    elif "отпуск" in normalized:
        action_type = "vacation"
        title = "Заявка на отпуск"
        answer = "Заявка на отпуск сформирована"
    elif "справк" in normalized:
        action_type = "certificate"
        title = "Заказ справки"
        answer = "Запрос на оформление справки с места работы отправлен в отдел кадров"
    else:
        action_type = "hr_request"
        title = "Корпоративная заявка"
        answer = f"Корпоративная заявка («{msg}») сформирована и передана в работу"

    ticket_id = None
    try:
        with closing(get_connection()) as conn, conn:
            cur = conn.execute(
                """
                INSERT INTO mentor_questions (user_id, question, status)
                VALUES (?, ?, 'open')
                """,
                (DEMO_USER_ID, f"[{title}] {msg}"),
            )
            ticket_id = cur.lastrowid
    except Exception:
        pass

    return {
        "answer": answer,
        "sources": [],
        "mode": mode,
        "intent": "ACTION",
        "task_updated": False,
        "proposed_action": {
            "type": action_type,
            "title": title,
            "ticket_id": ticket_id,
        },
    }