import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

log = logging.getLogger(__name__)

try:
    from nudenet import NudeDetector as _NudeDetector
    _NUDENET_AVAILABLE = True
except ImportError:
    _NUDENET_AVAILABLE = False

_detector_instance = None

# NudeNet v3 labels that indicate sexual content, grouped by severity
_FLAGGED_LABELS = {
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "BUTTOCKS_EXPOSED",
}


@dataclass
class DetectedScene:
    start: float
    end: float
    confidence: float
    labels: list[str] = field(default_factory=list)


def _get_detector():
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = _NudeDetector()
    return _detector_instance


def detect_nudity(
    media_path: str,
    frame_rate: float = 1.0,
    confidence_threshold: float = 0.5,
    min_scene_duration: float = 1.0,
    merge_gap: float = 3.0,
) -> List[DetectedScene]:
    """
    Extract frames from media_path and run NudeNet on each.

    Returns a list of DetectedScene objects representing time ranges where
    explicit visual content was detected.

    frame_rate: frames per second to extract (1.0 is usually sufficient)
    confidence_threshold: minimum NudeNet score to count as a hit
    min_scene_duration: drop scenes shorter than this many seconds (noise filter)
    merge_gap: merge consecutive scenes separated by less than this many seconds
    """
    if not _NUDENET_AVAILABLE:
        log.warning("nudenet not installed — skipping nudity detection for %s", media_path)
        return []

    detector = _get_detector()

    with tempfile.TemporaryDirectory() as tmpdir:
        frame_pattern = os.path.join(tmpdir, "frame_%06d.jpg")
        cmd = [
            "ffmpeg", "-i", media_path,
            "-vf", f"fps={frame_rate}",
            "-q:v", "5",
            "-an",
            frame_pattern,
            "-hide_banner", "-loglevel", "error",
        ]
        try:
            subprocess.run(cmd, check=True, timeout=7200)
        except subprocess.CalledProcessError as e:
            log.error("ffmpeg frame extraction failed for %s: %s", media_path, e)
            return []
        except subprocess.TimeoutExpired:
            log.error("ffmpeg frame extraction timed out for %s", media_path)
            return []

        frame_files = sorted(Path(tmpdir).glob("frame_*.jpg"))
        if not frame_files:
            log.warning("No frames extracted from %s", media_path)
            return []

        log.info("Extracted %d frames from %s — running NudeNet...", len(frame_files), media_path)

        # (timestamp_seconds, max_confidence, list_of_labels)
        positive_frames: list[tuple[float, float, list[str]]] = []

        for frame_file in frame_files:
            frame_num = int(frame_file.stem.split("_")[1])  # 1-indexed
            timestamp = (frame_num - 1) / frame_rate

            try:
                detections = detector.detect(str(frame_file))
            except Exception as exc:
                log.debug("NudeNet skipped frame %s: %s", frame_file.name, exc)
                continue

            hits = [
                d for d in detections
                if d.get("class") in _FLAGGED_LABELS and d.get("score", 0) >= confidence_threshold
            ]
            if hits:
                labels = [d["class"] for d in hits]
                confidence = max(d["score"] for d in hits)
                positive_frames.append((timestamp, confidence, labels))

    if not positive_frames:
        log.info("NudeNet: no detections in %s", media_path)
        return []

    log.info("NudeNet: %d positive frames in %s — merging into scenes...", len(positive_frames), media_path)

    # Merge nearby positive frames into continuous scenes
    scenes: List[DetectedScene] = []
    seg_start, seg_conf, seg_labels = positive_frames[0]
    seg_end = seg_start + (1.0 / frame_rate)
    seg_label_set: set[str] = set(seg_labels)

    for ts, conf, labels in positive_frames[1:]:
        if ts - seg_end <= merge_gap:
            seg_end = ts + (1.0 / frame_rate)
            seg_conf = max(seg_conf, conf)
            seg_label_set.update(labels)
        else:
            if seg_end - seg_start >= min_scene_duration:
                scenes.append(DetectedScene(
                    start=seg_start,
                    end=seg_end,
                    confidence=round(seg_conf, 4),
                    labels=sorted(seg_label_set),
                ))
            seg_start, seg_conf, seg_labels = ts, conf, labels
            seg_end = ts + (1.0 / frame_rate)
            seg_label_set = set(labels)

    if seg_end - seg_start >= min_scene_duration:
        scenes.append(DetectedScene(
            start=seg_start,
            end=seg_end,
            confidence=round(seg_conf, 4),
            labels=sorted(seg_label_set),
        ))

    log.info("NudeNet: %d scenes in %s", len(scenes), media_path)
    return scenes
