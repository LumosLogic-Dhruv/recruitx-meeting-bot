"""
recording_status.py — canonical recording lifecycle states.

States
------
PENDING     Recording has been requested but not yet processed by Recall.
PROCESSING  Recall is currently encoding/transcoding the recording.
AVAILABLE   Recording is ready and the URL is reachable.
FAILED      Processing failed or the recording URL could not be validated.
EXPIRED     Recording URL has passed its retention window.
"""
from enum import Enum


class RecordingStatus(str, Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    AVAILABLE  = "available"
    FAILED     = "failed"
    EXPIRED    = "expired"

    @classmethod
    def from_recall(cls, recall_status: str) -> "RecordingStatus":
        """Map a Recall.ai status string to a RecordingStatus."""
        mapping = {
            "done":       cls.AVAILABLE,
            "available":  cls.AVAILABLE,
            "complete":   cls.AVAILABLE,
            "processing": cls.PROCESSING,
            "failed":     cls.FAILED,
            "error":      cls.FAILED,
            "pending":    cls.PENDING,
        }
        return mapping.get((recall_status or "").lower(), cls.PENDING)

    @property
    def is_terminal(self) -> bool:
        """True for states that will not change without external action."""
        return self in (self.AVAILABLE, self.FAILED, self.EXPIRED)
