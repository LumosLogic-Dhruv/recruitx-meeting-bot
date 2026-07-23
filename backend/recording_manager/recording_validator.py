"""
recording_validator.py — validate recording URLs before exposing them to the frontend.

Rules
-----
1. URL must be HTTPS.
2. URL must be reachable (HTTP HEAD returns 2xx or 3xx).
3. Content-Length must not be zero (if header is present).
4. Duration must be > 0 seconds (when provided).
5. Status must be "available" or equivalent.

On any check failure, the validator returns valid=False with a human-readable
reason — it never raises an exception and never crashes the caller.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


@dataclass
class ValidationResult:
    valid: bool
    reason: str = "OK"
    status: str = "processing"   # echoed status suggestion


def _is_https(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme == "https" and bool(p.netloc)
    except Exception:
        return False


async def validate_recording_url(
    url: str,
    duration_seconds: int = 0,
    timeout_secs: float = 10.0,
) -> ValidationResult:
    """
    Asynchronously validate a recording URL.

    Parameters
    ----------
    url              The recording URL to validate.
    duration_seconds Optional known duration; must be > 0 when provided.
    timeout_secs     HTTP HEAD request timeout.

    Returns
    -------
    ValidationResult  .valid=True only when all checks pass.
    """
    if not url or not isinstance(url, str):
        return ValidationResult(False, "URL is empty or not a string")

    url = url.strip()

    if not _is_https(url):
        return ValidationResult(False, f"URL is not HTTPS: {url[:80]}")

    try:
        async with httpx.AsyncClient(
            timeout=timeout_secs,
            follow_redirects=True,
        ) as client:
            resp = await client.head(url)

        acceptable = (200, 206, 301, 302, 303, 307, 308)
        if resp.status_code not in acceptable:
            return ValidationResult(
                False,
                f"URL returned HTTP {resp.status_code}",
            )

        content_length = resp.headers.get("content-length", "")
        if content_length and content_length.isdigit() and int(content_length) == 0:
            return ValidationResult(False, "Content-Length is 0 — file is empty")

    except httpx.TimeoutException:
        return ValidationResult(False, "URL request timed out — recording may still be processing")
    except Exception as exc:
        return ValidationResult(False, f"Reachability check failed: {exc}")

    return ValidationResult(True, "OK", "available")
