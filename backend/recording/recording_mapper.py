"""
recording_mapper.py — converts a Recall.ai payload into RecruitX MeetingRecording format.

Responsibilities:
- One-way transformation only
- Return empty dict on any failure
- Never call external APIs
"""
from datetime import datetime, timezone


def map_to_recording(meeting_id: str, bot_id: str, recall_data: dict) -> dict:
    """
    Convert normalised Recall recording data into a MeetingRecording document.
    Returns {} on failure — callers must handle the empty-dict case.
    """
    try:
        if not recall_data or not bot_id:
            return {}

        now_ms = _now_ms()
        status = _map_status(recall_data.get("status", "pending"))

        return {
            "meetingId":              meeting_id,
            "botId":                  bot_id,
            "recordingId":            recall_data.get("bot_id") or bot_id,
            "recordingUrl":           _sanitise_url(recall_data.get("recording_url", "")),
            "transcriptUrl":          _sanitise_url(recall_data.get("transcript_url", "")),
            "thumbnailUrl":           _sanitise_url(recall_data.get("thumbnail_url", "")),
            "durationSeconds":        int(recall_data.get("duration_seconds", 0)),
            "status":                 status,
            "startedAt":              recall_data.get("started_at"),
            "endedAt":                recall_data.get("ended_at"),
            "botIncludedInRecording": True,   # always true — we set this flag in create_bot
            "diarizationEnabled":     True,   # always true — we set use_separate_streams
            "createdAt":              now_ms,
            "updatedAt":              now_ms,
        }
    except Exception as e:
        print(f"[RecordingMapper] map error (non-fatal): {e}")
        return {}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _map_status(recall_status: str) -> str:
    mapping = {
        "done":        "available",
        "available":   "available",
        "complete":    "available",
        "processing":  "processing",
        "failed":      "failed",
        "error":       "failed",
    }
    return mapping.get((recall_status or "").lower(), "pending")


def _sanitise_url(url: str) -> str:
    """Only allow https:// URLs. Rejects anything that looks like injection."""
    if not url or not isinstance(url, str):
        return ""
    url = url.strip()
    if not url.startswith("https://"):
        return ""
    return url


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)
