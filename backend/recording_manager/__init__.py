"""
recording_manager/ — production-grade recording lifecycle management.

This package is completely independent of the interview pipeline, transcript
generation, LLM logic, scheduler, and scorecard modules.  Any failure here
affects only recording status — never an active interview.

Public surface
--------------
  RecordingManager    – class with full lifecycle control + retry
  RecordingStatus     – canonical state enum
  save_recording()    – fetch + persist metadata (convenience wrapper)
  get_recording()     – retrieve persisted metadata
  update_status()     – set lifecycle state by bot_id
  validate_recording()– URL reachability check + auto status update
  list_recordings()   – list all recording records
"""
from .recording_service import (
    RecordingManager,
    save_recording,
    get_recording,
    update_status,
    validate_recording,
    list_recordings,
)
from .recording_status import RecordingStatus

__all__ = [
    "RecordingManager",
    "RecordingStatus",
    "save_recording",
    "get_recording",
    "update_status",
    "validate_recording",
    "list_recordings",
]
