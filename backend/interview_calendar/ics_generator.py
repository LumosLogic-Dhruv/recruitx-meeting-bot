"""
RFC 5545-compliant ICS calendar file generator.

Security:
- All text fields are escaped to prevent newline/CRLF injection.
- URLs are validated (HTTPS only).
- Datetimes are validated and converted to UTC.
- UID is generated via uuid4 when not provided.

Compatible with: Google Calendar, Outlook, Apple Calendar, Yahoo,
                 Thunderbird, Android, iPhone.
"""
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse


def _escape_ics_text(value: str) -> str:
    """Escape a text value for safe inclusion in an ICS property (RFC 5545 §3.3.11)."""
    if not isinstance(value, str):
        return ""
    # Strip control characters except horizontal tab
    value = re.sub(r"[\x00-\x08\x0A-\x1F\x7F]", "", value)
    # Escape backslash first to avoid double-escaping
    value = value.replace("\\", "\\\\")
    # Escape semicolons and commas
    value = value.replace(";", "\\;")
    value = value.replace(",", "\\,")
    # Collapse all newline variants into the ICS \n escape
    value = value.replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")
    return value


def _validate_url(url: str) -> str:
    """Return url if it is a valid HTTPS URL, else return empty string."""
    if not url or not isinstance(url, str):
        return ""
    url = url.strip()
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return ""
        if not parsed.netloc:
            return ""
        return url
    except Exception:
        return ""


def _to_utc(dt: datetime) -> datetime:
    """Ensure the datetime is UTC-aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fmt_dt(dt: datetime) -> str:
    """Format a UTC datetime as YYYYMMDDTHHMMSSZ."""
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _fold(line: str) -> str:
    """
    Fold a long ICS line per RFC 5545 §3.1:
    max 75 octets per line; continuation lines start with a single space.
    """
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line

    chunks = []
    while encoded:
        # Take up to 75 bytes then trim back until valid UTF-8
        size = 75
        while size > 0:
            chunk = encoded[:size]
            try:
                chunk.decode("utf-8")
                break
            except UnicodeDecodeError:
                size -= 1
        if size == 0:
            # Fallback: skip a single byte to avoid infinite loop
            size = 1
            chunk = encoded[:1]
        chunks.append(chunk.decode("utf-8", errors="replace"))
        encoded = encoded[size:]

    return "\r\n ".join(chunks)


def generate_ics(
    title: str,
    candidate_name: str,
    job_title: str,
    recruiter_name: str,
    organizer_email: str,
    candidate_email: str,
    start: datetime,
    end: datetime,
    timezone_name: str,
    meet_url: str,
    description: str = "",
    uid: str = "",
) -> str:
    """
    Generate an RFC 5545 compliant .ics calendar file string.

    Parameters
    ----------
    title           VEVENT SUMMARY (interview title)
    candidate_name  Displayed name of the candidate
    job_title       Role being interviewed for
    recruiter_name  Name of the organizer/recruiter
    organizer_email Email address of the organizer (used as ORGANIZER URI)
    candidate_email Email address of the candidate (ATTENDEE)
    start           Interview start time (naive = UTC, or tz-aware)
    end             Interview end time (naive = UTC, or tz-aware)
    timezone_name   Human-readable timezone label (e.g. "UTC", "IST")
    meet_url        Google Meet URL
    description     Optional custom description (auto-generated if omitted)
    uid             Optional pre-generated UID (auto-generated if omitted)

    Returns
    -------
    str  CRLF-terminated ICS content ready for file attachment.
    """
    start = _to_utc(start)
    end = _to_utc(end)

    if end <= start:
        raise ValueError("end must be after start")

    safe_url = _validate_url(meet_url)

    if not uid:
        uid = f"{uuid.uuid4()}@recruitx.lumoslogic.com"

    now_utc = datetime.now(timezone.utc)

    # Auto-build description
    if not description:
        url_line = f"Meeting Link: {safe_url}\\n\\n" if safe_url else ""
        description = (
            f"Interview for {candidate_name} — {job_title}\\n\\n"
            f"Platform: Google Meet\\n"
            f"AI Interviewer joins automatically at the scheduled time.\\n\\n"
            + url_line
            + "Preparation Checklist:\\n"
            "• Stable internet connection\\n"
            "• Quiet, well-lit environment\\n"
            "• Working microphone\\n"
            "• Chrome or Edge browser (latest version)\\n"
            "• Join 2-3 minutes early\\n\\n"
            "Recording Notice: This interview is recorded for evaluation purposes."
        )

    safe_title = _escape_ics_text(title)
    safe_desc = _escape_ics_text(description)
    safe_location = _escape_ics_text(safe_url or "Google Meet")
    safe_uid = _escape_ics_text(uid)
    safe_recruiter = _escape_ics_text(recruiter_name)
    safe_organizer = (organizer_email or "").strip()
    safe_candidate = _escape_ics_text(candidate_name)
    safe_candidate_email = (candidate_email or "").strip()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//RecruitX//AI Interview Scheduler 1.0//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{safe_uid}",
        f"DTSTAMP:{_fmt_dt(now_utc)}",
        f"DTSTART:{_fmt_dt(start)}",
        f"DTEND:{_fmt_dt(end)}",
        f"SUMMARY:{safe_title}",
        f"DESCRIPTION:{safe_desc}",
        f"LOCATION:{safe_location}",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "SEQUENCE:0",
        "PRIORITY:5",
    ]

    # Organizer
    if safe_organizer:
        lines.append(f"ORGANIZER;CN={safe_recruiter}:mailto:{safe_organizer}")

    # Candidate as required attendee
    if safe_candidate_email:
        lines.append(
            f"ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;"
            f"PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN={safe_candidate}:"
            f"mailto:{safe_candidate_email}"
        )

    # URL and Google Meet extension
    if safe_url:
        lines.append(f"URL:{safe_url}")
        if "meet.google.com" in safe_url:
            lines.append(f"X-GOOGLE-CONFERENCE:{safe_url}")

    # 30-minute reminder alarm
    lines += [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT30M",
        "DESCRIPTION:Interview starts in 30 minutes",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ]

    folded = [_fold(ln) for ln in lines]
    return "\r\n".join(folded) + "\r\n"
