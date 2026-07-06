import sqlite3
import threading
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
    hit_count       INTEGER,
    retry_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transcripts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_path      TEXT    NOT NULL UNIQUE,
    transcript_text TEXT,
    word_tokens     TEXT,   -- JSON array of {word, start, end}
    created_at      REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_jellyfin_id ON queue(jellyfin_id);
"""

MIGRATIONS = [
    "ALTER TABLE transcripts ADD COLUMN word_tokens TEXT",
    "ALTER TABLE queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
]

# Serialize pop_next across threads so two workers can't claim the same item.
_pop_lock = threading.Lock()


@contextmanager
def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # concurrent readers + one writer
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


def enqueue_batch(paths: list[str]) -> int:
    """Enqueue multiple files in a single transaction. Returns number newly added."""
    if not paths:
        return 0
    with get_conn() as conn:
        existing = {
            row[0] for row in conn.execute("SELECT media_path FROM queue").fetchall()
        }
        now = time.time()
        new_paths = [(p, now) for p in paths if p not in existing]
        if new_paths:
            conn.executemany(
                "INSERT INTO queue (media_path, status, added_at) VALUES (?, 'new', ?)",
                new_paths,
            )
        return len(new_paths)


def pop_next() -> Optional[sqlite3.Row]:
    """Claim and return the next 'new' item, marking it 'processing'. Thread-safe."""
    with _pop_lock:
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
            """UPDATE queue SET status='failed', finished_at=?, error_message=?,
               retry_count = retry_count + 1 WHERE media_path=?""",
            (time.time(), error, media_path),
        )


def retry_item(media_path: str) -> bool:
    """Reset a failed item back to 'new' so it will be reprocessed."""
    with get_conn() as conn:
        result = conn.execute(
            """UPDATE queue SET status='new', started_at=NULL, finished_at=NULL,
               error_message=NULL WHERE media_path=? AND status='failed'""",
            (media_path,),
        )
        return result.rowcount > 0


def retry_by_id(queue_id: int) -> bool:
    """Reset a failed item by queue row id."""
    with get_conn() as conn:
        result = conn.execute(
            """UPDATE queue SET status='new', started_at=NULL, finished_at=NULL,
               error_message=NULL WHERE id=? AND status='failed'""",
            (queue_id,),
        )
        return result.rowcount > 0


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


def get_avg_processing_seconds() -> Optional[float]:
    """Average wall-clock processing time for recently completed items."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT AVG(finished_at - started_at) as avg_secs FROM queue
               WHERE status='done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
               ORDER BY finished_at DESC LIMIT 20"""
        ).fetchone()
        return row["avg_secs"] if row and row["avg_secs"] else None


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
