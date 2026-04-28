import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_DB = os.path.join(os.path.dirname(__file__), "rehearsal_app.db")
DB_PATH = os.getenv("DB_PATH", DEFAULT_DB)


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


_ensure_parent_dir(DB_PATH)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('manager', 'officer', 'director')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS shows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rehearsals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                show_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                show_id INTEGER NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                pronouns TEXT,
                role TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('cast', 'crew')),
                FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS advanced_info (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL UNIQUE,
                phone TEXT,
                email TEXT,
                grade TEXT,
                guardian_name TEXT,
                guardian_email TEXT,
                guardian_phone TEXT,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                show_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('cast', 'crew')),
                FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                person_id INTEGER NOT NULL,
                UNIQUE(group_id, person_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rehearsal_preexcused (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                rehearsal_id INTEGER NOT NULL,
                person_id INTEGER NOT NULL,
                UNIQUE(rehearsal_id, person_id),
                FOREIGN KEY (rehearsal_id) REFERENCES rehearsals(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS attendance_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                show_id INTEGER NOT NULL,
                rehearsal_id INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                stopped_at TEXT,
                FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
                FOREIGN KEY (rehearsal_id) REFERENCES rehearsals(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS attendance_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                person_id INTEGER NOT NULL,
                present INTEGER NOT NULL DEFAULT 0,
                pre_excused INTEGER NOT NULL DEFAULT 0,
                checked_in_at TEXT,
                UNIQUE(session_id, person_id),
                FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_rehearsals_show_date ON rehearsals(show_id, date);
            CREATE INDEX IF NOT EXISTS idx_people_show_type ON people(show_id, type);
            CREATE INDEX IF NOT EXISTS idx_groups_show_type ON groups(show_id, type);
            CREATE INDEX IF NOT EXISTS idx_attendance_sessions_active ON attendance_sessions(show_id, active);
            """
        )


def fetch_all(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def fetch_one(sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> int:
    with get_connection() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


def execute_many(sql: str, params_list: List[tuple]) -> None:
    with get_connection() as conn:
        conn.executemany(sql, params_list)


def with_transaction(statements: List[Dict[str, Any]]) -> None:
    with get_connection() as conn:
        for stmt in statements:
            conn.execute(stmt["sql"], stmt.get("params", ()))


def get_today_rehearsal(show_id: int, date_value: str) -> Optional[Dict[str, Any]]:
    return fetch_one(
        """
        SELECT id, show_id, date, start_time, end_time
        FROM rehearsals
        WHERE show_id = ? AND date = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (show_id, date_value),
    )


def get_active_session(show_id: int) -> Optional[Dict[str, Any]]:
    return fetch_one(
        """
        SELECT s.id, s.show_id, s.rehearsal_id, s.active, s.created_at, s.stopped_at,
               r.date, r.start_time, r.end_time,
               sh.name AS show_name
        FROM attendance_sessions s
        JOIN rehearsals r ON r.id = s.rehearsal_id
        JOIN shows sh ON sh.id = s.show_id
        WHERE s.show_id = ? AND s.active = 1
        ORDER BY s.created_at DESC
        LIMIT 1
        """,
        (show_id,),
    )


def get_any_active_session() -> Optional[Dict[str, Any]]:
    return fetch_one(
        """
        SELECT s.id, s.show_id, s.rehearsal_id, s.active, s.created_at,
               r.date, r.start_time, r.end_time,
               sh.name AS show_name
        FROM attendance_sessions s
        JOIN rehearsals r ON r.id = s.rehearsal_id
        JOIN shows sh ON sh.id = s.show_id
        WHERE s.active = 1
        ORDER BY s.created_at DESC
        LIMIT 1
        """
    )


def list_session_records(session_id: int) -> List[Dict[str, Any]]:
    return fetch_all(
        """
        SELECT ar.id, ar.session_id, ar.person_id, ar.present, ar.pre_excused, ar.checked_in_at,
               p.first_name, p.last_name, p.type, p.role
        FROM attendance_records ar
        JOIN people p ON p.id = ar.person_id
        WHERE ar.session_id = ?
        ORDER BY p.type, p.last_name, p.first_name
        """,
        (session_id,),
    )


def now_iso() -> str:
    return _now_iso()
