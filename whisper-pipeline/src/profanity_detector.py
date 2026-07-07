import re
from dataclasses import dataclass
from typing import List

try:
    from profanity_check import predict_prob
    _MODEL_AVAILABLE = True
except ImportError:
    _MODEL_AVAILABLE = False

_WORD_PATTERNS: list[re.Pattern] = [
    # Strong
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
    # Mild
    re.compile(r'\bass(es)?\b', re.IGNORECASE),   # ass/asses — not asshole (caught above) or assist/bass
    re.compile(r'\bdamn\w*', re.IGNORECASE),       # damn, damned, dammit
    re.compile(r'\bhell\b', re.IGNORECASE),         # hell — not hello or shell
    re.compile(r'\bcrap\w*', re.IGNORECASE),        # crap, crappy
    re.compile(r'\bheck\b', re.IGNORECASE),
]


@dataclass
class DetectedWord:
    word: str
    start: float
    end: float
    confidence: float


def _matches_word_list(word: str) -> bool:
    return any(p.search(word) for p in _WORD_PATTERNS)


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

        if _matches_word_list(clean):
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
