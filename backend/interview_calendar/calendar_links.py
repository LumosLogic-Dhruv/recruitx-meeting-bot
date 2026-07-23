"""
calendar_links.py — generate calendar deep links for Google Calendar and Outlook.

All links open the respective calendar's "add event" UI pre-filled with
the interview details, so the candidate can add it to their own calendar.
"""
import urllib.parse
from datetime import datetime, timezone


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _gcal_fmt(dt: datetime) -> str:
    """Format UTC datetime as YYYYMMDDTHHMMSSZ for Google Calendar links."""
    return _to_utc(dt).strftime("%Y%m%dT%H%M%SZ")


def _iso_fmt(dt: datetime) -> str:
    """Format UTC datetime as ISO 8601 with offset for Outlook links."""
    return _to_utc(dt).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def generate_google_calendar_link(
    title: str,
    start: datetime,
    end: datetime,
    description: str,
    location: str = "",
) -> str:
    """
    Generate a Google Calendar 'add event' deep link.
    Opens calendar.google.com/calendar/render pre-filled.
    """
    params = {
        "action": "TEMPLATE",
        "text": title,
        "dates": f"{_gcal_fmt(start)}/{_gcal_fmt(end)}",
        "details": description,
        "sf": "true",
        "output": "xml",
    }
    if location:
        params["location"] = location

    return "https://calendar.google.com/calendar/render?" + urllib.parse.urlencode(params)


def generate_outlook_calendar_link(
    title: str,
    start: datetime,
    end: datetime,
    description: str,
    location: str = "",
) -> str:
    """
    Generate an Outlook Web Calendar 'add event' deep link.
    Opens outlook.live.com/calendar deeplink compose pre-filled.
    """
    params = {
        "path": "/calendar/action/compose",
        "rru": "addevent",
        "subject": title,
        "startdt": _iso_fmt(start),
        "enddt": _iso_fmt(end),
        "body": description,
        "allday": "false",
    }
    if location:
        params["location"] = location

    return (
        "https://outlook.live.com/calendar/0/deeplink/compose?"
        + urllib.parse.urlencode(params)
    )


def generate_yahoo_calendar_link(
    title: str,
    start: datetime,
    end: datetime,
    description: str,
    location: str = "",
) -> str:
    """Generate a Yahoo Calendar 'add event' deep link."""
    duration_mins = int((end - start).total_seconds() / 60)
    hours = duration_mins // 60
    mins = duration_mins % 60

    params = {
        "v": "60",
        "title": title,
        "st": _gcal_fmt(start),
        "dur": f"{hours:02d}{mins:02d}",
        "desc": description,
        "in_loc": location or "",
    }

    return "https://calendar.yahoo.com/?" + urllib.parse.urlencode(params)
