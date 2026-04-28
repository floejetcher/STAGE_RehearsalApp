import os
import sqlite3
from typing import List, Optional, Dict, Any
import item_images

# Allow overriding DB path for containers/platforms; default to local file
DEFAULT_DB = os.path.join(os.path.dirname(__file__), "stage_inventory.db")
DB_PATH = os.getenv("DB_PATH", DEFAULT_DB)

# Ensure directory exists for DB if a custom path is used
db_dir = os.path.dirname(DB_PATH)
if db_dir:
    os.makedirs(db_dir, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _recreate_items_updated_trigger(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TRIGGER IF NOT EXISTS trg_items_updated
        AFTER UPDATE ON items
        FOR EACH ROW
        BEGIN
            UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
        """
    )


def _reset_items_sequence(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'items'")
    except sqlite3.OperationalError:
        # sqlite_sequence may not exist yet on fresh databases.
        pass


def _renumber_item_ids_in_connection(conn: sqlite3.Connection) -> Dict[int, int]:
    rows = conn.execute(
        "SELECT id, name, category, location, grouping_id, in_use, created_at, updated_at FROM items ORDER BY id"
    ).fetchall()

    id_map: Dict[int, int] = {}
    changed = False
    for new_id, row in enumerate(rows, start=1):
        old_id = int(row["id"])
        id_map[old_id] = new_id
        if old_id != new_id:
            changed = True

    if not changed:
        _reset_items_sequence(conn)
        return id_map

    conn.execute("DROP TRIGGER IF EXISTS trg_items_updated")
    conn.execute("DELETE FROM items")

    for row in rows:
        new_id = id_map[int(row["id"])]
        conn.execute(
            """
            INSERT INTO items (id, name, category, location, grouping_id, in_use, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                row["name"],
                row["category"],
                row["location"],
                row["grouping_id"],
                row["in_use"],
                row["created_at"],
                row["updated_at"],
            ),
        )

    # Reset AUTOINCREMENT bookkeeping so next insert continues after max(id).
    _reset_items_sequence(conn)
    _recreate_items_updated_trigger(conn)
    return id_map


def normalize_item_ids() -> Dict[int, int]:
    with get_connection() as conn:
        return _renumber_item_ids_in_connection(conn)


def init_db() -> None:
    """Create the items table if it doesn't exist and run lightweight migrations."""
    with get_connection() as conn:
        default_categories = [
            "General",
            "Lighting",
            "Sound",
            "Props",
            "Costumes",
            "Set",
        ]

        # Items table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'General',
                location TEXT NOT NULL,
                grouping_id INTEGER,
                in_use INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        # Locations table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            """
        )
        # Categories table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            """
        )
        # Groupings table (e.g. bins, shelves) scoped by location.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS groupings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, location)
            );
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_groupings_location
            ON groupings(location);
            """
        )
        # Lightweight migration: ensure 'category' column exists for older DBs
        info = conn.execute("PRAGMA table_info(items)").fetchall()
        cols = {row[1] for row in info}  # second field is name
        if "category" not in cols:
            conn.execute("ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT 'General'")
        if "grouping_id" not in cols:
            conn.execute("ALTER TABLE items ADD COLUMN grouping_id INTEGER")

        # Migration: remove 'crew_tag' column if it exists
        if "crew_tag" in cols:
            conn.execute("ALTER TABLE items RENAME TO items_old")
            conn.execute(
                """
                CREATE TABLE items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'General',
                    location TEXT NOT NULL,
                    grouping_id INTEGER,
                    in_use INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            conn.execute(
                "INSERT INTO items (id, name, category, location, grouping_id, in_use, created_at, updated_at) "
                "SELECT id, name, category, location, NULL, in_use, created_at, updated_at FROM items_old"
            )
            conn.execute("DROP TABLE items_old")
            # Recreate trigger
            conn.execute(
                """
                CREATE TRIGGER IF NOT EXISTS trg_items_updated
                AFTER UPDATE ON items
                FOR EACH ROW
                BEGIN
                    UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
                END;
                """
            )

        # Cleanup migration edge cases: detach references to deleted/non-existent groupings.
        conn.execute(
            """
            UPDATE items
            SET grouping_id = NULL
            WHERE grouping_id IS NOT NULL
              AND grouping_id NOT IN (SELECT id FROM groupings)
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_items_updated
            AFTER UPDATE ON items
            FOR EACH ROW
            BEGIN
                UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
            END;
            """
        )

        # Seed default locations if table is empty
        cur = conn.execute("SELECT COUNT(*) FROM locations")
        if cur.fetchone()[0] == 0:
            defaults = [
                ("West Campus Basement Storage",),
                ("East Campus Basement Storage",),
                ("East Campus Theatre Closet",),
            ]
            conn.executemany("INSERT OR IGNORE INTO locations(name) VALUES (?)", defaults)

        # Ensure default and existing item categories are available in managed categories.
        conn.executemany(
            "INSERT OR IGNORE INTO categories(name) VALUES (?)",
            [(c,) for c in default_categories],
        )
        existing_item_categories = conn.execute(
            "SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND TRIM(category) <> ''"
        ).fetchall()
        if existing_item_categories:
            conn.executemany(
                "INSERT OR IGNORE INTO categories(name) VALUES (?)",
                [(row[0],) for row in existing_item_categories],
            )


def add_item(
    name: str,
    category: str,
    location: str,
    in_use: bool = False,
    grouping_id: Optional[int] = None,
) -> int:
    with get_connection() as conn:
        if category and category.strip():
            conn.execute("INSERT OR IGNORE INTO categories(name) VALUES (?)", (category.strip(),))
        cur = conn.execute(
            "INSERT INTO items (name, category, location, grouping_id, in_use) VALUES (?, ?, ?, ?, ?)",
            (name, category, location, grouping_id, 1 if in_use else 0),
        )
        return cur.lastrowid


def update_item(
    item_id: int,
    name: str,
    category: str,
    location: str,
    in_use: bool,
    grouping_id: Optional[int] = None,
) -> None:
    with get_connection() as conn:
        if category and category.strip():
            conn.execute("INSERT OR IGNORE INTO categories(name) VALUES (?)", (category.strip(),))
        conn.execute(
            "UPDATE items SET name = ?, category = ?, location = ?, grouping_id = ?, in_use = ? WHERE id = ?",
            (name, category, location, grouping_id, 1 if in_use else 0, item_id),
        )


def set_in_use(item_id: int, in_use: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE items SET in_use = ? WHERE id = ?", (1 if in_use else 0, item_id))


def delete_item(item_id: int) -> Dict[int, int]:
    with get_connection() as conn:
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        return _renumber_item_ids_in_connection(conn)


def get_item(item_id: int) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_items(
    name_query: Optional[str] = None,
    categories: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    locations: Optional[List[str]] = None,
    in_use: Optional[bool] = None,
    grouping_id: Optional[int] = None,
    ungrouped_only: bool = False,
) -> List[Dict[str, Any]]:
    """Return items matching optional filters."""
    where = []
    params: List[Any] = []

    if name_query:
        where.append("LOWER(name) LIKE ?")
        params.append(f"%{name_query.lower()}%")

    if categories:
        where.append(f"category IN ({','.join(['?'] * len(categories))})")
        params.extend(categories)

    if locations:
        where.append(f"items.location IN ({','.join(['?'] * len(locations))})")
        params.extend(locations)

    if in_use is not None:
        where.append("in_use = ?")
        params.append(1 if in_use else 0)

    if ungrouped_only:
        where.append("items.grouping_id IS NULL")
    elif grouping_id is not None:
        where.append("items.grouping_id = ?")
        params.append(grouping_id)

    sql = (
        "SELECT "
        "items.id, items.name, items.category, items.location, items.grouping_id, "
        "groupings.name AS grouping_name, "
        "items.in_use, items.created_at, items.updated_at "
        "FROM items "
        "LEFT JOIN groupings ON groupings.id = items.grouping_id"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)

    sql += " ORDER BY items.id"

    with get_connection() as conn:
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        # Normalize SQLite ints to Python bools for in_use
        for r in rows:
            r["in_use"] = bool(r["in_use"])
        return rows


def get_grouping(grouping_id: int) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, name, location, created_at FROM groupings WHERE id = ?",
            (grouping_id,),
        ).fetchone()
        return dict(row) if row else None


def list_groupings(location: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = (
        "SELECT "
        "g.id, g.name, g.location, g.created_at, "
        "COUNT(i.id) AS item_count "
        "FROM groupings g "
        "LEFT JOIN items i ON i.grouping_id = g.id"
    )
    params: List[Any] = []
    if location:
        sql += " WHERE g.location = ?"
        params.append(location)
    sql += " GROUP BY g.id, g.name, g.location, g.created_at"
    sql += " ORDER BY g.location COLLATE NOCASE, g.name COLLATE NOCASE"

    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def add_grouping(name: str, location: str) -> Optional[Dict[str, Any]]:
    normalized_name = (name or "").strip()
    normalized_location = (location or "").strip()
    if not normalized_name or not normalized_location:
        return None

    with get_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO groupings(name, location) VALUES (?, ?)",
                (normalized_name, normalized_location),
            )
        except sqlite3.IntegrityError:
            return None

        row = conn.execute(
            "SELECT id, name, location, created_at FROM groupings WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        return dict(row) if row else None


def update_grouping(grouping_id: int, name: str, location: str) -> str:
    normalized_name = (name or "").strip()
    normalized_location = (location or "").strip()
    if not normalized_name or not normalized_location:
        return "invalid"

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM groupings WHERE id = ?", (grouping_id,)).fetchone()
        if not existing:
            return "not_found"

        try:
            conn.execute(
                "UPDATE groupings SET name = ?, location = ? WHERE id = ?",
                (normalized_name, normalized_location, grouping_id),
            )
        except sqlite3.IntegrityError:
            return "conflict"

        # Keep item location consistent with grouping location if grouping was moved.
        conn.execute(
            "UPDATE items SET location = ? WHERE grouping_id = ?",
            (normalized_location, grouping_id),
        )
        return "ok"


def delete_grouping(grouping_id: int) -> bool:
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM groupings WHERE id = ?", (grouping_id,)).fetchone()
        if not existing:
            return False

        # Deleting a grouping only detaches items; it never deletes items.
        conn.execute("UPDATE items SET grouping_id = NULL WHERE grouping_id = ?", (grouping_id,))
        conn.execute("DELETE FROM groupings WHERE id = ?", (grouping_id,))
        return True


def get_locations() -> List[str]:
    with get_connection() as conn:
        # Prefer managed locations table, fall back to distinct from items for legacy
        cur = conn.execute("SELECT name FROM locations ORDER BY name COLLATE NOCASE")
        rows = [r[0] for r in cur.fetchall()]
        if rows:
            return rows
        cur = conn.execute("SELECT DISTINCT location FROM items ORDER BY location COLLATE NOCASE")
        return [r[0] for r in cur.fetchall()]


def get_tags() -> List[str]:
    with get_connection() as conn:
        info = conn.execute("PRAGMA table_info(items)").fetchall()
        cols = {row[1] for row in info}
        if "crew_tag" not in cols:
            # crew_tag was removed in a migration; preserve compatibility for callers.
            return []

        cur = conn.execute("SELECT DISTINCT crew_tag FROM items ORDER BY crew_tag COLLATE NOCASE")
        return [r[0] for r in cur.fetchall()]

def get_categories() -> List[str]:
    with get_connection() as conn:
        cur = conn.execute("SELECT name FROM categories ORDER BY name COLLATE NOCASE")
        rows = [r[0] for r in cur.fetchall()]
        if rows:
            return rows
        cur = conn.execute("SELECT DISTINCT category FROM items ORDER BY category COLLATE NOCASE")
        return [r[0] for r in cur.fetchall()]


def add_category(name: str) -> bool:
    normalized = (name or "").strip()
    if not normalized:
        return False

    with get_connection() as conn:
        cur = conn.execute("INSERT OR IGNORE INTO categories(name) VALUES (?)", (normalized,))
        return cur.rowcount > 0


def rename_category(old_name: str, new_name: str) -> str:
    old_name = (old_name or "").strip()
    new_name = (new_name or "").strip()
    if not old_name or not new_name:
        return "invalid"

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM categories WHERE name = ?", (old_name,)).fetchone()
        if not existing:
            return "not_found"

        # If target already exists, merge item references and remove the old category row.
        target = conn.execute("SELECT id FROM categories WHERE name = ?", (new_name,)).fetchone()
        if target:
            conn.execute("UPDATE items SET category = ? WHERE category = ?", (new_name, old_name))
            conn.execute("DELETE FROM categories WHERE name = ?", (old_name,))
            return "ok"

        conn.execute("UPDATE categories SET name = ? WHERE name = ?", (new_name, old_name))
        conn.execute("UPDATE items SET category = ? WHERE category = ?", (new_name, old_name))
        return "ok"


def delete_category(name: str) -> str:
    normalized = (name or "").strip()
    if not normalized:
        return "invalid"

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM categories WHERE name = ?", (normalized,)).fetchone()
        if not existing:
            return "not_found"

        item_count = conn.execute("SELECT COUNT(*) FROM items WHERE category = ?", (normalized,)).fetchone()[0]
        if item_count > 0:
            return "not_empty"

        conn.execute("DELETE FROM categories WHERE name = ?", (normalized,))
        return "ok"


def add_location(name: str) -> None:
    name = name.strip()
    if not name:
        return
    with get_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO locations(name) VALUES (?)", (name,))


def rename_location(old_name: str, new_name: str) -> bool:
    old_name = (old_name or "").strip()
    new_name = (new_name or "").strip()
    if not old_name or not new_name:
        return False

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM locations WHERE name = ?", (old_name,)).fetchone()
        if not existing:
            return False

        # If the target name already exists, merge references and remove old location.
        if conn.execute("SELECT id FROM locations WHERE name = ?", (new_name,)).fetchone():
            old_groupings = conn.execute(
                "SELECT id, name FROM groupings WHERE location = ?",
                (old_name,),
            ).fetchall()
            for old_grouping in old_groupings:
                target_grouping = conn.execute(
                    "SELECT id FROM groupings WHERE location = ? AND name = ?",
                    (new_name, old_grouping["name"]),
                ).fetchone()
                if target_grouping:
                    conn.execute(
                        "UPDATE items SET grouping_id = ? WHERE grouping_id = ?",
                        (target_grouping["id"], old_grouping["id"]),
                    )
                    conn.execute("DELETE FROM groupings WHERE id = ?", (old_grouping["id"],))
                else:
                    conn.execute(
                        "UPDATE groupings SET location = ? WHERE id = ?",
                        (new_name, old_grouping["id"]),
                    )

            conn.execute("UPDATE items SET location = ? WHERE location = ?", (new_name, old_name))
            conn.execute("DELETE FROM locations WHERE name = ?", (old_name,))
            return True

        conn.execute("UPDATE locations SET name = ? WHERE name = ?", (new_name, old_name))
        conn.execute("UPDATE groupings SET location = ? WHERE location = ?", (new_name, old_name))
        conn.execute("UPDATE items SET location = ? WHERE location = ?", (new_name, old_name))
        return True
