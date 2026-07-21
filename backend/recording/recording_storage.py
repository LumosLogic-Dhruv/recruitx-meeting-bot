"""
recording_storage.py — stores and retrieves MeetingRecording metadata via Convex.

Responsibilities:
- Store URLs only — never download, never proxy, never store video blobs
- Append-safe upsert: subsequent calls update metadata, never corrupt existing records
- All functions return safe defaults on failure — never raise

Not responsible for:
- Fetching recordings from Recall.ai (that is recall_recording.py)
- Mapping Recall payloads (that is recording_mapper.py)
- Interview logic of any kind
"""
from convex import ConvexClient


# ── Write ──────────────────────────────────────────────────────────────────────

def upsert_recording(convex: ConvexClient, recording: dict) -> str | None:
    """
    Create or update a MeetingRecording document.
    Uses botId as the upsert key — safe to call multiple times.
    Returns the Convex document ID, or None on failure.
    """
    try:
        if not recording or not recording.get("botId"):
            print("[RecordingStorage] upsert skipped — empty or missing botId")
            return None
        result = convex.mutation("meetingRecordings:upsert", recording)
        print(f"[RecordingStorage] Upserted recording for bot {recording['botId']}")
        return result
    except Exception as e:
        print(f"[RecordingStorage] upsert error (non-fatal): {e}")
        return None


def update_status(convex: ConvexClient, bot_id: str, status: str) -> bool:
    """Update just the status field for a recording. Safe to call at any time."""
    try:
        convex.mutation("meetingRecordings:updateStatus", {
            "botId": bot_id,
            "status": status,
        })
        return True
    except Exception as e:
        print(f"[RecordingStorage] updateStatus error (non-fatal): {e}")
        return False


def delete_recording(convex: ConvexClient, recording_id: str) -> bool:
    """Delete recording metadata by Convex document ID. Does not delete the video."""
    try:
        convex.mutation("meetingRecordings:delete", {"id": recording_id})
        return True
    except Exception as e:
        print(f"[RecordingStorage] delete error (non-fatal): {e}")
        return False


# ── Read ───────────────────────────────────────────────────────────────────────

def get_by_meeting_id(convex: ConvexClient, meeting_id: str) -> dict:
    """Retrieve recording metadata by meeting ID. Returns {} on failure or not found."""
    try:
        result = convex.query("meetingRecordings:getByMeetingId", {"meetingId": meeting_id})
        return result or {}
    except Exception as e:
        print(f"[RecordingStorage] getByMeetingId error (non-fatal): {e}")
        return {}


def get_by_bot_id(convex: ConvexClient, bot_id: str) -> dict:
    """Retrieve recording metadata by Recall bot ID. Returns {} on failure or not found."""
    try:
        result = convex.query("meetingRecordings:getByBotId", {"botId": bot_id})
        return result or {}
    except Exception as e:
        print(f"[RecordingStorage] getByBotId error (non-fatal): {e}")
        return {}


def list_recordings(convex: ConvexClient, recruiter_id: str = "") -> list:
    """List recording metadata, optionally filtered by recruiter. Returns [] on failure."""
    try:
        args = {"recruiterId": recruiter_id} if recruiter_id else {}
        result = convex.query("meetingRecordings:list", args)
        return result or []
    except Exception as e:
        print(f"[RecordingStorage] list error (non-fatal): {e}")
        return []
