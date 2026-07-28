"""
stt_fallback/ — emergency fallback for Deepgram endpointing failure.

Activates only when BOTH conditions hold simultaneously:
  1. No transcript.data has arrived for >= 8 seconds (endpointing stuck).
  2. Partial transcript text has not changed for >= 3 seconds (candidate stopped speaking).

Final transcripts always remain authoritative. When transcript.data eventually
arrives it is reconciled: if it covers the same utterance as the fallback it is
swallowed silently; otherwise it is processed normally.

Rollback: delete this directory and remove the three wiring lines from pipeline.py
plus the `text` argument added to `on_partial_transcript` calls in main.py.

Public API:
    FallbackController — one instance per ConversationPipeline session.
"""
from .fallback_controller import FallbackController

__all__ = ["FallbackController"]
