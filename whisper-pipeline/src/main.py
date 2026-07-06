import logging
import os
import signal
import sys
import time
from pathlib import Path

import yaml

import db
from api_server import start_api_server
from edl_writer import write_edl
from jellyfin_client import JellyfinClient
from nudity_detector import detect_nudity
from profanity_detector import detect_profanity
from transcriber import transcribe
from watcher import scan_existing, start_watcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("jellyfilter")

_shutdown = False


def _handle_signal(sig, frame):
    global _shutdown
    log.info("Shutdown signal received.")
    _shutdown = True


def load_config(path: str = "/config/config.yaml") -> dict:
    with open(path) as f:
        cfg = yaml.safe_load(f)
    # Allow env var overrides
    if api_key := os.environ.get("JELLYFIN_API_KEY"):
        cfg.setdefault("jellyfin", {})["api_key"] = api_key
    return cfg


def process_one(cfg: dict, jellyfin: JellyfinClient) -> bool:
    """Process a single queued item. Returns True if something was processed."""
    row = db.pop_next()
    if row is None:
        return False

    media_path = row["media_path"]
    log.info("Processing: %s", media_path)

    try:
        w = cfg["whisper"]
        word_tokens, full_text, segments = transcribe(
            media_path,
            model_name=w.get("model", "small.en"),
            device=w.get("device", "cpu"),
            compute_type=w.get("compute_type", "int8"),
        )

        import json as _json
        db.save_transcript(
            media_path,
            segments_json=_json.dumps(segments),
            word_tokens_json=_json.dumps(word_tokens),
        )

        detected = detect_profanity(word_tokens)

        nudity_cfg = cfg.get("nudity", {})
        nudity_scenes = []
        if nudity_cfg.get("enabled", False):
            nudity_scenes = detect_nudity(
                media_path,
                frame_rate=nudity_cfg.get("frame_rate", 1.0),
                confidence_threshold=nudity_cfg.get("confidence_threshold", 0.5),
                min_scene_duration=nudity_cfg.get("min_scene_duration", 1.0),
                merge_gap=nudity_cfg.get("merge_gap", 3.0),
            )

        jellyfin_id = jellyfin.resolve_item_id(media_path)
        if not jellyfin_id:
            log.warning("Could not resolve Jellyfin ID for %s — using path hash as fallback", media_path)
            import hashlib
            jellyfin_id = hashlib.md5(media_path.encode()).hexdigest()

        duration = jellyfin.get_duration(jellyfin_id) if jellyfin_id else None
        if not duration:
            # Estimate from transcript: last word end time
            duration = word_tokens[-1]["end"] + 5.0 if word_tokens else 0.0

        p = cfg.get("profanity", {})
        write_edl(
            output_dir=cfg["metadata_dir"],
            jellyfin_id=jellyfin_id,
            media_path=media_path,
            duration_seconds=duration,
            detected=detected,
            nudity_scenes=nudity_scenes,
            padding_before=p.get("padding_before", 0.15),
            padding_after=p.get("padding_after", 0.15),
        )

        hit_count = len(detected) + len(nudity_scenes)
        db.mark_done(media_path, jellyfin_id, hit_count=hit_count, word_count=len(word_tokens))
        log.info("Done: %s — %d profanity hits, %d nudity scenes", media_path, len(detected), len(nudity_scenes))

    except Exception as exc:
        log.exception("Failed to process %s", media_path)
        db.mark_failed(media_path, str(exc))

    return True


def main():
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    cfg_path = os.environ.get("CONFIG_PATH", "/config/config.yaml")
    cfg = load_config(cfg_path)

    db.reset_stale_processing()
    start_api_server()

    jellyfin = JellyfinClient(
        base_url=cfg["jellyfin"]["base_url"],
        api_key=cfg["jellyfin"].get("api_key", ""),
    )

    # Prefer paths from preferences.json (_pipeline key) over config.yaml
    import json as _json2
    _prefs_file = Path("/mnt/nfs-media/jellyfilter/preferences.json")
    if _prefs_file.exists():
        try:
            _prefs = _json2.loads(_prefs_file.read_text())
            media_paths = _prefs.get("_pipeline", {}).get("media_paths") or cfg.get("media_paths", [])
        except Exception:
            media_paths = cfg.get("media_paths", [])
    else:
        media_paths = cfg.get("media_paths", [])
    scan_existing(media_paths)
    observer = start_watcher(media_paths)

    log.info("JellyFilter whisper pipeline started.")

    try:
        while not _shutdown:
            processed = process_one(cfg, jellyfin)
            if not processed:
                time.sleep(10)  # idle poll
    finally:
        observer.stop()
        observer.join()
        log.info("Shutdown complete.")


if __name__ == "__main__":
    main()
