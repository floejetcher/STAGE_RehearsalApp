import os
import json
import uuid
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List

CREDS_PATH = os.path.join(os.path.dirname(__file__), "credentials.json")
DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "stage_inventory.db")
DB_PATH = os.getenv("DB_PATH", DEFAULT_DB_PATH)
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "168"))
VALID_ROLES = {"owner", "admin", "guest"}


def load_credentials() -> Dict:
    if not os.path.exists(CREDS_PATH):
        return {"users": []}
    with open(CREDS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_credentials(creds: Dict[str, Any]) -> None:
    users = creds.get("users", []) if isinstance(creds, dict) else []
    if not isinstance(users, list):
        raise ValueError("credentials must include a users list")
    with open(CREDS_PATH, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, indent=2)
        f.write("\n")


def normalize_role(role: str) -> str:
    value = (role or "guest").strip().lower()
    return value if value in VALID_ROLES else "guest"


def is_owner(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user and normalize_role(user.get("role", "guest")) == "owner")


def has_admin_access(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    return normalize_role(user.get("role", "guest")) in {"owner", "admin"}


def list_users() -> List[Dict[str, str]]:
    creds = load_credentials()
    users: List[Dict[str, str]] = []
    for u in creds.get("users", []):
        users.append(
            {
                "username": str(u.get("username", "")),
                "password": str(u.get("password", "")),
                "role": normalize_role(str(u.get("role", "guest"))),
            }
        )
    return users


def add_user(username: str, password: str, role: str) -> Dict[str, str]:
    username = (username or "").strip()
    password = (password or "").strip()
    if not username or not password:
        raise ValueError("username and password are required")

    users = list_users()
    if any(u["username"].lower() == username.lower() for u in users):
        raise ValueError("username already exists")

    new_user = {"username": username, "password": password, "role": normalize_role(role)}
    users.append(new_user)
    save_credentials({"users": users})
    return new_user


def update_user(username: str, updates: Dict[str, Any]) -> Dict[str, str]:
    username = (username or "").strip()
    if not username:
        raise ValueError("username is required")

    users = list_users()
    idx = next((i for i, u in enumerate(users) if u["username"].lower() == username.lower()), None)
    if idx is None:
        raise ValueError("user not found")

    target = users[idx]
    new_username = (updates.get("username") or target["username"]).strip()
    new_password = (updates.get("password") or target["password"]).strip()
    new_role = normalize_role(updates.get("role") or target["role"])

    if not new_username or not new_password:
        raise ValueError("username and password are required")

    if any(
        i != idx and u["username"].lower() == new_username.lower()
        for i, u in enumerate(users)
    ):
        raise ValueError("username already exists")

    users[idx] = {"username": new_username, "password": new_password, "role": new_role}
    save_credentials({"users": users})
    return users[idx]


def authenticate(username: str, password: str) -> Optional[Dict]:
    creds = load_credentials()
    for u in creds.get("users", []):
        if u.get("username") == username and u.get("password") == password:
            return {"username": u.get("username"), "role": normalize_role(u.get("role", "guest"))}
    return None


def _get_connection() -> sqlite3.Connection:
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_token_store() -> None:
    with _get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at
            ON auth_tokens(expires_at);
            """
        )


def _purge_expired_tokens() -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE expires_at <= ?", (now_iso,))


def create_token_for_user(user: Dict) -> str:
    init_token_store()
    _purge_expired_tokens()
    token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=TOKEN_TTL_HOURS)
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT INTO auth_tokens(token, username, role, created_at, expires_at, revoked)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (token, user["username"], user.get("role", "guest"), now.isoformat(), expires.isoformat()),
        )
    return token


def get_user_for_token(token: str) -> Optional[Dict]:
    if not token:
        return None
    init_token_store()
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT username, role, expires_at
            FROM auth_tokens
            WHERE token = ? AND revoked = 0
            """,
            (token,),
        ).fetchone()
    if not row:
        return None

    try:
        expires_at = datetime.fromisoformat(row["expires_at"])
    except ValueError:
        revoke_token(token)
        return None

    if expires_at <= datetime.now(timezone.utc):
        revoke_token(token)
        return None

    return {"username": row["username"], "role": row["role"]}


def revoke_token(token: str) -> None:
    if not token:
        return
    init_token_store()
    with _get_connection() as conn:
        conn.execute("UPDATE auth_tokens SET revoked = 1 WHERE token = ?", (token,))
