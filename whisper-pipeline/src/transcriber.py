import logging
import threading
from pathlib import Path
from typing import Iterator

from faster_whisper import WhisperModel

log = logging.getLogger(__name__)

_model: WhisperModel | None = None
_model_lock = threading.Lock()


def _load_model(model_name: str, device: str, compute_type: str) -> WhisperModel:
    global _model
    with _model_lock:
        if _model is None:
            log.info("Loading whisper model %s on %s (%s)…", model_name, device, compute_type)
            _model = WhisperModel(model_name, device=device, compute_type=compute_type)
            log.info("Model loaded.")
    return _model


def transcribe(
    media_path: str,
    model_name: str = "small.en",
    device: str = "cpu",
    compute_type: str = "int8",
) -> tuple[list[dict], str]:
    """
    Transcribe a media file and return word-level tokens.

    Returns:
        (word_tokens, full_text)
        word_tokens: list of {"word": str, "start": float, "end": float}
    """
    model = _load_model(model_name, device, compute_type)

    log.info("Transcribing: %s", media_path)
    segments, info = model.transcribe(
        media_path,
        word_timestamps=True,
        language="en",
        beam_size=5,
        vad_filter=True,         # skip silence — faster and fewer false positives
        vad_parameters={"min_silence_duration_ms": 300},
    )

    word_tokens: list[dict] = []
    seg_data: list[dict] = []

    for segment in segments:
        if segment.words:
            for word in segment.words:
                word_tokens.append({
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                })
        seg_data.append({
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
        })

    full_text = " ".join(s["text"] for s in seg_data).strip()
    log.info("Transcription complete — %d words, language=%s", len(word_tokens), info.language)
    return word_tokens, full_text, seg_data
