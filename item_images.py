import os
import json
import uuid
from typing import Optional, Dict

# Allow overriding upload directory for containers/platforms
BASE_DIR = os.getenv("UPLOAD_FOLDER", os.path.join(os.path.dirname(__file__), "item_images"))
IMAGES_DIR = BASE_DIR
ITEM_MAP_PATH = os.path.join(BASE_DIR, "item_images.json")
GROUPING_MAP_PATH = os.path.join(BASE_DIR, "grouping_images.json")

def _ensure_dirs():
    os.makedirs(IMAGES_DIR, exist_ok=True)
    if not os.path.exists(ITEM_MAP_PATH):
        with open(ITEM_MAP_PATH, "w", encoding="utf-8") as f:
            json.dump({}, f)
    if not os.path.exists(GROUPING_MAP_PATH):
        with open(GROUPING_MAP_PATH, "w", encoding="utf-8") as f:
            json.dump({}, f)

def _load_map(map_path: str) -> Dict[str, str]:
    _ensure_dirs()
    with open(map_path, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_map(map_path: str, mapping: Dict[str, str]):
    with open(map_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)

def _get_upload_name(uploaded_file) -> str:
    # Flask/Werkzeug uses .filename, Streamlit UploadedFile uses .name.
    return str(getattr(uploaded_file, "filename", None) or getattr(uploaded_file, "name", ""))

def _infer_extension(uploaded_file) -> str:
    ext = os.path.splitext(_get_upload_name(uploaded_file))[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
        ext = ".png"
    return ext

def _get_image(map_path: str, entity_id: int) -> Optional[str]:
    mapping = _load_map(map_path)
    path = mapping.get(str(entity_id))
    return path if path and os.path.exists(path) else None

def _save_image(map_path: str, prefix: str, entity_id: int, uploaded_file) -> str:
    _ensure_dirs()
    ext = _infer_extension(uploaded_file)
    filename = f"{prefix}_{entity_id}_{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(IMAGES_DIR, filename)

    # uploaded_file may be Streamlit UploadedFile or Flask/Werkzeug FileStorage
    try:
        data = uploaded_file.getbuffer()
        with open(dest_path, "wb") as out:
            out.write(data)
    except Exception:
        try:
            data = uploaded_file.read()
            with open(dest_path, "wb") as out:
                out.write(data)
        except Exception:
            path_like = _get_upload_name(uploaded_file)
            if path_like and os.path.exists(path_like):
                with open(path_like, "rb") as src, open(dest_path, "wb") as out:
                    out.write(src.read())
            else:
                raise

    mapping = _load_map(map_path)
    old = mapping.get(str(entity_id))
    if old and os.path.exists(old) and old != dest_path:
        try:
            os.remove(old)
        except OSError:
            pass
    mapping[str(entity_id)] = dest_path
    _save_map(map_path, mapping)
    return dest_path

def _remove_image(map_path: str, entity_id: int):
    mapping = _load_map(map_path)
    old = mapping.pop(str(entity_id), None)
    if old and os.path.exists(old):
        try:
            os.remove(old)
        except OSError:
            pass
    _save_map(map_path, mapping)

def get_item_image(item_id: int) -> Optional[str]:
    return _get_image(ITEM_MAP_PATH, item_id)

def has_item_image(item_id: int) -> bool:
    return get_item_image(item_id) is not None

def save_item_image(item_id: int, uploaded_file) -> str:
    return _save_image(ITEM_MAP_PATH, "item", item_id, uploaded_file)

def remove_item_image(item_id: int):
    _remove_image(ITEM_MAP_PATH, item_id)


def get_grouping_image(grouping_id: int) -> Optional[str]:
    return _get_image(GROUPING_MAP_PATH, grouping_id)


def has_grouping_image(grouping_id: int) -> bool:
    return get_grouping_image(grouping_id) is not None


def save_grouping_image(grouping_id: int, uploaded_file) -> str:
    return _save_image(GROUPING_MAP_PATH, "grouping", grouping_id, uploaded_file)


def remove_grouping_image(grouping_id: int):
    _remove_image(GROUPING_MAP_PATH, grouping_id)


def remap_item_ids(id_map: Dict[int, int]) -> None:
    if not id_map:
        return

    mapping = _load_map(ITEM_MAP_PATH)
    remapped: Dict[str, str] = {}

    for key, path in mapping.items():
        try:
            old_id = int(key)
        except ValueError:
            continue
        new_id = id_map.get(old_id, old_id)
        remapped[str(new_id)] = path

    _save_map(ITEM_MAP_PATH, remapped)