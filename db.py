import sqlite3
from pathlib import Path
from contextlib import closing

DB_PATH = Path(__file__).resolve().parent / "data" / "ai_buddy.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with closing(get_connection()) as connection, connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'completed'))
            )
        """)

        # Обновляем существующую БД без удаления ранее сохранённых задач.
        existing_columns = {row["name"] for row in connection.execute("PRAGMA table_info(tasks)")}
        if "due_date" not in existing_columns:
            connection.execute("ALTER TABLE tasks ADD COLUMN due_date TEXT")
        if "description" not in existing_columns:
            connection.execute("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''")

        connection.execute("""
            CREATE TABLE IF NOT EXISTS mentor_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                reply TEXT,
                status TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open', 'answered')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                answered_at TEXT
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