"""Saved worlds, kept in a local SQLite file.

This is the only module that knows where saves live. To host the app with a
real database server later, replace SaveStore with a class offering the same
five methods.
"""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

AUTOSAVE_NAME = "Autosave"

SCHEMA = """
CREATE TABLE IF NOT EXISTS saves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    autosave   INTEGER NOT NULL DEFAULT 0,
    seed       INTEGER NOT NULL,
    tick       INTEGER NOT NULL,
    data       TEXT    NOT NULL,  -- the world, as JSON text
    updated_at TEXT    NOT NULL   -- UTC, ISO 8601
);
"""

SUMMARY_COLUMNS = "id, name, autosave, seed, tick, updated_at"


def _summary(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "autosave": bool(row["autosave"]),
        "seed": row["seed"],
        "tick": row["tick"],
        "updated_at": row["updated_at"],
    }


class SaveStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.executescript(SCHEMA)

    def _connect(self):
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        return db

    def list(self):
        """Every save without its data: the autosave first, then newest first."""
        with closing(self._connect()) as db:
            rows = db.execute(
                f"SELECT {SUMMARY_COLUMNS} FROM saves ORDER BY autosave DESC, updated_at DESC, id DESC"
            ).fetchall()
        return [_summary(row) for row in rows]

    def get(self, save_id):
        """One save as (summary, data_text), or None if there is no such save."""
        with closing(self._connect()) as db:
            row = db.execute(f"SELECT {SUMMARY_COLUMNS}, data FROM saves WHERE id = ?", (save_id,)).fetchone()
        return (_summary(row), row["data"]) if row else None

    def get_autosave(self):
        """The autosave as (summary, data_text), or None if there is none yet."""
        with closing(self._connect()) as db:
            row = db.execute(f"SELECT {SUMMARY_COLUMNS}, data FROM saves WHERE autosave = 1").fetchone()
        return (_summary(row), row["data"]) if row else None

    def put(self, name, seed, tick, data_text):
        """Creates the save called `name`, or overwrites it. Returns its summary."""
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with closing(self._connect()) as db, db:
            db.execute(
                """
                INSERT INTO saves (name, autosave, seed, tick, data, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    seed = excluded.seed, tick = excluded.tick,
                    data = excluded.data, updated_at = excluded.updated_at
                """,
                (name, int(name == AUTOSAVE_NAME), seed, tick, data_text, now),
            )
            row = db.execute(f"SELECT {SUMMARY_COLUMNS} FROM saves WHERE name = ?", (name,)).fetchone()
        return _summary(row)

    def delete(self, save_id):
        """Deletes a save. Returns whether it existed."""
        with closing(self._connect()) as db, db:
            return db.execute("DELETE FROM saves WHERE id = ?", (save_id,)).rowcount > 0
