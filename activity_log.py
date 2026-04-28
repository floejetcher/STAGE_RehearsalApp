import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


ACTIVITY_LOG_PATH = os.getenv("ACTIVITY_LOG_PATH", os.path.join(os.path.dirname(__file__), "activity_log.json"))


def _ensure_file() -> None:
    parent = os.path.dirname(ACTIVITY_LOG_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if not os.path.exists(ACTIVITY_LOG_PATH):
        with open(ACTIVITY_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump({"activities": []}, f, indent=2)
            f.write("\n")


def _load() -> Dict[str, Any]:
    _ensure_file()
    with open(ACTIVITY_LOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: Dict[str, Any]) -> None:
    with open(ACTIVITY_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def add_activity(
    username: str,
    role: str,
    action: str,
    item_id: Optional[int],
    item_name: str,
    details: str = "",
) -> Dict[str, Any]:
    data = _load()
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "username": username or "unknown",
        "role": (role or "guest").lower(),
        "action": action,
        "item_id": item_id,
        "item_name": item_name or "",
        "details": details or "",
    }
    data.setdefault("activities", []).append(entry)
    _save(data)
    return entry


def list_activities(limit: int = 200) -> List[Dict[str, Any]]:
    data = _load()
    activities = data.get("activities", [])
    activities.sort(key=lambda a: a.get("ts", ""), reverse=True)
    if limit and limit > 0:
        return activities[:limit]
    return activities


def clear_activities() -> int:
    data = _load()
    removed = len(data.get("activities", []))
    data["activities"] = []
    _save(data)
    return removed
