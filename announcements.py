import os
import json
import uuid
from datetime import datetime, timezone

ANN_PATH = os.getenv("ANNOUNCEMENTS_PATH", os.path.join(os.path.dirname(__file__), "announcements.json"))

def _ensure_file():
    parent = os.path.dirname(ANN_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if not os.path.exists(ANN_PATH):
        with open(ANN_PATH, "w", encoding="utf-8") as f:
            json.dump({"announcements": [
                {
                    "id": "seed",
                    "text": "Welcome to STAGE Inventory! Use this board for quick updates.",
                    "author": "System",
                    "ts": datetime.now(timezone.utc).isoformat()
                }
            ]}, f, indent=2)

def _load() -> dict:
    _ensure_file()
    with open(ANN_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def _save(data: dict):
    with open(ANN_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def load_announcements(limit: int | None = 5):
    data = _load()
    anns = data.get("announcements", [])
    anns.sort(key=lambda a: a.get("ts", ""), reverse=True)
    return anns[:limit] if limit else anns

def add_announcement(text: str, author: str):
    data = _load()
    data.setdefault("announcements", []).append({
        "id": uuid.uuid4().hex,
        "text": text,
        "author": author,
        "ts": datetime.now(timezone.utc).isoformat()
    })
    _save(data)

def delete_announcement(ann_id: str):
    data = _load()
    data["announcements"] = [a for a in data.get("announcements", []) if a.get("id") != ann_id]
    _save(data)

def update_announcement(ann_id: str, text: str):
    data = _load()
    for a in data.get("announcements", []):
        if a.get("id") == ann_id:
            a["text"] = text
            a["ts"] = datetime.now(timezone.utc).isoformat()  # update timestamp
            break
    _save(data)