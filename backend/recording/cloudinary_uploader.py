"""
cloudinary_uploader.py — uploads a Recall.ai recording video to Cloudinary.

Strategy: Cloudinary's remote-fetch upload lets Cloudinary pull the file
directly from Recall's pre-signed S3 URL — our server never buffers the
full video in memory.

Env vars required:
    CLOUDINARY_CLOUD_NAME
    CLOUDINARY_API_KEY
    CLOUDINARY_API_SECRET

Returns the permanent Cloudinary HTTPS URL, or "" on any failure (non-fatal).
"""
from __future__ import annotations

import asyncio
import os


def _configured() -> bool:
    return all(
        os.getenv(k)
        for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")
    )


def _upload_sync(recall_url: str, bot_id: str) -> str:
    """Blocking Cloudinary upload — run via run_in_executor."""
    import cloudinary
    import cloudinary.uploader

    cloudinary.config(
        cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
        api_key=os.getenv("CLOUDINARY_API_KEY"),
        api_secret=os.getenv("CLOUDINARY_API_SECRET"),
        secure=True,
    )

    result = cloudinary.uploader.upload(
        recall_url,          # Cloudinary fetches from this URL directly (remote fetch)
        resource_type="video",
        public_id=bot_id,
        folder="interviews",
        overwrite=True,
    )
    url: str = result.get("secure_url", "")
    if url:
        print(f"[Cloudinary] Upload done — duration={result.get('duration', '?')}s url={url}")
    return url


async def upload_to_cloudinary(recall_url: str, bot_id: str) -> str:
    """
    Upload a Recall.ai video to Cloudinary via remote-fetch (async wrapper).

    Args:
        recall_url: The pre-signed S3 download URL from Recall.ai.
        bot_id:     Used as the Cloudinary public_id (unique per interview).

    Returns:
        Permanent Cloudinary HTTPS URL, or "" on failure.
    """
    if not recall_url:
        return ""

    if not _configured():
        print("[Cloudinary] Missing credentials (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET) — skipping upload")
        return ""

    try:
        print(f"[Cloudinary] Uploading recording for bot {bot_id} ...")
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: _upload_sync(recall_url, bot_id))
    except Exception as exc:
        print(f"[Cloudinary] Upload error (non-fatal): {exc}")
        return ""
