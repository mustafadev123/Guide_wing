"""SQLite persistence.

One connection guarded by one re-entrant lock. Every lifecycle change runs as a
single transaction while holding the lock, so cancel/dispatch/accept races are
serialized and a terminal state can never be overwritten.
"""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    armed INTEGER NOT NULL DEFAULT 0,
    pause_reason TEXT,
    route_id TEXT NOT NULL,
    route_progress REAL NOT NULL DEFAULT 0,
    progress_updated_at TEXT,
    device_location_json TEXT,
    version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    request_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    request_source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    dispatch_at TEXT NOT NULL,
    dispatched_at TEXT,
    acknowledged_at TEXT,
    cancelled_at TEXT,
    resolved_at TEXT,
    updated_at TEXT NOT NULL,
    location_json TEXT NOT NULL,
    snapshot_path TEXT,
    responder TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    on_my_way_at TEXT,          -- responder progress update; status stays 'acknowledged'
    responder_token_hash TEXT   -- SHA-256 of the token returned only to the accepting client
);
-- At most one nonterminal incident per journey, enforced by the database too.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_incident_per_journey
    ON incidents(journey_id) WHERE status IN ('pending', 'dispatched', 'acknowledged');
CREATE TABLE IF NOT EXISTS incident_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    detail TEXT
);
"""


class Database:
    def __init__(self, path: Path | str):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Additive columns for databases created by earlier versions; existing rows keep NULL."""
        have = {r["name"] for r in self.conn.execute("PRAGMA table_info(incidents)")}
        for column in ("on_my_way_at", "responder_token_hash"):
            if column not in have:
                self.conn.execute(f"ALTER TABLE incidents ADD COLUMN {column} TEXT")

    @contextmanager
    def transaction(self):
        """Serialize with the lock and commit/rollback atomically."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    def get_meta(self, key: str) -> str | None:
        row = self.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else None

    def close(self) -> None:
        with self.lock:
            self.conn.close()
