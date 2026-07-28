"""
Listener — pure-Python signal extraction from each candidate turn.
No LLM, no network. Instant. Never modifies the transcript.
"""
import re

_HEDGING: frozenset = frozenset({
    "maybe", "perhaps", "might", "could", "possibly", "i think",
    "i believe", "not sure", "probably", "usually", "kind of", "sort of",
    "somewhat", "i guess", "i suppose", "approximately", "around", "i feel",
})
_CERTAINTY: frozenset = frozenset({
    "definitely", "always", "never", "certainly", "absolutely", "clearly",
    "i know", "i have", "i did", "we built", "i led", "i am confident",
    "we did", "we have", "exactly", "precisely", "in fact",
})
_OWNERSHIP_RE = re.compile(
    r"\b(i\s+(built|designed|led|created|managed|developed|architected|"
    r"implemented|owned|wrote|deployed|maintained|scaled|launched))\b",
    re.IGNORECASE,
)
_QUESTION_END_RE = re.compile(r"\?\s*$")


async def extract(turn_text: str) -> dict:
    """Extract lightweight signals from candidate answer. Never raises."""
    try:
        text_lower = turn_text.lower()
        words = turn_text.split()
        hedging = sum(1 for h in _HEDGING if h in text_lower)
        certainty = sum(1 for c in _CERTAINTY if c in text_lower)
        ownership = len(_OWNERSHIP_RE.findall(turn_text))
        return {
            "word_count": len(words),
            "ends_with_question": bool(_QUESTION_END_RE.search(turn_text.strip())),
            "hedging_markers": hedging,
            "certainty_markers": certainty,
            "ownership_signals": ownership,
            "estimated_duration_s": round(len(words) / 2.5, 1),
        }
    except Exception:
        return {
            "word_count": 0,
            "ends_with_question": False,
            "hedging_markers": 0,
            "certainty_markers": 0,
            "ownership_signals": 0,
            "estimated_duration_s": 0.0,
        }
