import re
from dataclasses import dataclass
from typing import List

# Primary profanity-check model (ML-based, fast)
try:
    from profanity_check import predict_prob
    _MODEL_AVAILABLE = True
except ImportError:
    _MODEL_AVAILABLE = False

# Strong profanity that must always be muted.
# "hell" and "damn" are intentionally excluded.
_STRONG_WORDS: list[re.Pattern] = [
    re.compile(r'\bf+u+c+k+\w*', re.IGNORECASE),
    re.compile(r'\bsh+i+t+\w*', re.IGNORECASE),
    re.compile(r'\bb+i+t+c+h+\w*', re.IGNORECASE),
    re.compile(r'\bbastard\w*', re.IGNORECASE),
    re.compile(r'\bgod+\s*d+a+m+n*\w*', re.IGNORECASE),
    re.compile(r'\bgoddamn\w*', re.IGNORECASE),
    re.compile(r'\basshole\w*', re.IGNORECASE),
    re.compile(r'\bcunt\w*', re.IGNORECASE),
    re.compile(r'\bcock\b', re.IGNORECASE),
    re.compile(r'\bdick\b', re.IGNORECASE),
    re.compile(r'\bpussy\b', re.IGNORECASE),
    re.compile(r'\bwhore\w*', re.IGNORECASE),
    re.compile(r'\bslut\w*', re.IGNORECASE),
    re.compile(r'\bn[i!1]+gg[aeiouh]\w*', re.IGNORECASE),  # racial slur — requires double-g
]

# Words that are fine — never flag these even if the ML model would
_ALLOWLIST: set[str] = {"hell", "damn", "damned", "heck", "crap", "ass"}


@dataclass
class DetectedWord:
    word: str
    start: float
    end: float
    confidence: float


def _is_allowed(word: str) -> bool:
    clean = re.sub(r"[^a-z]", "", word.lower())
    return clean in _ALLOWLIST


def _matches_strong_list(word: str) -> bool:
    return any(p.search(word) for p in _STRONG_WORDS)


def detect_profanity(word_tokens: list[dict]) -> List[DetectedWord]:
    """
    word_tokens: list of dicts with keys: word, start, end
    Returns DetectedWord entries for words that should be muted.
    """
    results: List[DetectedWord] = []

    for token in word_tokens:
        raw_word: str = token["word"].strip()
        clean = re.sub(r"[^a-zA-Z']", "", raw_word)

        if not clean:
            continue

        if _is_allowed(clean):
            continue

        if _matches_strong_list(clean):
            results.append(DetectedWord(
                word=clean.lower(),
                start=token["start"],
                end=token["end"],
                confidence=0.99,
            ))
            continue

        if _MODEL_AVAILABLE:
            prob = float(predict_prob([clean])[0])
            if prob >= 0.70:
                results.append(DetectedWord(
                    word=clean.lower(),
                    start=token["start"],
                    end=token["end"],
                    confidence=prob,
                ))

    return results
