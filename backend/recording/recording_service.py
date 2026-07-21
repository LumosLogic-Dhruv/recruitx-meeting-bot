"""
recording_service.py — high-level orchestration for the recording module.

Responsibilities:
- Coordinate fetch → map → store
- Expose clean functions: save_recording, get_recording, get_recording_status,
  list_recordings, delete_metadata
- Never communicate with interview logic, pipeline, planner, or TTS

All functions fail silently — interviews must never be affected.
"""
import os
from convex import ConvexClient

from .recall_recording  import fetch_recording
from .recording_mapper  import map_to_recording
from .recording_storage import (
    upsert_recording,
    get_by_meeting_id,
    get_by_bot_id,
    list_recordings as _list,
    delete_recording,
    update_status,
)


def _recall_creds() -> tuple[str, str]:
    """Return (api_key, base_url) from environment."""
    return (
        os.getenv("RECALL_API_KEY", ""),
        os.getenv("RECALL_API_URL", "https://us-west-2.recall.ai/api/v1"),
    )


# ── Public API ─────────────────────────────────────────────────────────────────

async def save_recording(
    convex: ConvexClient,
    bot_id: str,
    meeting_id: str,
) -> dict:
    """
    Fetch recording from Recall.ai, convert it, and store metadata.
    Returns the stored recording dict, or {} on any failure.
    Never raises — safe to call as a fire-and-forget background task.
    """
    try:
        api_key, base_url = _recall_creds()
        if not api_key:
            print("[RecordingService] RECALL_API_KEY not set — skipping recording save")
            return {}

        recall_data = await fetch_recording(bot_id, api_key, base_url)
        if not recall_data:
            print(f"[RecordingService] No recording data returned for bot {bot_id}")
            return {}

        recording = map_to_recording(meeting_id, bot_id, recall_data)
        if not recording:
            print(f"[RecordingService] Mapper returned empty for bot {bot_id}")
            return {}

        upsert_recording(convex, recording)
        print(
            f"[RecordingService] Saved — bot={bot_id} status={recording.get('status')} "
            f"url={'yes' if recording.get('recordingUrl') else 'no'}"
        )
        return recording
    except Exception as e:
        print(f"[RecordingService] save_recording error (non-fatal): {e}")
        return {}


def get_recording(convex: ConvexClient, meeting_id: str) -> dict:
    """Return full recording metadata for a meeting. Returns {} if not found."""
    return get_by_meeting_id(convex, meeting_id)


def get_recording_status(convex: ConvexClient, meeting_id: str) -> dict:
    """
    Return a lightweight status object for the recording.
    Frontend polls this to know when to show the video player.
    """
    try:
        rec = get_by_meeting_id(convex, meeting_id)
        if not rec:
            return {
                "status":           "not_found",
                "available":        False,
                "duration_seconds": 0,
                "bot_included":     True,
                "diarization":      True,
            }
        status = rec.get("status", "pending")
        return {
            "status":           status,
            "available":        status == "available",
            "recording_url":    rec.get("recordingUrl", "") if status == "available" else "",
            "duration_seconds": rec.get("durationSeconds", 0),
            "created_at":       rec.get("createdAt"),
            "bot_included":     rec.get("botIncludedInRecording", True),
            "diarization":      rec.get("diarizationEnabled", True),
        }
    except Exception as e:
        print(f"[RecordingService] get_status error (non-fatal): {e}")
        return {"status": "error", "available": False}


def list_recordings(convex: ConvexClient, recruiter_id: str = "") -> list:
    """List all recording metadata records."""
    return _list(convex, recruiter_id)


def delete_metadata(convex: ConvexClient, recording_id: str) -> bool:
    """Delete recording metadata by Convex ID. Does NOT delete the actual video."""
    return delete_recording(convex, recording_id)


async def handle_recording_webhook(
    convex: ConvexClient,
    payload: dict,
) -> None:
    """
    Process a Recall.ai recording-ready webhook event.
    Always returns — never raises — never blocks the webhook response.
    """
    try:
        data   = payload.get("data", {})
        bot    = data.get("bot", {}) or data.get("data", {}).get("bot", {})
        bot_id = bot.get("id", "") if isinstance(bot, dict) else data.get("bot_id", "")

        if not bot_id:
            print("[RecordingService] webhook missing bot_id — skipping")
            return

        # Find the meeting associated with this bot via the recording storage index
        existing = get_by_bot_id(convex, bot_id)
        meeting_id = existing.get("meetingId", "")

        if not meeting_id:
            # Try to infer meeting_id from the Convex meetings table via the bot_id
            # This is a best-effort lookup — not critical if it fails
            try:
                from convex import ConvexClient as _CC  # already imported, just referencing
                meetings = convex.query("meetings:getByBotId", {"botId": bot_id})
                if meetings and isinstance(meetings, list) and meetings:
                    meeting_id = str(meetings[0].get("_id", ""))
                elif meetings and isinstance(meetings, dict):
                    meeting_id = str(meetings.get("_id", ""))
            except Exception:
                pass

        await save_recording(convex, bot_id, meeting_id)
    except Exception as e:
        print(f"[RecordingService] handle_recording_webhook error (non-fatal): {e}")
