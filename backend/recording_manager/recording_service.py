"""
recording_service.py — RecordingManager: enhanced lifecycle management for recordings.

Public interface
----------------
  RecordingManager           – class (injectable provider)
  save_recording()           – fetch + persist recording metadata
  get_recording()            – retrieve stored metadata
  update_status()            – change a recording's lifecycle state
  validate_recording()       – check URL reachability and update status
  list_recordings()          – list all stored recording records

Design principles
-----------------
- Completely independent of interview, pipeline, scheduler, transcript, and scorecard code.
- All public functions fail silently — any exception only affects recording status.
- Retry uses exponential backoff: 15 s → 30 s → 60 s → 120 s → 5 min × N.
- Retry is opt-in via retry_until_available(); default save/get paths are non-blocking.
- Provider is injected for testability (default = RecallStorageProvider).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from convex import ConvexClient

from .recording_status import RecordingStatus
from .recording_validator import validate_recording_url, ValidationResult
from .recording_downloader import StorageProvider, default_provider

# Retry schedule: attempt delays in seconds
# 15 s, 30 s, 60 s, 120 s, then every 300 s (5 min)
_RETRY_DELAYS: list[int] = [15, 30, 60, 120] + [300] * 20
_MAX_RETRIES: int = int(os.getenv("RECORDING_MAX_RETRIES", "10"))


class RecordingManager:
    """
    Orchestrates the full recording lifecycle: fetch → validate → store → retry.

    Inject a custom StorageProvider for testing or to switch backends.
    """

    def __init__(self, provider: StorageProvider | None = None) -> None:
        self._provider = provider or default_provider()

    # ── Public API ─────────────────────────────────────────────────────────────

    async def save_recording(
        self,
        convex: ConvexClient,
        bot_id: str,
        meeting_id: str,
    ) -> dict:
        """
        Fetch recording metadata from the provider and persist it to Convex.

        If the provider returns no data (recording still processing), a PENDING
        skeleton record is saved so the status is queryable immediately.

        Returns the persisted metadata dict, or {} on failure.
        Never raises.
        """
        try:
            if not bot_id:
                print("[RecordingManager] save_recording: bot_id is empty — skipping")
                return {}

            metadata = await self._provider.fetch_metadata(bot_id, meeting_id)

            if not metadata:
                # Recording not ready yet — persist a PENDING skeleton
                metadata = {
                    "botId":     bot_id,
                    "meetingId": meeting_id,
                    "status":    RecordingStatus.PENDING.value,
                    "provider":  "recall",
                    "createdAt": _now_ms(),
                    "updatedAt": _now_ms(),
                }

            # Normalise status to our enum
            raw = metadata.get("status", RecordingStatus.PENDING.value)
            if raw not in {s.value for s in RecordingStatus}:
                raw = RecordingStatus.PENDING.value
            metadata["status"] = raw

            self._provider.save(convex, metadata)
            print(
                f"[RecordingManager] Saved — bot={bot_id} meeting={meeting_id} "
                f"status={raw}"
            )
            return metadata

        except Exception as exc:
            print(f"[RecordingManager] save_recording error (non-fatal): {exc}")
            return {}

    def get_recording(
        self,
        convex: ConvexClient,
        meeting_id: str,
    ) -> dict:
        """
        Return persisted recording metadata for a meeting.
        Returns {} if not found.
        Never raises.
        """
        try:
            return self._provider.get(convex, meeting_id) or {}
        except Exception as exc:
            print(f"[RecordingManager] get_recording error (non-fatal): {exc}")
            return {}

    def update_status(
        self,
        convex: ConvexClient,
        bot_id: str,
        status: RecordingStatus,
    ) -> bool:
        """
        Update recording status by bot_id.
        Returns True on success.
        Never raises.
        """
        try:
            return self._provider.update_status(convex, bot_id, status.value)
        except Exception as exc:
            print(f"[RecordingManager] update_status error (non-fatal): {exc}")
            return False

    async def validate_recording(
        self,
        convex: ConvexClient,
        meeting_id: str,
    ) -> dict:
        """
        Validate the recording URL for a meeting and update its status.

        Checks: HTTPS URL, HTTP reachability, non-zero Content-Length.
        Updates status to AVAILABLE on success, leaves PROCESSING on failure.

        Returns a dict: {valid, status, url?, reason?}
        Never raises.
        """
        try:
            rec = self._provider.get(convex, meeting_id)
            if not rec:
                return {
                    "valid":  False,
                    "status": RecordingStatus.PENDING.value,
                    "reason": "not_found",
                }

            url = rec.get("recordingUrl", "") or rec.get("videoUrl", "")
            bot_id = rec.get("botId", "")
            current_status = rec.get("status", RecordingStatus.PENDING.value)

            if not url:
                return {
                    "valid":  False,
                    "status": current_status,
                    "reason": "no_url",
                }

            result: ValidationResult = await validate_recording_url(url)

            if result.valid:
                if current_status != RecordingStatus.AVAILABLE.value and bot_id:
                    self._provider.update_status(
                        convex, bot_id, RecordingStatus.AVAILABLE.value
                    )
                return {
                    "valid":  True,
                    "status": RecordingStatus.AVAILABLE.value,
                    "url":    url,
                }

            return {
                "valid":  False,
                "status": RecordingStatus.PROCESSING.value,
                "reason": result.reason,
            }

        except Exception as exc:
            print(f"[RecordingManager] validate_recording error (non-fatal): {exc}")
            return {
                "valid":  False,
                "status": RecordingStatus.PROCESSING.value,
                "reason": str(exc),
            }

    def list_recordings(
        self,
        convex: ConvexClient,
        recruiter_id: str = "",
    ) -> list:
        """
        List all recording metadata records.
        Returns [] on failure.
        Never raises.
        """
        try:
            return self._provider.list(convex, recruiter_id)
        except Exception as exc:
            print(f"[RecordingManager] list_recordings error (non-fatal): {exc}")
            return []

    async def retry_until_available(
        self,
        convex: ConvexClient,
        bot_id: str,
        meeting_id: str,
        max_retries: int | None = None,
    ) -> dict:
        """
        Poll the provider with exponential backoff until the recording is AVAILABLE.

        Retry schedule: 15 s, 30 s, 60 s, 120 s, then every 5 minutes.
        Stops early if the provider marks the recording as FAILED.

        Returns the final metadata dict (may be {}) on exhaustion or failure.
        Never raises.
        """
        if max_retries is None:
            max_retries = _MAX_RETRIES

        delays = _RETRY_DELAYS[:max_retries]

        for attempt, delay in enumerate(delays, start=1):
            await asyncio.sleep(delay)

            try:
                metadata = await self._provider.fetch_metadata(bot_id, meeting_id)

                if metadata:
                    status = metadata.get("status", "")

                    if (
                        status == RecordingStatus.AVAILABLE.value
                        or metadata.get("recordingUrl")
                    ):
                        metadata["status"] = RecordingStatus.AVAILABLE.value
                        self._provider.save(convex, metadata)
                        print(
                            f"[RecordingManager] Recording available after {attempt} "
                            f"attempt(s) — bot={bot_id}"
                        )
                        return metadata

                    if status == RecordingStatus.FAILED.value:
                        print(
                            f"[RecordingManager] Provider reports FAILED — "
                            f"stopping retries for bot={bot_id}"
                        )
                        self._provider.update_status(
                            convex, bot_id, RecordingStatus.FAILED.value
                        )
                        return metadata

                print(
                    f"[RecordingManager] Retry {attempt}/{max_retries} — "
                    f"still processing bot={bot_id} (next in "
                    f"{delays[attempt] if attempt < len(delays) else 'N/A'}s)"
                )

            except Exception as exc:
                print(
                    f"[RecordingManager] Retry {attempt} error (non-fatal): {exc}"
                )

        print(
            f"[RecordingManager] Max retries ({max_retries}) exhausted for bot={bot_id}"
        )
        self._provider.update_status(convex, bot_id, RecordingStatus.FAILED.value)
        return {}


# ── Private helpers ───────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


# ── Module-level convenience API ──────────────────────────────────────────────
# These wrap a default RecordingManager instance so callers do not need to
# instantiate the class directly.

_default_manager = RecordingManager()


async def save_recording(
    convex: ConvexClient, bot_id: str, meeting_id: str
) -> dict:
    """Module-level convenience wrapper for RecordingManager.save_recording."""
    return await _default_manager.save_recording(convex, bot_id, meeting_id)


def get_recording(convex: ConvexClient, meeting_id: str) -> dict:
    """Module-level convenience wrapper for RecordingManager.get_recording."""
    return _default_manager.get_recording(convex, meeting_id)


def update_status(
    convex: ConvexClient, bot_id: str, status: RecordingStatus
) -> bool:
    """Module-level convenience wrapper for RecordingManager.update_status."""
    return _default_manager.update_status(convex, bot_id, status)


async def validate_recording(convex: ConvexClient, meeting_id: str) -> dict:
    """Module-level convenience wrapper for RecordingManager.validate_recording."""
    return await _default_manager.validate_recording(convex, meeting_id)


def list_recordings(
    convex: ConvexClient, recruiter_id: str = ""
) -> list:
    """Module-level convenience wrapper for RecordingManager.list_recordings."""
    return _default_manager.list_recordings(convex, recruiter_id)
