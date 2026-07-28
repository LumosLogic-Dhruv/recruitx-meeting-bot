"""
stability_detector.py — decides whether a partial transcript has stabilised.

A partial is considered stable when ALL three conditions hold:
  1. No transcript.data has arrived for at least FINAL_TIMEOUT seconds
     (indicates Deepgram endpointing is stuck due to background noise).
  2. The partial text has not changed meaningfully for STABILITY_WINDOW seconds
     (indicates the candidate has stopped speaking).
  3. The text has at least MIN_WORDS (guards against short noise bursts).

Tuning:
  FINAL_TIMEOUT     = 8 s  — conservative; normal Deepgram endpointing fires in <1 s.
  STABILITY_WINDOW  = 3 s  — enough silence to confirm the candidate finished a thought.
  MIN_WORDS         = 5    — prevents triggering on "um", "okay", noise fragments.

Pure Python. No network. No imports from interview logic. O(1) per call.
"""
import time

FINAL_TIMEOUT    = 8.0   # seconds since last transcript.data before fallback may activate
STABILITY_WINDOW = 3.0   # seconds the partial text must remain unchanged
MIN_WORDS        = 5     # minimum words required in the stable partial


def is_stable(
    current_text:   str,
    last_change_at: float,
    last_final_at:  float,
) -> bool:
    """
    Return True when the partial transcript meets all stability criteria.

    Args:
        current_text:   the most recent partial text from PartialTracker.
        last_change_at: monotonic time when the text last changed meaningfully.
        last_final_at:  monotonic time of the last transcript.data event (0.0 if none).

    Returns:
        bool — True only when all three conditions hold simultaneously.
    """
    try:
        if not current_text or last_change_at == 0.0:
            return False

        if len(current_text.split()) < MIN_WORDS:
            return False

        now = time.monotonic()

        text_stable     = (now - last_change_at) >= STABILITY_WINDOW
        no_recent_final = (last_final_at == 0.0) or (now - last_final_at) >= FINAL_TIMEOUT

        return text_stable and no_recent_final

    except Exception:
        return False
