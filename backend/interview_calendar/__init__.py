"""
interview_calendar/ — enterprise calendar integration for RecruitX.

Public surface (import from `interview_calendar`):
  CalendarEventData
  generate_ics
  generate_google_calendar_link
  generate_outlook_calendar_link
  attach_ics_to_email
  send_calendar_invite
"""
from .calendar_service import (
    CalendarEventData,
    generate_ics,
    generate_google_calendar_link,
    generate_outlook_calendar_link,
    attach_ics_to_email,
    send_calendar_invite,
)

__all__ = [
    "CalendarEventData",
    "generate_ics",
    "generate_google_calendar_link",
    "generate_outlook_calendar_link",
    "attach_ics_to_email",
    "send_calendar_invite",
]
