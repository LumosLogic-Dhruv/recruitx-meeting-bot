"""
recording_downloader.py — storage provider interface and Recall.ai implementation.

Architecture
------------
StorageProvider (ABC)           — interface contract
RecallStorageProvider           — delegates to existing recording/ module
CloudflareR2Provider            — future (interface only, not implemented)
GoogleCloudStorageProvider      — future (interface only, not implemented)

Only RecallStorageProvider is implemented today.
Adding a new provider requires only subclassing StorageProvider.

Isolation
---------
This module does NOT import interview, pipeline, scheduler, or scorecard code.
Its only external dependency is the existing `recording/` package (metadata ops).
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod

from convex import ConvexClient


# ── Abstract interface ────────────────────────────────────────────────────────

class StorageProvider(ABC):
    """Contract that every recording storage backend must satisfy."""

    @abstractmethod
    async def fetch_metadata(self, bot_id: str, meeting_id: str) -> dict:
        """
        Fetch recording metadata from the upstream source (e.g. Recall.ai API).
        Returns {} if the recording is not ready or the fetch failed.
        Never raises.
        """

    @abstractmethod
    def get(self, convex: ConvexClient, meeting_id: str) -> dict:
        """Return persisted recording metadata for meeting_id. Returns {} if missing."""

    @abstractmethod
    def save(self, convex: ConvexClient, metadata: dict) -> bool:
        """Persist recording metadata. Returns True on success."""

    @abstractmethod
    def update_status(self, convex: ConvexClient, bot_id: str, status: str) -> bool:
        """
        Update the status field of a recording identified by bot_id.
        Returns True on success.
        """

    @abstractmethod
    def list(self, convex: ConvexClient, recruiter_id: str = "") -> list:
        """List all recordings, optionally filtered by recruiter_id."""


# ── Recall.ai implementation ──────────────────────────────────────────────────

class RecallStorageProvider(StorageProvider):
    """
    Storage provider backed by Recall.ai + Convex.

    Delegates all Convex mutations/queries to the existing recording/ module so
    there is a single source of truth for the meetingRecordings table.
    """

    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url

    async def fetch_metadata(self, bot_id: str, meeting_id: str) -> dict:
        try:
            from recording.recall_recording import fetch_recording
            from recording.recording_mapper import map_to_recording

            data = await fetch_recording(bot_id, self._api_key, self._base_url)
            if not data:
                return {}
            return map_to_recording(meeting_id, bot_id, data) or {}
        except Exception as exc:
            print(f"[RecallStorageProvider] fetch_metadata error (non-fatal): {exc}")
            return {}

    def get(self, convex: ConvexClient, meeting_id: str) -> dict:
        try:
            from recording.recording_storage import get_by_meeting_id
            return get_by_meeting_id(convex, meeting_id) or {}
        except Exception as exc:
            print(f"[RecallStorageProvider] get error (non-fatal): {exc}")
            return {}

    def save(self, convex: ConvexClient, metadata: dict) -> bool:
        try:
            from recording.recording_storage import upsert_recording
            upsert_recording(convex, metadata)
            return True
        except Exception as exc:
            print(f"[RecallStorageProvider] save error (non-fatal): {exc}")
            return False

    def update_status(self, convex: ConvexClient, bot_id: str, status: str) -> bool:
        try:
            from recording.recording_storage import update_status as _upd
            return _upd(convex, bot_id, status)
        except Exception as exc:
            print(f"[RecallStorageProvider] update_status error (non-fatal): {exc}")
            return False

    def list(self, convex: ConvexClient, recruiter_id: str = "") -> list:
        try:
            from recording.recording_storage import list_recordings
            return list_recordings(convex, recruiter_id) or []
        except Exception as exc:
            print(f"[RecallStorageProvider] list error (non-fatal): {exc}")
            return []


# ── Future provider stubs (interface only) ────────────────────────────────────

class CloudflareR2Provider(StorageProvider):
    """
    Future: store recordings in Cloudflare R2.
    Not implemented — subclass StorageProvider and inject when ready.
    """

    async def fetch_metadata(self, bot_id: str, meeting_id: str) -> dict:
        raise NotImplementedError("CloudflareR2Provider is not yet implemented")

    def get(self, convex: ConvexClient, meeting_id: str) -> dict:
        raise NotImplementedError

    def save(self, convex: ConvexClient, metadata: dict) -> bool:
        raise NotImplementedError

    def update_status(self, convex: ConvexClient, bot_id: str, status: str) -> bool:
        raise NotImplementedError

    def list(self, convex: ConvexClient, recruiter_id: str = "") -> list:
        raise NotImplementedError


class GoogleCloudStorageProvider(StorageProvider):
    """
    Future: store recordings in Google Cloud Storage.
    Not implemented — subclass StorageProvider and inject when ready.
    """

    async def fetch_metadata(self, bot_id: str, meeting_id: str) -> dict:
        raise NotImplementedError("GoogleCloudStorageProvider is not yet implemented")

    def get(self, convex: ConvexClient, meeting_id: str) -> dict:
        raise NotImplementedError

    def save(self, convex: ConvexClient, metadata: dict) -> bool:
        raise NotImplementedError

    def update_status(self, convex: ConvexClient, bot_id: str, status: str) -> bool:
        raise NotImplementedError

    def list(self, convex: ConvexClient, recruiter_id: str = "") -> list:
        raise NotImplementedError


# ── Factory ───────────────────────────────────────────────────────────────────

def default_provider() -> StorageProvider:
    """Return the default storage provider based on environment configuration."""
    return RecallStorageProvider(
        api_key=os.getenv("RECALL_API_KEY", ""),
        base_url=os.getenv("RECALL_API_URL", "https://us-west-2.recall.ai/api/v1"),
    )
