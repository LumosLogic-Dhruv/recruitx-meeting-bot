"""
recording.py — Recording fetch, Cloudinary upload, and status management.

Collapses recording/ (5 files) and recording_manager/ (5 files) into one module.

Public API:
    upload_to_cloudinary(recall_url, bot_id) -> str
    handle_recording_webhook(convex_client, body) -> None   [async]
    get_recording_status(convex_client, meeting_id) -> dict
    retry_until_available(convex, bot_id, meeting_id) -> dict  [async]
    validate_recording(convex, meeting_id) -> dict           [async]
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from convex import ConvexClient


# ── Cloudinary upload ──────────────────────────────────────────────────────────

def _cloudinary_configured() -> bool:
    return all(
        os.getenv(k)
        for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")
    )


def _cloudinary_upload_sync(recall_url: str, bot_id: str) -> str:
    import cloudinary
    import cloudinary.uploader

    cloudinary.config(
        cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
        api_key=os.getenv("CLOUDINARY_API_KEY"),
        api_secret=os.getenv("CLOUDINARY_API_SECRET"),
        secure=True,
    )
    result = cloudinary.uploader.upload(
        recall_url,
        resource_type="video",
        public_id=bot_id,
        folder="interviews",
        overwrite=True,
    )
    url: str = result.get("secure_url", "")
    if url:
        print(f"[Cloudinary] Upload done — duration={result.get('duration','?')}s url={url}")
    return url


async def upload_to_cloudinary(recall_url: str, bot_id: str) -> str:
    """Upload a Recall.ai video to Cloudinary via remote-fetch. Returns permanent URL or ""."""
    if not recall_url or not _cloudinary_configured():
        if not recall_url:
            return ""
        print("[Cloudinary] Missing credentials — skipping upload")
        return ""
    try:
        print(f"[Cloudinary] Uploading recording for bot {bot_id} ...")
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, lambda: _cloudinary_upload_sync(recall_url, bot_id)
        )
    except Exception as exc:
        print(f"[Cloudinary] Upload error (non-fatal): {exc}")
        return ""


# ── Convex helpers (meetingRecordings table) ───────────────────────────────────

def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _upsert(convex: ConvexClient, record: dict) -> None:
    if not record or not record.get("botId"):
        return
    try:
        convex.mutation("meetingRecordings:upsert", record)
    except Exception as e:
        print(f"[Recording] upsert error (non-fatal): {e}")


def _get_by_meeting_id(convex: ConvexClient, meeting_id: str) -> dict:
    try:
        return convex.query("meetingRecordings:getByMeetingId", {"meetingId": meeting_id}) or {}
    except Exception as e:
        print(f"[Recording] getByMeetingId error (non-fatal): {e}")
        return {}


def _get_by_bot_id(convex: ConvexClient, bot_id: str) -> dict:
    try:
        return convex.query("meetingRecordings:getByBotId", {"botId": bot_id}) or {}
    except Exception as e:
        print(f"[Recording] getByBotId error (non-fatal): {e}")
        return {}


# ── Recording URL extraction (from Recall.ai bot/recording payloads) ───────────

def _extract_recording_url(data: dict) -> str:
    """Pull the best available video URL from a Recall.ai bot or recording payload."""
    shortcuts = data.get("media_shortcuts") or {}
    for key in ("video_mixed_mp4", "video_mixed"):
        vdata = (shortcuts.get(key) or {}).get("data") or {}
        url = vdata.get("download_url") or vdata.get("url") or ""
        if url:
            return url
    # Fallback: outputs.mp4
    mp4 = (data.get("outputs") or {}).get("mp4") or {}
    if isinstance(mp4, dict):
        return mp4.get("url") or mp4.get("download_url") or ""
    if isinstance(mp4, str):
        return mp4
    return ""


# ── Public API ─────────────────────────────────────────────────────────────────

async def handle_recording_webhook(convex: ConvexClient, payload: dict) -> None:
    """Process a Recall.ai recording-ready webhook. Never raises."""
    try:
        data = payload.get("data", {})
        bot = data.get("bot", {}) or data.get("data", {}).get("bot", {})
        bot_id = (bot.get("id", "") if isinstance(bot, dict) else "") or data.get("bot_id", "")

        if not bot_id:
            print("[Recording] webhook missing bot_id — skipping")
            return

        # Resolve meeting_id from the recordings table or meetings table
        existing = _get_by_bot_id(convex, bot_id)
        meeting_id = existing.get("meetingId", "")
        if not meeting_id:
            try:
                meeting = convex.query("meetings:getByBotId", {"botId": bot_id})
                if meeting:
                    meeting_id = str(
                        meeting.get("_id", "") if isinstance(meeting, dict)
                        else (meeting[0].get("_id", "") if isinstance(meeting, list) and meeting else "")
                    )
            except Exception:
                pass

        record = {
            "botId":      bot_id,
            "meetingId":  meeting_id,
            "status":     "processing",
            "provider":   "recall",
            "createdAt":  _now_ms(),
            "updatedAt":  _now_ms(),
        }
        _upsert(convex, record)
        print(f"[Recording] Webhook handled for bot {bot_id} — marked processing")
    except Exception as e:
        print(f"[Recording] handle_recording_webhook error (non-fatal): {e}")


def get_recording_status(convex: ConvexClient, meeting_id: str) -> dict:
    """Return lightweight recording status for the frontend polling endpoint."""
    try:
        rec = _get_by_meeting_id(convex, meeting_id)
        if not rec:
            return {"status": "not_found", "available": False, "duration_seconds": 0}
        status = rec.get("status", "pending")
        return {
            "status":           status,
            "available":        status == "available",
            "recording_url":    rec.get("recordingUrl", "") if status == "available" else "",
            "duration_seconds": rec.get("durationSeconds", 0),
            "created_at":       rec.get("createdAt"),
        }
    except Exception as e:
        print(f"[Recording] get_recording_status error (non-fatal): {e}")
        return {"status": "error", "available": False}


async def retry_until_available(
    convex: ConvexClient,
    bot_id: str,
    meeting_id: str,
    max_retries: int = 10,
) -> dict:
    """
    Poll Recall.ai with exponential backoff until the recording URL is ready.
    Schedule: 15s → 30s → 60s → 120s → 300s (×N).
    Updates meetingRecordings table when available. Never raises.
    """
    import httpx

    delays = [15, 30, 60, 120] + [300] * max_retries
    api_key = os.getenv("RECALL_API_KEY", "")
    base_url = os.getenv("RECALL_API_URL", "https://us-east-1.recall.ai/api/v1").rstrip("/")
    headers = {"Authorization": f"Token {api_key}"}

    for attempt, delay in enumerate(delays[:max_retries], start=1):
        await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(f"{base_url}/bot/{bot_id}/", headers=headers)
                if not resp.is_success:
                    continue
                url = _extract_recording_url(resp.json())
                if url:
                    # Upload to Cloudinary for a permanent URL
                    permanent = await upload_to_cloudinary(url, bot_id)
                    final_url = permanent or url
                    record = {
                        "botId":        bot_id,
                        "meetingId":    meeting_id,
                        "recordingUrl": final_url,
                        "status":       "available",
                        "updatedAt":    _now_ms(),
                    }
                    _upsert(convex, record)
                    print(f"[Recording] Available after {attempt} attempt(s) — bot={bot_id}")
                    return record
                print(
                    f"[Recording] Retry {attempt}/{max_retries} — still processing "
                    f"bot={bot_id} (next in {delays[attempt] if attempt < len(delays) else 'N/A'}s)"
                )
        except Exception as exc:
            print(f"[Recording] Retry {attempt} error (non-fatal): {exc}")

    print(f"[Recording] Max retries exhausted for bot={bot_id}")
    return {}


async def validate_recording(convex: ConvexClient, meeting_id: str) -> dict:
    """Check if the stored recording URL is reachable. Updates status if valid."""
    import httpx

    try:
        rec = _get_by_meeting_id(convex, meeting_id)
        if not rec:
            return {"valid": False, "status": "not_found", "reason": "no_record"}
        url = rec.get("recordingUrl", "")
        if not url or not url.startswith("https://"):
            return {"valid": False, "status": rec.get("status", "pending"), "reason": "no_url"}

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.head(url)
            if resp.status_code < 400 and int(resp.headers.get("content-length", "1") or "1") > 0:
                bot_id = rec.get("botId", "")
                if bot_id:
                    try:
                        convex.mutation("meetingRecordings:updateStatus", {
                            "botId": bot_id, "status": "available"
                        })
                    except Exception:
                        pass
                return {"valid": True, "status": "available", "url": url}
            return {"valid": False, "status": "processing", "reason": f"http_{resp.status_code}"}
    except Exception as exc:
        print(f"[Recording] validate error (non-fatal): {exc}")
        return {"valid": False, "status": "error", "reason": str(exc)}
