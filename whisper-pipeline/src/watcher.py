import logging
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileMovedEvent
from watchdog.observers import Observer

import db

log = logging.getLogger(__name__)

MEDIA_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".ts", ".flv"}


def _should_process(path: str) -> bool:
    return Path(path).suffix.lower() in MEDIA_EXTENSIONS


class MediaHandler(FileSystemEventHandler):
    def on_created(self, event: FileCreatedEvent):
        if event.is_directory:
            return
        if _should_process(event.src_path):
            if db.enqueue(event.src_path):
                log.info("Queued new file: %s", event.src_path)

    def on_moved(self, event: FileMovedEvent):
        if event.is_directory:
            return
        if _should_process(event.dest_path):
            if db.enqueue(event.dest_path):
                log.info("Queued moved file: %s", event.dest_path)


def scan_existing(media_paths: list[str]):
    """Enqueue all existing media files not yet in the database."""
    log.info("Starting background scan of %d path(s)…", len(media_paths))
    found = []
    for root in media_paths:
        try:
            for p in Path(root).rglob("*"):
                # Check suffix first (no I/O) before calling is_file() over NFS
                if p.suffix.lower() in MEDIA_EXTENSIONS and p.is_file():
                    found.append(str(p))
        except Exception:
            log.exception("Error scanning %s", root)

    added = db.enqueue_batch(found)
    log.info("Initial scan complete: %d files found, %d newly queued", len(found), added)


def start_watcher(media_paths: list[str]) -> Observer:
    handler = MediaHandler()
    observer = Observer()
    for path in media_paths:
        observer.schedule(handler, path, recursive=True)
        log.info("Watching: %s", path)
    observer.start()
    return observer
