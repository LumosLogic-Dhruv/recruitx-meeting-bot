"""
fallback_controller.py — orchestrates PartialTracker + StabilityDetector.

Exposes the minimal API that pipeline.py needs:

    feed_partial(text)             — called for every transcript.partial_data
    feed_final(text)               — called for every transcript.data
    get_ready_text() -> str        — returns stable partial text or "" if not ready
    consumed: bool (property)      — True while a fallback text is active

Reconciliation:
    When transcript.data arrives AFTER a fallback was consumed, feed_final()
    returns True if the final covers the same utterance (similarity >= threshold),
    meaning the pipeline should swallow the duplicate. It always resets the
    consumed state so future turns can use the fallback again.

Safety contract:
    Every public method wraps its body in try/except.
    On any exception the caller receives the safe default (empty string / False).

Pure Python. No network. No OpenAI. No imports from interview logic. O(1) per call.
"""
import time
from .partial_tracker   import PartialTracker, _similarity
from .stability_detector import is_stable

# Minimum word-level Jaccard similarity to consider a final transcript the
# "same utterance" as the consumed fallback and therefore swallow it.
_CONSUMED_SIMILARITY = 0.60


class FallbackController:
    """
    Single object instantiated per ConversationPipeline session.
    All state is instance-local — no globals, no shared state.
    """

    def __init__(self) -> None:
        self._tracker       = PartialTracker()
        self._consumed      = False
        self._consumed_text = ""

    # ── Public properties ──────────────────────────────────────────────────────

    @property
    def consumed(self) -> bool:
        """True while a fallback text is currently active (consumed but not yet reconciled)."""
        return self._consumed

    # ── Feed methods ───────────────────────────────────────────────────────────

    def feed_partial(self, text: str) -> None:
        """
        Record one partial transcript event.

        Also detects when a clearly new utterance starts after a consumed fallback,
        automatically resetting the consumed flag so future turns are not blocked.
        """
        try:
            if self._consumed and text:
                # If incoming text is very different from the consumed fallback,
                # it is a new utterance — reset so the fallback can activate again.
                if _similarity(self._consumed_text, text) < 0.35:
                    self._consumed      = False
                    self._consumed_text = ""
            self._tracker.feed_partial(text)
        except Exception:
            pass

    def feed_final(self, text: str) -> bool:
        """
        Record that a real transcript.data arrived.

        Returns:
            True  — the final covers the same utterance as the consumed fallback;
                    the pipeline should swallow this final (no duplicate turn).
            False — the final is a new utterance or no fallback was active;
                    the pipeline should process it normally.

        Always resets the consumed state so future turns are not blocked.
        """
        try:
            self._tracker.feed_final()
            swallow = (
                self._consumed
                and bool(text)
                and _similarity(self._consumed_text, text) >= _CONSUMED_SIMILARITY
            )
            # Always reset — final transcript always wins and clears fallback state.
            self._consumed      = False
            self._consumed_text = ""
            return swallow
        except Exception:
            self._consumed      = False
            self._consumed_text = ""
            return False

    # ── Activation ────────────────────────────────────────────────────────────

    def get_ready_text(self) -> str:
        """
        Return the stable partial text if all conditions are met, otherwise "".

        Marks the text as consumed on first call so it is never returned twice.
        """
        try:
            if self._consumed:
                return ""
            if not self._tracker.is_active:
                return ""
            if is_stable(
                self._tracker.current_text,
                self._tracker.last_change_at,
                self._tracker.last_final_at,
            ):
                text = self._tracker.current_text.strip()
                if text:
                    self._consumed      = True
                    self._consumed_text = text
                    return text
        except Exception:
            pass
        return ""
