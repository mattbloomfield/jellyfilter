import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from nudity_detector import DetectedScene
from profanity_detector import DetectedWord

log = logging.getLogger(__name__)


def write_edl(
    output_dir: str,
    jellyfin_id: str,
    media_path: str,
    duration_seconds: float,
    detected: list[DetectedWord],
    nudity_scenes: list[DetectedScene] | None = None,
    padding_before: float = 0.15,
    padding_after: float = 0.15,
) -> Path:
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = []

    for hit in detected:
        entries.append({
            "id": str(uuid.uuid4()),
            "start": max(0.0, round(hit.start - padding_before, 3)),
            "end": round(hit.end + padding_after, 3),
            "type": "mute",
            "category": "profanity",
            "word": hit.word,
            "confidence": round(hit.confidence, 4),
            "source": "whisper-auto",
            "confirmed": False,
        })

    for scene in (nudity_scenes or []):
        entries.append({
            "id": str(uuid.uuid4()),
            "start": round(scene.start, 3),
            "end": round(scene.end, 3),
            "type": "mute",
            "category": "sexual-content",
            "labels": scene.labels,
            "confidence": scene.confidence,
            "source": "nudenet-auto",
            "confirmed": False,
        })

    # Sort all entries by start time
    entries.sort(key=lambda e: e["start"])

    doc = {
        "version": 1,
        "media_id": jellyfin_id,
        "media_path": media_path,
        "duration_seconds": duration_seconds,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }

    out_path = out_dir / f"{jellyfin_id}.jellyfilter.json"
    out_path.write_text(json.dumps(doc, indent=2))
    log.info("Wrote EDL: %s (%d entries)", out_path, len(entries))
    return out_path
