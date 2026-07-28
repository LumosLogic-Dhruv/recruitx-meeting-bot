"""
partial_tracker.py — accumulates partial transcript events and timestamps.

Tracks when partial text last changed meaningfully and when the last
final transcript arrived. These two timestamps drive stability detection.

Pure Python. No network. No imports from interview logic.
O(1) per call. Sub-millisecond.
"""
import time


class PartialTracker:
    """
    Records partial transcript events in constant space.

    State:
        current_text    — the most recently received partial text
        last_change_at  — monotonic time when text last changed meaningfully
        last_final_at   — monotonic time when the last transcript.data arrived
        is_active       — True after first partial arrives, False after a final resets it
    """

    # Minimum word-level Jaccard similarity to consider text "unchanged".
    # Below this threshold, the partial is treated as new content → resets last_change_at.
    CHANGE_THRESHOLD = 0.85

    def __init__(self) -> None:
        self.current_text:   str   = ""
        self.last_change_at: float = 0.0
        self.last_final_at:  float = 0.0
        self.is_active:      bool  = False

    def feed_partial(self, text: str) -> None:
        """Record one partial transcript event."""
        if not isinstance(text, str):
            return
        text = text.strip()
        now  = time.monotonic()

        if not self.is_active:
            # First partial of this utterance — initialise.
            self.is_active     = True
            self.current_text  = text
            self.last_change_at = now
            return

        if _similarity(self.current_text, text) < self.CHANGE_THRESHOLD:
            # Text changed meaningfully — candidate still speaking.
            self.current_text   = text
            self.last_change_at = now

    def feed_final(self) -> None:
        """Record that a transcript.data (final) event arrived. Resets utterance state."""
        self.last_final_at  = time.monotonic()
        self.current_text   = ""
        self.last_change_at = 0.0
        self.is_active      = False


# ── Internal helper ────────────────────────────────────────────────────────────

def _similarity(a: str, b: str) -> float:
    """Word-level Jaccard similarity. O(n). Returns 0.0–1.0."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a and not words_b:
        return 1.0
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)
