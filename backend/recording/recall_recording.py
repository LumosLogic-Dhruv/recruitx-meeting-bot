"""
recall_recording.py — reads Recall.ai recording information for a completed bot.

Responsibilities:
- Read recording URL, duration, timestamps, transcript URL, status
- Never call TTS
- Never modify Recall sessions
- Read-only

Two strategies (tried in order):
1. GET /recording/?bot_id={id}  — dedicated recording endpoint (most reliable)
2. GET /bot/{id}/               — bot media_shortcuts (fallback)
"""
import httpx

_HEADERS = lambda api_key: {"Authorization": f"Token {api_key}"}


async def fetch_recording(bot_id: str, api_key: str, base_url: str) -> dict:
    """
    Fetch recording metadata from Recall.ai for a completed bot session.
    Tries the /recording/ API first, then falls back to the bot endpoint.
    Returns a normalised dict with recording details, or {} on any failure.
    """
    base = base_url.rstrip("/")
    headers = _HEADERS(api_key)

    # Strategy 1: dedicated /recording/ endpoint
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{base}/recording/",
                params={"bot_id": bot_id},
                headers=headers,
            )
            if resp.is_success:
                data = resp.json()
                results = data if isinstance(data, list) else data.get("results", [])
                for rec in results:
                    status_obj = rec.get("status") or {}
                    code = (
                        status_obj.get("code") if isinstance(status_obj, dict)
                        else status_obj
                    )
                    if code == "done":
                        extracted = _extract_from_recording(rec, bot_id)
                        if extracted.get("recording_url"):
                            print(
                                f"[RecallRecording] Got URL via /recording/ API for bot {bot_id}"
                            )
                            return extracted
    except Exception as e:
        print(f"[RecallRecording] /recording/ API error for bot {bot_id} (non-fatal): {e}")

    # Strategy 2: bot endpoint (media_shortcuts)
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{base}/bot/{bot_id}/",
                headers=headers,
            )
            resp.raise_for_status()
            result = _extract(resp.json())
            if result:
                print(
                    f"[RecallRecording] Got data via /bot/ endpoint for bot {bot_id} "
                    f"(url={'yes' if result.get('recording_url') else 'no'})"
                )
            return result
    except Exception as e:
        print(f"[RecallRecording] /bot/ fetch error for bot {bot_id} (non-fatal): {e}")
        return {}


def _extract_from_recording(rec: dict, bot_id: str) -> dict:
    """Extract recording fields from a /recording/ API object.
    The recording object has a different structure than the bot object."""
    recording_url = ""
    transcript_url = ""
    duration_s = 0
    started_at = rec.get("started_at")
    ended_at = rec.get("completed_at") or rec.get("ended_at")

    # Format 1: media_shortcuts on the recording object
    shortcuts = rec.get("media_shortcuts") or {}
    video_mixed = (
        shortcuts.get("video_mixed_mp4")
        or shortcuts.get("video_mixed")
        or {}
    )
    if isinstance(video_mixed, dict):
        vdata = video_mixed.get("data") or {}
        recording_url = vdata.get("download_url") or vdata.get("url") or ""

    # Format 2: media array [{key, status, data}]
    for item in rec.get("media", []) or []:
        if not isinstance(item, dict):
            continue
        key = item.get("key", "")
        if key in ("video_mixed_mp4", "video_mixed") and not recording_url:
            status_obj = item.get("status") or {}
            code = status_obj.get("code") if isinstance(status_obj, dict) else status_obj
            if code in ("done", "available"):
                idata = item.get("data") or {}
                recording_url = idata.get("download_url") or idata.get("url") or ""
        if key == "transcript" and not transcript_url:
            idata = item.get("data") or {}
            transcript_url = idata.get("download_url") or idata.get("url") or ""

    # Duration from timestamps
    if started_at and ended_at:
        try:
            from datetime import datetime, timezone
            fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
            s = datetime.strptime(started_at[:26].rstrip("Z") + "Z", fmt).replace(tzinfo=timezone.utc)
            e = datetime.strptime(ended_at[:26].rstrip("Z")  + "Z", fmt).replace(tzinfo=timezone.utc)
            duration_s = max(0, int((e - s).total_seconds()))
        except Exception:
            duration_s = 0

    return {
        "bot_id":           bot_id,
        "recording_url":    recording_url,
        "transcript_url":   transcript_url,
        "thumbnail_url":    "",
        "duration_seconds": duration_s,
        "status":           "available" if recording_url else "processing",
        "started_at":       started_at,
        "ended_at":         ended_at,
    }


def _extract(bot: dict) -> dict:
    """Extract recording fields from a Recall.ai bot response payload."""
    recording_url  = ""
    transcript_url = ""
    thumbnail_url  = ""
    duration_s     = 0
    rec_status     = "pending"
    started_at     = None
    ended_at       = None

    # ── Video URL ──────────────────────────────────────────────────────────────
    shortcuts = bot.get("media_shortcuts") or {}
    # Check both possible key names — recording_config uses video_mixed_mp4 but some
    # Recall.ai regions/plans may surface it as video_mixed.
    video_mixed = (
        shortcuts.get("video_mixed_mp4")
        or shortcuts.get("video_mixed")
        or {}
    )
    if isinstance(video_mixed, dict):
        vdata = video_mixed.get("data") or {}
        recording_url = vdata.get("download_url") or vdata.get("url") or ""
        rec_status = video_mixed.get("status") or ("available" if recording_url else "pending")

    # Fallback: check outputs.mp4
    if not recording_url:
        outputs = bot.get("outputs") or {}
        mp4 = outputs.get("mp4") or outputs.get("video") or {}
        if isinstance(mp4, dict):
            recording_url = mp4.get("url") or mp4.get("download_url") or ""
            if not rec_status or rec_status == "pending":
                rec_status = mp4.get("status", "pending")
        elif isinstance(mp4, str):
            recording_url = mp4

    # ── Transcript URL ─────────────────────────────────────────────────────────
    transcript_shortcuts = shortcuts.get("transcript") or {}
    if isinstance(transcript_shortcuts, dict):
        tdata = transcript_shortcuts.get("data") or {}
        transcript_url = tdata.get("download_url") or tdata.get("url") or ""

    # Fallback: check outputs.transcript
    if not transcript_url:
        outputs = bot.get("outputs") or {}
        t = outputs.get("transcript") or {}
        if isinstance(t, dict):
            transcript_url = t.get("url") or t.get("data_url") or ""

    # ── Duration + timestamps from status_changes ──────────────────────────────
    for ch in bot.get("status_changes", []):
        code = ch.get("code", "")
        ts   = ch.get("created_at")
        if code in ("in_call_recording", "in_call_not_recording") and not started_at:
            started_at = ts
        if code == "done" and not ended_at:
            ended_at = ts

    if started_at and ended_at:
        try:
            from datetime import datetime, timezone
            fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
            s = datetime.strptime(started_at[:26].rstrip("Z") + "Z", fmt).replace(tzinfo=timezone.utc)
            e = datetime.strptime(ended_at[:26].rstrip("Z")  + "Z", fmt).replace(tzinfo=timezone.utc)
            duration_s = max(0, int((e - s).total_seconds()))
        except Exception:
            duration_s = 0

    return {
        "bot_id":          bot.get("id", ""),
        "recording_url":   recording_url,
        "transcript_url":  transcript_url,
        "thumbnail_url":   thumbnail_url,
        "duration_seconds":duration_s,
        "status":          rec_status,
        "started_at":      started_at,
        "ended_at":        ended_at,
    }
