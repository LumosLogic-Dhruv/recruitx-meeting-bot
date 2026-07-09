import asyncio
import base64
import os
import uuid
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/meetings.space.created",
]

COMPANY_NAME = os.getenv("COMPANY_NAME", "LumosLogic")


def _redirect_uri() -> str:
    base = os.getenv("RENDER_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/auth/google/callback"


def _client_config() -> dict:
    return {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [_redirect_uri()],
        }
    }


def get_auth_url() -> str:
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=_redirect_uri())
    url, _ = flow.authorization_url(access_type="offline", prompt="consent")
    return url


def exchange_code(code: str) -> dict:
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=_redirect_uri())
    flow.fetch_token(code=code)
    c = flow.credentials
    return {
        "token": c.token,
        "refresh_token": c.refresh_token,
        "token_uri": c.token_uri,
        "client_id": c.client_id,
        "client_secret": c.client_secret,
        "scopes": list(c.scopes or SCOPES),
    }


def _get_credentials(token_dict: dict) -> Credentials:
    creds = Credentials(
        token=token_dict.get("token"),
        refresh_token=token_dict.get("refresh_token"),
        token_uri=token_dict.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_dict.get("client_id") or os.getenv("GOOGLE_CLIENT_ID", ""),
        client_secret=token_dict.get("client_secret") or os.getenv("GOOGLE_CLIENT_SECRET", ""),
        scopes=token_dict.get("scopes", SCOPES),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


def _create_meet_sync(token_dict: dict, candidate_name: str, candidate_email: str,
                      scheduled_at: datetime, duration_minutes: int, role_name: str) -> dict:
    creds = _get_credentials(token_dict)
    service = build("calendar", "v3", credentials=creds)

    end_at = scheduled_at + timedelta(minutes=duration_minutes)
    event = {
        "summary": f"Interview — {candidate_name} ({role_name})",
        "description": (
            f"AI-conducted interview for {candidate_name} applying for {role_name}.\n"
            "The RecruitX AI Interviewer will join and begin automatically."
        ),
        "start": {"dateTime": scheduled_at.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end_at.isoformat(), "timeZone": "UTC"},
        "conferenceData": {
            "createRequest": {
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
        "attendees": [{"email": candidate_email, "displayName": candidate_name}],
    }
    result = service.events().insert(
        calendarId="primary",
        body=event,
        conferenceDataVersion=1,
        sendUpdates="none",  # we send our own custom email
    ).execute()
    return {
        "meet_url": result.get("hangoutLink", ""),
        "event_id": result.get("id", ""),
    }


async def create_google_meet(token_dict: dict, candidate_name: str, candidate_email: str,
                              scheduled_at: datetime, duration_minutes: int = 30,
                              role_name: str = "Interview") -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: _create_meet_sync(token_dict, candidate_name, candidate_email,
                                   scheduled_at, duration_minutes, role_name),
    )


def _build_email_html(candidate_name: str, meet_url: str, scheduled_at: datetime,
                      role_name: str, sender: str, duration_minutes: int) -> str:
    date_str = scheduled_at.strftime("%A, %B %d, %Y")
    time_str = scheduled_at.strftime("%I:%M %p UTC")
    company = COMPANY_NAME
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;color:#1e293b;background:#f8fafc;">
<div style="background:#fff;border-radius:16px;padding:40px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,.06);">
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:26px;font-weight:800;color:#7c3aed;margin:0 0 6px;">Interview Invitation</h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{company} · AI-Powered Interview</p>
  </div>
  <p style="font-size:15px;margin-bottom:20px;">Hi <strong>{candidate_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    You've been invited for an AI-conducted interview for the <strong>{role_name}</strong> position at {company}.
    Our AI interviewer will be in the meeting and will start the conversation automatically.
  </p>
  <div style="background:#f1f5f9;border-radius:12px;padding:24px;margin-bottom:28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;width:130px;">Date</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{date_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Time</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{time_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Duration</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{duration_minutes} minutes</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Platform</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">Google Meet</td></tr>
    </table>
  </div>
  <div style="text-align:center;margin-bottom:28px;">
    <a href="{meet_url}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;">
      Join Google Meet Interview
    </a>
    <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
      Or open: <a href="{meet_url}" style="color:#7c3aed;">{meet_url}</a>
    </div>
  </div>
  <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:16px;margin-bottom:24px;">
    <p style="font-size:13px;color:#6b21a8;margin:0;line-height:1.6;">
      <strong>How it works:</strong> Join the meeting at the scheduled time.
      The AI interviewer will greet you and begin the conversation automatically.
      Please be in a quiet place with a good internet connection.
    </p>
  </div>
  <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0;">
    Sent by {company} · {sender}<br>Reply to this email if you have any questions.
  </p>
</div></body></html>"""


def _send_email_sync(token_dict: dict, candidate_name: str, candidate_email: str,
                     meet_url: str, scheduled_at: datetime, role_name: str,
                     sender: str, duration_minutes: int) -> bool:
    creds = _get_credentials(token_dict)
    gmail = build("gmail", "v1", credentials=creds)

    html = _build_email_html(candidate_name, meet_url, scheduled_at, role_name, sender, duration_minutes)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Interview Invitation — {role_name} at {COMPANY_NAME}"
    msg["From"] = f"{COMPANY_NAME} Interviews <{sender}>"
    msg["To"] = f"{candidate_name} <{candidate_email}>"
    msg.attach(MIMEText(html, "html"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
        return True
    except Exception as e:
        print(f"[Gmail] Send error: {e}")
        return False


async def send_interview_email(token_dict: dict, candidate_name: str, candidate_email: str,
                                meet_url: str, scheduled_at: datetime, role_name: str,
                                sender: str, duration_minutes: int = 30) -> bool:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: _send_email_sync(token_dict, candidate_name, candidate_email,
                                  meet_url, scheduled_at, role_name, sender, duration_minutes),
    )
