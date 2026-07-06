import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

DB_PATH = Path("/mnt/nfs-media/jellyfilter/jellyfilter.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_path      TEXT    NOT NULL UNIQUE,
    jellyfin_id     TEXT,
    status          TEXT    NOT NULL DEFAULT 'new',  -- new | processing | done | failed
    added_at        REAL    NOT NULL,
    started_at      REAL,
    finished_at     REAL,
    error_message   TEXT,
    word_count      INTEGER,
    hit_count       INTEGER
);

CREATE TABLE IF NOT EXISTS transcripts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_path      TEXT    NOT NULL UNIQUE,
    transcript_text TEXT,
    word_tokens     TEXT,   -- JSON array of {word, start, end} — full per-word timestamped data
    created_at      REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_jellyfin_id ON queue(jellyfin_id);
"""

MIGRATIONS = [
    # Add word_tokens column to existing DBs that predate it
    "ALTER TABLE transcripts ADD COLUMN word_tokens TEXT",
]


@contextmanager
def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(SCHEMA)
        for migration in MIGRATIONS:
            try:
                conn.execute(migration)
                conn.commit()
            except sqlite3.OperationalError:
                pass  # column already exists
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def enqueue(media_path: str) -> bool:
    """Add a file to the queue. Returns True if newly added, False if already present."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT status FROM queue WHERE media_path = ?", (media_path,)
        ).fetchone()
        if existing:
            return False
        conn.execute(
            "INSERT INTO queue (media_path, status, added_at) VALUES (?, 'new', ?)",
            (media_path, time.time()),
        )
        return True


def pop_next() -> Optional[sqlite3.Row]:
    """Claim and return the next 'new' item, marking it 'processing'."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM queue WHERE status = 'new' ORDER BY added_at LIMIT 1"
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE queue SET status = 'processing', started_at = ? WHERE id = ?",
                (time.time(), row["id"]),
            )
        return row


def mark_done(media_path: str, jellyfin_id: Optional[str], hit_count: int, word_count: int):
    with get_conn() as conn:
        conn.execute(
            """UPDATE queue SET status='done', finished_at=?, jellyfin_id=?,
               hit_count=?, word_count=? WHERE media_path=?""",
            (time.time(), jellyfin_id, hit_count, word_count, media_path),
        )


def mark_failed(media_path: str, error: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE queue SET status='failed', finished_at=?, error_message=? WHERE media_path=?",
            (time.time(), error, media_path),
        )


def save_transcript(media_path: str, segments_json: str, word_tokens_json: str):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO transcripts (media_path, transcript_text, word_tokens, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(media_path) DO UPDATE SET
                   transcript_text=excluded.transcript_text,
                   word_tokens=excluded.word_tokens""",
            (media_path, segments_json, word_tokens_json, time.time()),
        )


def get_all_queue() -> list:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM queue
               ORDER BY CASE status WHEN 'processing' THEN 0 WHEN 'new' THEN 1
                                    WHEN 'done' THEN 2 ELSE 3 END,
                        added_at ASC
               LIMIT 500"""
        ).fetchall()
        return [dict(r) for r in rows]


def get_status(media_path: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM queue WHERE media_path = ?", (media_path,)
        ).fetchone()
        return dict(row) if row else None


def reset_stale_processing():
    """On startup, reset any items stuck in 'processing' (prior crash)."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE queue SET status='new', started_at=NULL WHERE status='processing'"
        )
