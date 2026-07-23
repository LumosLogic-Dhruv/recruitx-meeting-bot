"""
calendar_service.py — public API for the calendar package.

Exposed helper functions (all importable from `calendar`):
  CalendarEventData          – typed event descriptor
  generate_ics()             – produce RFC 5545 .ics content
  generate_google_calendar_link()  – Google Calendar deep link
  generate_outlook_calendar_link() – Outlook Calendar deep link
  attach_ics_to_email()      – attach .ics to a MIMEMultipart message
  send_calendar_invite()     – build + send the full invitation email with ICS

Architecture notes
------------------
- Zero business logic; pure data transformation + email delivery.
- Never imports from interview, pipeline, scheduler, or recording modules.
- All public functions are safe to call from background tasks (never raise).
"""

import asyncio
import os
import smtplib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .ics_generator import generate_ics as _build_ics
from .calendar_links import (
    generate_google_calendar_link as _gcal,
    generate_outlook_calendar_link as _outlook,
)
from .calendar_email import build_calendar_invitation_email


COMPANY = os.getenv("COMPANY_NAME", "LumosLogic")
_ICS_FILENAME = "interview_invite.ics"


# ── Event descriptor ──────────────────────────────────────────────────────────

@dataclass
class CalendarEventData:
    """All fields needed to generate an ICS, calendar links, and invitation email."""
    title: str
    candidate_name: str
    candidate_email: str
    job_title: str
    recruiter_name: str
    organizer_email: str
    start: datetime            # naive = UTC; or tz-aware
    duration_minutes: int
    meet_url: str
    timezone_name: str = "UTC"
    description: str = ""
    uid: str = field(default_factory=lambda: f"{uuid.uuid4()}@recruitx.lumoslogic.com")

    @property
    def end(self) -> datetime:
        s = self.start if self.start.tzinfo else self.start.replace(tzinfo=timezone.utc)
        return s + timedelta(minutes=self.duration_minutes)


# ── Public helper functions ───────────────────────────────────────────────────

def generate_ics(event: CalendarEventData) -> str:
    """Generate RFC 5545-compliant ICS content for the given event."""
    return _build_ics(
        title=event.title,
        candidate_name=event.candidate_name,
        job_title=event.job_title,
        recruiter_name=event.recruiter_name,
        organizer_email=event.organizer_email,
        candidate_email=event.candidate_email,
        start=event.start,
        end=event.end,
        timezone_name=event.timezone_name,
        meet_url=event.meet_url,
        description=event.description,
        uid=event.uid,
    )


def generate_google_calendar_link(event: CalendarEventData) -> str:
    """Return a Google Calendar add-event deep link for the given event."""
    desc = (
        f"Interview for {event.candidate_name} — {event.job_title}\n\n"
        f"Platform: Google Meet\n"
        f"Meeting link: {event.meet_url}\n\n"
        "The AI Interviewer joins automatically at the scheduled time."
    )
    return _gcal(
        title=event.title,
        start=event.start,
        end=event.end,
        description=desc,
        location=event.meet_url,
    )


def generate_outlook_calendar_link(event: CalendarEventData) -> str:
    """Return an Outlook Web Calendar add-event deep link for the given event."""
    desc = (
        f"Interview for {event.candidate_name} — {event.job_title}. "
        f"Platform: Google Meet. "
        f"Meeting link: {event.meet_url}. "
        "The AI Interviewer joins automatically at the scheduled time."
    )
    return _outlook(
        title=event.title,
        start=event.start,
        end=event.end,
        description=desc,
        location=event.meet_url,
    )


def attach_ics_to_email(
    msg: MIMEMultipart,
    ics_content: str,
    filename: str = _ICS_FILENAME,
) -> None:
    """
    Attach an ICS file to a MIMEMultipart('mixed') email message.

    The caller is responsible for using MIMEMultipart('mixed') as the
    outer envelope so that the attachment is at the correct MIME level.
    """
    part = MIMEBase("text", "calendar", method="REQUEST", name=filename)
    part.set_payload(ics_content.encode("utf-8"))
    encoders.encode_base64(part)
    # Override Content-Type to include all required parameters
    part.replace_header(
        "Content-Type",
        f'text/calendar; method=REQUEST; name="{filename}"',
    )
    part.add_header("Content-Disposition", "attachment", filename=filename)
    msg.attach(part)


# ── Private sync sender ───────────────────────────────────────────────────────

def _send_sync(
    event: CalendarEventData,
    candidate_email: str,
    smtp_config: dict,
) -> bool:
    """Build and send the full calendar invitation synchronously."""
    smtp_host = smtp_config.get("host") or os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(smtp_config.get("port") or os.getenv("SMTP_PORT", "587"))
    smtp_user = smtp_config.get("user") or os.getenv("SMTP_USER", "")
    smtp_pass = smtp_config.get("password") or os.getenv("SMTP_PASS", "")

    if not smtp_user or not smtp_pass:
        print("[CalendarService] No SMTP credentials — skipping calendar invite")
        return False

    # Generate ICS
    ics_content: str | None = None
    try:
        ics_content = generate_ics(event)
    except Exception as exc:
        print(f"[CalendarService] ICS generation error (non-fatal): {exc}")

    # Generate calendar deep links
    gcal_link = generate_google_calendar_link(event)
    outlook_link = generate_outlook_calendar_link(event)

    # Enhanced HTML email
    html = build_calendar_invitation_email(
        candidate_name=event.candidate_name,
        role_name=event.job_title,
        recruiter_name=event.recruiter_name,
        meet_url=event.meet_url,
        start=event.start,
        duration_minutes=event.duration_minutes,
        timezone_name=event.timezone_name,
        google_calendar_link=gcal_link,
        outlook_calendar_link=outlook_link,
        ics_filename=_ICS_FILENAME,
    )

    # Plain-text fallback
    if event.start.tzinfo is None:
        _start = event.start.replace(tzinfo=timezone.utc)
    else:
        _start = event.start.astimezone(timezone.utc)
    plain = (
        f"Interview Invitation — {event.job_title}\n\n"
        f"Hi {event.candidate_name},\n\n"
        f"You have been invited for an AI-conducted interview for {event.job_title} "
        f"at {COMPANY}.\n\n"
        f"Date:     {_start.strftime('%A, %B %d, %Y')}\n"
        f"Time:     {_start.strftime('%I:%M %p')} {event.timezone_name}\n"
        f"Duration: {event.duration_minutes} minutes\n"
        f"Platform: Google Meet\n"
        f"Join:     {event.meet_url}\n\n"
        f"Add to Google Calendar:\n{gcal_link}\n\n"
        f"Add to Outlook Calendar:\n{outlook_link}\n\n"
        f"A calendar file ({_ICS_FILENAME}) is attached to this email.\n\n"
        f"Questions? Reply to this email.\n\n"
        f"{COMPANY} AI-Powered Recruitment"
    )

    # Assemble MIME — outer=mixed to support attachment
    outer = MIMEMultipart("mixed")
    outer["Subject"] = f"Interview Invitation — {event.job_title} at {COMPANY}"
    outer["From"] = f"{COMPANY} Interviews <{smtp_user}>"
    outer["To"] = f"{event.candidate_name} <{candidate_email}>"

    # HTML + plain nested in alternative
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(plain, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    outer.attach(alt)

    # ICS attachment
    if ics_content:
        attach_ics_to_email(outer, ics_content, _ICS_FILENAME)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            srv.ehlo()
            srv.starttls()
            srv.login(smtp_user, smtp_pass)
            srv.sendmail(smtp_user, [candidate_email], outer.as_string())
        print(f"[CalendarService] Calendar invite sent to {candidate_email}")
        return True
    except Exception as exc:
        print(f"[CalendarService] SMTP error: {exc}")
        return False


# ── Public async sender ───────────────────────────────────────────────────────

async def send_calendar_invite(
    event: CalendarEventData,
    candidate_email: str,
    smtp_config: dict | None = None,
) -> bool:
    """
    Generate and send a calendar invitation email with ICS attachment.

    Returns True on success, False on any failure.
    Never raises — safe for asyncio.create_task and background use.
    """
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: _send_sync(event, candidate_email, smtp_config or {}),
        )
    except Exception as exc:
        print(f"[CalendarService] send_calendar_invite error (non-fatal): {exc}")
        return False
