import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "ai_buddy.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'completed'))
            )
        """)

        connection.executemany("""
            INSERT OR IGNORE INTO tasks (id, user_id, title, status)
            VALUES (?, ?, ?, ?)
        """, [
            (1, 1, "Настроить Git", "pending"),
            (2, 1, "Изучить документацию", "pending"),
            (3, 2, "Познакомиться с наставником", "pending")
        ])