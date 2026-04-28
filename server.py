import os
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

import rehearsal_db


app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app)

TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "12"))
VALID_ROLES = {"manager", "officer", "director"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_date(date_value: str):
    try:
        return datetime.strptime(date_value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _check_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _bootstrap_admin() -> None:
    users = rehearsal_db.fetch_all("SELECT id FROM users LIMIT 1")
    if users:
        return

    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD", "changeme123")
    role = os.getenv("ADMIN_ROLE", "director").strip().lower()
    if role not in VALID_ROLES:
        role = "director"

    rehearsal_db.execute(
        "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
        (username, _hash_password(password), role),
    )


rehearsal_db.init_db()
_bootstrap_admin()


def _token_from_request() -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1].strip()
    return ""


def _get_current_user():
    token = _token_from_request()
    if not token:
        return None

    row = rehearsal_db.fetch_one(
        """
        SELECT t.token, t.expires_at, t.revoked, u.id, u.username, u.role
        FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ?
        """,
        (token,),
    )
    if not row:
        return None
    if int(row["revoked"]) == 1:
        return None

    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at <= _now_utc():
        rehearsal_db.execute("UPDATE auth_tokens SET revoked = 1 WHERE token = ?", (token,))
        return None

    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "token": token,
    }


def require_admin(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = _get_current_user()
        if not user:
            return jsonify({"error": "not authenticated"}), 401
        if user["role"] not in VALID_ROLES:
            return jsonify({"error": "forbidden"}), 403
        return func(user, *args, **kwargs)

    return wrapper


def _serialize_person_with_advanced(row):
    return {
        "id": row["id"],
        "show_id": row["show_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "pronouns": row["pronouns"] or "",
        "role": row["role"],
        "type": row["type"],
        "advanced": {
            "phone": row["phone"] or "",
            "email": row["email"] or "",
            "grade": row["grade"] or "",
            "guardian_name": row["guardian_name"] or "",
            "guardian_email": row["guardian_email"] or "",
            "guardian_phone": row["guardian_phone"] or "",
        },
    }


def _show_exists(show_id: int) -> bool:
    row = rehearsal_db.fetch_one("SELECT id FROM shows WHERE id = ?", (show_id,))
    return bool(row)


def _rehearsal_exists(rehearsal_id: int) -> bool:
    row = rehearsal_db.fetch_one("SELECT id FROM rehearsals WHERE id = ?", (rehearsal_id,))
    return bool(row)


@app.route("/api/admin/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    user = rehearsal_db.fetch_one(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        (username,),
    )
    if not user or not _check_password(password, user["password_hash"]):
        return jsonify({"error": "invalid credentials"}), 401

    token = uuid.uuid4().hex
    expires_at = (_now_utc() + timedelta(hours=TOKEN_TTL_HOURS)).isoformat()
    rehearsal_db.execute(
        "INSERT INTO auth_tokens(token, user_id, role, expires_at, revoked) VALUES (?, ?, ?, ?, 0)",
        (token, user["id"], user["role"], expires_at),
    )
    return jsonify({"token": token, "username": user["username"], "role": user["role"]})


@app.route("/api/admin/logout", methods=["POST"])
@require_admin
def logout(user):
    rehearsal_db.execute("UPDATE auth_tokens SET revoked = 1 WHERE token = ?", (user["token"],))
    return jsonify({"ok": True})


@app.route("/api/admin/me", methods=["GET"])
@require_admin
def me(user):
    return jsonify({"username": user["username"], "role": user["role"]})


@app.route("/api/admin/users", methods=["GET", "POST"])
@require_admin
def users(_user):
    if request.method == "GET":
        rows = rehearsal_db.fetch_all("SELECT id, username, role, created_at FROM users ORDER BY username")
        return jsonify(rows)

    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    role = str(data.get("role", "manager")).strip().lower()
    if role not in VALID_ROLES:
        return jsonify({"error": "role must be manager, officer, or director"}), 400
    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    try:
        user_id = rehearsal_db.execute(
            "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
            (username, _hash_password(password), role),
        )
    except Exception:
        return jsonify({"error": "username already exists"}), 409

    created = rehearsal_db.fetch_one("SELECT id, username, role, created_at FROM users WHERE id = ?", (user_id,))
    return jsonify(created), 201


@app.route("/api/admin/shows", methods=["GET", "POST"])
@require_admin
def shows(_user):
    if request.method == "GET":
        rows = rehearsal_db.fetch_all("SELECT id, name, created_at FROM shows ORDER BY name")
        return jsonify(rows)

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    show_id = rehearsal_db.execute("INSERT INTO shows(name) VALUES (?)", (name,))
    row = rehearsal_db.fetch_one("SELECT id, name, created_at FROM shows WHERE id = ?", (show_id,))
    return jsonify(row), 201


@app.route("/api/admin/shows/<int:show_id>", methods=["GET", "PUT", "DELETE"])
@require_admin
def show_detail(_user, show_id):
    if request.method == "GET":
        row = rehearsal_db.fetch_one("SELECT id, name, created_at FROM shows WHERE id = ?", (show_id,))
        if not row:
            return jsonify({"error": "show not found"}), 404
        return jsonify(row)

    if request.method == "DELETE":
        rehearsal_db.execute("DELETE FROM shows WHERE id = ?", (show_id,))
        return jsonify({"ok": True})

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    rehearsal_db.execute("UPDATE shows SET name = ? WHERE id = ?", (name, show_id))
    row = rehearsal_db.fetch_one("SELECT id, name, created_at FROM shows WHERE id = ?", (show_id,))
    return jsonify(row)


@app.route("/api/admin/shows/<int:show_id>/rehearsals", methods=["GET", "POST"])
@require_admin
def rehearsals(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    if request.method == "GET":
        rows = rehearsal_db.fetch_all(
            "SELECT id, show_id, date, start_time, end_time FROM rehearsals WHERE show_id = ? ORDER BY date",
            (show_id,),
        )
        return jsonify(rows)

    data = request.get_json(silent=True) or {}
    date = str(data.get("date", "")).strip()
    start_time = str(data.get("start_time", "")).strip() or None
    end_time = str(data.get("end_time", "")).strip() or None
    if not _parse_date(date):
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400

    rehearsal_id = rehearsal_db.execute(
        "INSERT INTO rehearsals(show_id, date, start_time, end_time) VALUES (?, ?, ?, ?)",
        (show_id, date, start_time, end_time),
    )
    row = rehearsal_db.fetch_one(
        "SELECT id, show_id, date, start_time, end_time FROM rehearsals WHERE id = ?",
        (rehearsal_id,),
    )
    return jsonify(row), 201


@app.route("/api/admin/rehearsals/<int:rehearsal_id>", methods=["PUT", "DELETE"])
@require_admin
def rehearsal_detail(_user, rehearsal_id):
    if not _rehearsal_exists(rehearsal_id):
        return jsonify({"error": "rehearsal not found"}), 404

    if request.method == "DELETE":
        rehearsal_db.execute("DELETE FROM rehearsals WHERE id = ?", (rehearsal_id,))
        return jsonify({"ok": True})

    data = request.get_json(silent=True) or {}
    date = str(data.get("date", "")).strip()
    start_time = str(data.get("start_time", "")).strip() or None
    end_time = str(data.get("end_time", "")).strip() or None
    if not _parse_date(date):
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    rehearsal_db.execute(
        "UPDATE rehearsals SET date = ?, start_time = ?, end_time = ? WHERE id = ?",
        (date, start_time, end_time, rehearsal_id),
    )
    row = rehearsal_db.fetch_one(
        "SELECT id, show_id, date, start_time, end_time FROM rehearsals WHERE id = ?",
        (rehearsal_id,),
    )
    return jsonify(row)


@app.route("/api/admin/rehearsals/<int:rehearsal_id>/pre-excused", methods=["GET", "PUT"])
@require_admin
def rehearsal_pre_excused(_user, rehearsal_id):
    if not _rehearsal_exists(rehearsal_id):
        return jsonify({"error": "rehearsal not found"}), 404

    if request.method == "GET":
        rows = rehearsal_db.fetch_all(
            """
            SELECT p.id AS person_id, p.first_name, p.last_name, p.type
            FROM rehearsal_preexcused pe
            JOIN people p ON p.id = pe.person_id
            WHERE pe.rehearsal_id = ?
            ORDER BY p.last_name, p.first_name
            """,
            (rehearsal_id,),
        )
        return jsonify(rows)

    data = request.get_json(silent=True) or {}
    person_ids = data.get("person_ids", [])
    if not isinstance(person_ids, list):
        return jsonify({"error": "person_ids must be an array"}), 400

    statements = [{"sql": "DELETE FROM rehearsal_preexcused WHERE rehearsal_id = ?", "params": (rehearsal_id,)}]
    for person_id in person_ids:
        statements.append(
            {
                "sql": "INSERT OR IGNORE INTO rehearsal_preexcused(rehearsal_id, person_id) VALUES (?, ?)",
                "params": (rehearsal_id, int(person_id)),
            }
        )
    rehearsal_db.with_transaction(statements)

    # Keep active session records in sync if attendance is currently running for this rehearsal.
    active = rehearsal_db.fetch_one(
        "SELECT id FROM attendance_sessions WHERE rehearsal_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
        (rehearsal_id,),
    )
    if active:
        rehearsal_db.execute("UPDATE attendance_records SET pre_excused = 0 WHERE session_id = ?", (active["id"],))
        for person_id in person_ids:
            rehearsal_db.execute(
                "UPDATE attendance_records SET pre_excused = 1 WHERE session_id = ? AND person_id = ?",
                (active["id"], int(person_id)),
            )

    return jsonify({"ok": True})


@app.route("/api/admin/shows/<int:show_id>/people", methods=["GET", "POST"])
@require_admin
def people(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    if request.method == "GET":
        rows = rehearsal_db.fetch_all(
            """
            SELECT p.id, p.show_id, p.first_name, p.last_name, p.pronouns, p.role, p.type,
                   ai.phone, ai.email, ai.grade, ai.guardian_name, ai.guardian_email, ai.guardian_phone
            FROM people p
            LEFT JOIN advanced_info ai ON ai.person_id = p.id
            WHERE p.show_id = ?
            ORDER BY p.type, p.last_name, p.first_name
            """,
            (show_id,),
        )
        return jsonify([_serialize_person_with_advanced(r) for r in rows])

    data = request.get_json(silent=True) or {}
    first_name = str(data.get("first_name", "")).strip()
    last_name = str(data.get("last_name", "")).strip()
    pronouns = str(data.get("pronouns", "")).strip()
    role = str(data.get("role", "")).strip()
    person_type = str(data.get("type", "")).strip().lower()
    advanced = data.get("advanced", {}) or {}

    if not first_name or not last_name or not role:
        return jsonify({"error": "first_name, last_name, and role are required"}), 400
    if person_type not in {"cast", "crew"}:
        return jsonify({"error": "type must be cast or crew"}), 400

    person_id = rehearsal_db.execute(
        "INSERT INTO people(show_id, first_name, last_name, pronouns, role, type) VALUES (?, ?, ?, ?, ?, ?)",
        (show_id, first_name, last_name, pronouns, role, person_type),
    )
    rehearsal_db.execute(
        """
        INSERT INTO advanced_info(person_id, phone, email, grade, guardian_name, guardian_email, guardian_phone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            person_id,
            str(advanced.get("phone", "")).strip(),
            str(advanced.get("email", "")).strip(),
            str(advanced.get("grade", "")).strip(),
            str(advanced.get("guardian_name", "")).strip(),
            str(advanced.get("guardian_email", "")).strip(),
            str(advanced.get("guardian_phone", "")).strip(),
        ),
    )

    row = rehearsal_db.fetch_one(
        """
        SELECT p.id, p.show_id, p.first_name, p.last_name, p.pronouns, p.role, p.type,
               ai.phone, ai.email, ai.grade, ai.guardian_name, ai.guardian_email, ai.guardian_phone
        FROM people p
        LEFT JOIN advanced_info ai ON ai.person_id = p.id
        WHERE p.id = ?
        """,
        (person_id,),
    )
    return jsonify(_serialize_person_with_advanced(row)), 201


@app.route("/api/admin/people/<int:person_id>", methods=["PUT", "DELETE"])
@require_admin
def person_detail(_user, person_id):
    person = rehearsal_db.fetch_one("SELECT id FROM people WHERE id = ?", (person_id,))
    if not person:
        return jsonify({"error": "person not found"}), 404

    if request.method == "DELETE":
        rehearsal_db.execute("DELETE FROM people WHERE id = ?", (person_id,))
        return jsonify({"ok": True})

    data = request.get_json(silent=True) or {}
    first_name = str(data.get("first_name", "")).strip()
    last_name = str(data.get("last_name", "")).strip()
    pronouns = str(data.get("pronouns", "")).strip()
    role = str(data.get("role", "")).strip()
    person_type = str(data.get("type", "")).strip().lower()
    advanced = data.get("advanced", {}) or {}

    if not first_name or not last_name or not role:
        return jsonify({"error": "first_name, last_name, and role are required"}), 400
    if person_type not in {"cast", "crew"}:
        return jsonify({"error": "type must be cast or crew"}), 400

    rehearsal_db.with_transaction(
        [
            {
                "sql": "UPDATE people SET first_name = ?, last_name = ?, pronouns = ?, role = ?, type = ? WHERE id = ?",
                "params": (first_name, last_name, pronouns, role, person_type, person_id),
            },
            {
                "sql": """
                    INSERT INTO advanced_info(person_id, phone, email, grade, guardian_name, guardian_email, guardian_phone)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(person_id) DO UPDATE SET
                        phone = excluded.phone,
                        email = excluded.email,
                        grade = excluded.grade,
                        guardian_name = excluded.guardian_name,
                        guardian_email = excluded.guardian_email,
                        guardian_phone = excluded.guardian_phone
                """,
                "params": (
                    person_id,
                    str(advanced.get("phone", "")).strip(),
                    str(advanced.get("email", "")).strip(),
                    str(advanced.get("grade", "")).strip(),
                    str(advanced.get("guardian_name", "")).strip(),
                    str(advanced.get("guardian_email", "")).strip(),
                    str(advanced.get("guardian_phone", "")).strip(),
                ),
            },
        ]
    )

    return jsonify({"ok": True})


@app.route("/api/admin/shows/<int:show_id>/groups", methods=["GET", "POST"])
@require_admin
def groups(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    group_type = str(request.args.get("type", "")).strip().lower()
    if group_type and group_type not in {"cast", "crew"}:
        return jsonify({"error": "type must be cast or crew"}), 400

    if request.method == "GET":
        sql = "SELECT id, show_id, name, type FROM groups WHERE show_id = ?"
        params = [show_id]
        if group_type:
            sql += " AND type = ?"
            params.append(group_type)
        sql += " ORDER BY type, name"
        rows = rehearsal_db.fetch_all(sql, tuple(params))

        for row in rows:
            members = rehearsal_db.fetch_all(
                """
                SELECT p.id, p.first_name, p.last_name, p.type, p.role
                FROM group_members gm
                JOIN people p ON p.id = gm.person_id
                WHERE gm.group_id = ?
                ORDER BY p.last_name, p.first_name
                """,
                (row["id"],),
            )
            row["members"] = members
        return jsonify(rows)

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    group_type = str(data.get("type", "")).strip().lower()
    if not name or group_type not in {"cast", "crew"}:
        return jsonify({"error": "name and valid type are required"}), 400
    group_id = rehearsal_db.execute(
        "INSERT INTO groups(show_id, name, type) VALUES (?, ?, ?)",
        (show_id, name, group_type),
    )
    row = rehearsal_db.fetch_one("SELECT id, show_id, name, type FROM groups WHERE id = ?", (group_id,))
    row["members"] = []
    return jsonify(row), 201


@app.route("/api/admin/groups/<int:group_id>", methods=["PUT", "DELETE"])
@require_admin
def group_detail(_user, group_id):
    group = rehearsal_db.fetch_one("SELECT id, show_id FROM groups WHERE id = ?", (group_id,))
    if not group:
        return jsonify({"error": "group not found"}), 404

    if request.method == "DELETE":
        rehearsal_db.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        return jsonify({"ok": True})

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    group_type = str(data.get("type", "")).strip().lower()
    member_ids = data.get("member_ids")

    if not name or group_type not in {"cast", "crew"}:
        return jsonify({"error": "name and valid type are required"}), 400

    statements = [
        {
            "sql": "UPDATE groups SET name = ?, type = ? WHERE id = ?",
            "params": (name, group_type, group_id),
        }
    ]

    if isinstance(member_ids, list):
        statements.append({"sql": "DELETE FROM group_members WHERE group_id = ?", "params": (group_id,)})
        for member_id in member_ids:
            statements.append(
                {
                    "sql": "INSERT OR IGNORE INTO group_members(group_id, person_id) VALUES (?, ?)",
                    "params": (group_id, int(member_id)),
                }
            )

    rehearsal_db.with_transaction(statements)
    return jsonify({"ok": True})


@app.route("/api/admin/shows/<int:show_id>/active-attendance", methods=["GET"])
@require_admin
def active_attendance(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    date_value = str(request.args.get("date", "")).strip() or datetime.now().strftime("%Y-%m-%d")
    if not _parse_date(date_value):
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400

    today_rehearsal = rehearsal_db.get_today_rehearsal(show_id, date_value)
    active_session = rehearsal_db.get_active_session(show_id)
    people_rows = rehearsal_db.fetch_all(
        "SELECT id, first_name, last_name, type, role FROM people WHERE show_id = ? ORDER BY type, last_name, first_name",
        (show_id,),
    )

    cast = [p for p in people_rows if p["type"] == "cast"]
    crew = [p for p in people_rows if p["type"] == "crew"]
    groups = rehearsal_db.fetch_all(
        "SELECT id, show_id, name, type FROM groups WHERE show_id = ? ORDER BY type, name",
        (show_id,),
    )
    for g in groups:
        g["member_ids"] = [
            m["person_id"]
            for m in rehearsal_db.fetch_all("SELECT person_id FROM group_members WHERE group_id = ?", (g["id"],))
        ]

    records = []
    if active_session:
        records = rehearsal_db.list_session_records(active_session["id"])

    pre_excused_ids = []
    if today_rehearsal:
        rows = rehearsal_db.fetch_all(
            "SELECT person_id FROM rehearsal_preexcused WHERE rehearsal_id = ?",
            (today_rehearsal["id"],),
        )
        pre_excused_ids = [r["person_id"] for r in rows]

    return jsonify(
        {
            "date": date_value,
            "today_rehearsal": today_rehearsal,
            "active_session": active_session,
            "cast": cast,
            "crew": crew,
            "groups": groups,
            "records": records,
            "pre_excused_ids": pre_excused_ids,
            "no_rehearsal_today": today_rehearsal is None,
        }
    )


@app.route("/api/admin/shows/<int:show_id>/attendance/start", methods=["POST"])
@require_admin
def start_attendance(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    data = request.get_json(silent=True) or {}
    rehearsal_id = data.get("rehearsal_id")
    if rehearsal_id is None:
        today = datetime.now().strftime("%Y-%m-%d")
        rehearsal = rehearsal_db.get_today_rehearsal(show_id, today)
        if not rehearsal:
            return jsonify({"error": "no rehearsal today"}), 400
        rehearsal_id = rehearsal["id"]

    rehearsal = rehearsal_db.fetch_one(
        "SELECT id, show_id, date FROM rehearsals WHERE id = ? AND show_id = ?",
        (int(rehearsal_id), show_id),
    )
    if not rehearsal:
        return jsonify({"error": "rehearsal not found for show"}), 404

    current_active = rehearsal_db.get_active_session(show_id)
    if current_active:
        return jsonify({"error": "attendance session already active", "session": current_active}), 409

    session_id = rehearsal_db.execute(
        "INSERT INTO attendance_sessions(show_id, rehearsal_id, active) VALUES (?, ?, 1)",
        (show_id, rehearsal_id),
    )

    person_rows = rehearsal_db.fetch_all("SELECT id FROM people WHERE show_id = ?", (show_id,))
    pre_excused = {
        row["person_id"]
        for row in rehearsal_db.fetch_all(
            "SELECT person_id FROM rehearsal_preexcused WHERE rehearsal_id = ?",
            (rehearsal_id,),
        )
    }
    inserts = []
    for p in person_rows:
        inserts.append(
            (
                session_id,
                p["id"],
                0,
                1 if p["id"] in pre_excused else 0,
                None,
            )
        )
    if inserts:
        rehearsal_db.execute_many(
            "INSERT INTO attendance_records(session_id, person_id, present, pre_excused, checked_in_at) VALUES (?, ?, ?, ?, ?)",
            inserts,
        )

    session = rehearsal_db.fetch_one(
        "SELECT id, show_id, rehearsal_id, active, created_at FROM attendance_sessions WHERE id = ?",
        (session_id,),
    )
    return jsonify(session), 201


@app.route("/api/admin/shows/<int:show_id>/attendance/stop", methods=["POST"])
@require_admin
def stop_attendance(_user, show_id):
    active = rehearsal_db.get_active_session(show_id)
    if not active:
        return jsonify({"error": "no active session"}), 404

    rehearsal_db.execute(
        "UPDATE attendance_sessions SET active = 0, stopped_at = ? WHERE id = ?",
        (rehearsal_db.now_iso(), active["id"]),
    )
    # Absent is represented by present = 0 for unchecked names.
    return jsonify({"ok": True, "session_id": active["id"]})


@app.route("/api/admin/attendance/records/<int:record_id>", methods=["PATCH"])
@require_admin
def update_record(_user, record_id):
    record = rehearsal_db.fetch_one(
        "SELECT id, present, pre_excused FROM attendance_records WHERE id = ?",
        (record_id,),
    )
    if not record:
        return jsonify({"error": "record not found"}), 404

    data = request.get_json(silent=True) or {}
    present = data.get("present")
    pre_excused = data.get("pre_excused")
    checked_in_at = rehearsal_db.now_iso() if bool(present) else None

    if present is not None:
        rehearsal_db.execute(
            "UPDATE attendance_records SET present = ?, checked_in_at = ? WHERE id = ?",
            (1 if bool(present) else 0, checked_in_at, record_id),
        )
    if pre_excused is not None:
        rehearsal_db.execute(
            "UPDATE attendance_records SET pre_excused = ? WHERE id = ?",
            (1 if bool(pre_excused) else 0, record_id),
        )
    return jsonify({"ok": True})


@app.route("/api/admin/shows/<int:show_id>/attendance/history", methods=["GET"])
@require_admin
def attendance_history(_user, show_id):
    if not _show_exists(show_id):
        return jsonify({"error": "show not found"}), 404

    sessions = rehearsal_db.fetch_all(
        """
        SELECT s.id, s.show_id, s.rehearsal_id, s.active, s.created_at, s.stopped_at,
               r.date, r.start_time, r.end_time
        FROM attendance_sessions s
        JOIN rehearsals r ON r.id = s.rehearsal_id
        WHERE s.show_id = ?
        ORDER BY r.date DESC, s.created_at DESC
        """,
        (show_id,),
    )
    for s in sessions:
        s["records"] = rehearsal_db.list_session_records(s["id"])
    return jsonify(sessions)


@app.route("/api/student/active-session", methods=["GET"])
def student_active_session():
    active = rehearsal_db.get_any_active_session()
    if not active:
        return jsonify({"active": False, "message": "Attendance not active"})

    records = rehearsal_db.list_session_records(active["id"])
    return jsonify(
        {
            "active": True,
            "session": active,
            "people": [
                {
                    "record_id": r["id"],
                    "person_id": r["person_id"],
                    "name": f"{r['first_name']} {r['last_name']}",
                    "type": r["type"],
                    "role": r["role"],
                    "present": bool(r["present"]),
                    "pre_excused": bool(r["pre_excused"]),
                }
                for r in records
            ],
        }
    )


@app.route("/api/student/check-in", methods=["POST"])
def student_check_in():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    person_id = data.get("person_id")
    if session_id is None or person_id is None:
        return jsonify({"error": "session_id and person_id are required"}), 400

    session = rehearsal_db.fetch_one(
        "SELECT id, active FROM attendance_sessions WHERE id = ?",
        (int(session_id),),
    )
    if not session or int(session["active"]) == 0:
        return jsonify({"error": "attendance is not active"}), 400

    rehearsal_db.execute(
        "UPDATE attendance_records SET present = 1, checked_in_at = ? WHERE session_id = ? AND person_id = ?",
        (rehearsal_db.now_iso(), int(session_id), int(person_id)),
    )
    return jsonify({"ok": True})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def static_proxy(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    if path.startswith("api/"):
        abort(404)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
