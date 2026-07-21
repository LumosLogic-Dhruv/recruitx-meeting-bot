"""
recording/ — independent Meeting Recording Module for RecruitX AI Interviewer.

Exposes the public surface of the package. Import only from here.

If this package is removed, the interview system behaves exactly as before.
No module outside this package should require it.
"""
from .recording_service import (
    save_recording,
    get_recording,
    get_recording_status,
    list_recordings,
    delete_metadata,
    handle_recording_webhook,
)

__all__ = [
    "save_recording",
    "get_recording",
    "get_recording_status",
    "list_recordings",
    "delete_metadata",
    "handle_recording_webhook",
]
