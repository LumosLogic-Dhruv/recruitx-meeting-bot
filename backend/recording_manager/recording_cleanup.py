"""
recording_cleanup.py — expire and clean up stale recording metadata.

Rules
-----
- Recordings older than EXPIRY_DAYS (default 30) are marked EXPIRED.
- Only AVAILABLE and FAILED recordings are expired; PENDING/PROCESSING are left alone.
- EXPIRED recordings are never deleted from Convex — only status is updated.
- All functions are fail-safe (never raise).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

from convex import ConvexClient

from .recording_status import RecordingStatus

EXPIRY_DAYS: int = int(os.getenv("RECORDING_EXPIRY_DAYS", "30"))


def mark_expired(convex: ConvexClient, bot_id: str) -> bool:
    """
    Mark a specific recording as EXPIRED by its bot_id.
    Returns True on success.
    """
    try:
        from recording.recording_storage import update_status
        return update_status(convex, bot_id, RecordingStatus.EXPIRED.value)
    except Exception as exc:
        print(f"[RecordingCleanup] mark_expired error (non-fatal): {exc}")
        return False


def cleanup_expired_recordings(
    convex: ConvexClient,
    days_old: int = EXPIRY_DAYS,
) -> int:
    """
    Mark all recordings older than `days_old` days as EXPIRED.

    Only transitions AVAILABLE and FAILED recordings; PENDING and PROCESSING
    are excluded because they may still complete.

    Returns the number of recordings marked as expired.
    Never raises.
    """
    try:
        from recording.recording_storage import list_recordings, update_status

        records = list_recordings(convex, "") or []
        cutoff_ms = int(
            (datetime.now(timezone.utc) - timedelta(days=days_old)).timestamp() * 1000
        )
        eligible = {RecordingStatus.AVAILABLE.value, RecordingStatus.FAILED.value}
        count = 0

        for rec in records:
            status = rec.get("status", "")
            if status not in eligible:
                continue

            created_at = rec.get("createdAt") or rec.get("_creationTime") or 0
            if not created_at or created_at >= cutoff_ms:
                continue

            bot_id = rec.get("botId", "")
            if not bot_id:
                continue

            if update_status(convex, bot_id, RecordingStatus.EXPIRED.value):
                count += 1

        if count:
            print(f"[RecordingCleanup] Expired {count} recording(s) older than {days_old} days")
        return count

    except Exception as exc:
        print(f"[RecordingCleanup] cleanup_expired_recordings error (non-fatal): {exc}")
        return 0
