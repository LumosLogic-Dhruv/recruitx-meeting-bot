"""
calendar_email.py — enhanced interview invitation email with calendar buttons.

Builds an enterprise-grade HTML email that includes:
- Interview details (date, time, timezone, duration, platform, Meet URL)
- Primary "Join Interview" button
- Calendar add buttons (Google, Outlook)
- Preparation checklist
- AI interviewer notice
- Recording consent notice
- Support contact
"""
import os
from datetime import datetime, timezone, timedelta


COMPANY = os.getenv("COMPANY_NAME", "LumosLogic")
SUPPORT_EMAIL = os.getenv(
    "SUPPORT_EMAIL",
    os.getenv("SMTP_USER", "support@lumoslogic.com"),
)


def build_calendar_invitation_email(
    candidate_name: str,
    role_name: str,
    recruiter_name: str,
    meet_url: str,
    start: datetime,
    duration_minutes: int,
    timezone_name: str,
    google_calendar_link: str,
    outlook_calendar_link: str,
    ics_filename: str = "interview_invite.ics",
) -> str:
    """
    Return a fully rendered HTML email string for the calendar invitation.

    Parameters
    ----------
    candidate_name      Name shown in greeting
    role_name           Position title
    recruiter_name      Sender/recruiter name
    meet_url            Google Meet join URL
    start               Interview start time (UTC-aware or naive UTC)
    duration_minutes    Length of the interview
    timezone_name       Timezone label displayed to the candidate (e.g. "UTC")
    google_calendar_link  Pre-built Google Calendar add-event link
    outlook_calendar_link Pre-built Outlook add-event link
    ics_filename        Name of the attached ICS file (shown in the note)
    """
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)

    end = start + timedelta(minutes=duration_minutes)
    date_str = start.strftime("%A, %B %d, %Y")
    time_str = start.strftime("%I:%M %p").lstrip("0")
    end_time_str = end.strftime("%I:%M %p").lstrip("0")
    tz_label = timezone_name or "UTC"

    # Escape meet_url for HTML attribute
    safe_meet = meet_url.replace('"', "%22").replace("<", "&lt;").replace(">", "&gt;")
    safe_gcal = google_calendar_link.replace('"', "%22")
    safe_outlook = outlook_calendar_link.replace('"', "%22")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Interview Invitation &mdash; {role_name}</title>
</head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;
             padding:32px 16px;color:#1e293b;background:#f8fafc;">
<div style="background:#fff;border-radius:16px;padding:40px;
            border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,.06);">

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div style="text-align:center;margin-bottom:32px;">
    <div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);
                color:#fff;padding:8px 22px;border-radius:24px;font-size:12px;
                font-weight:700;letter-spacing:.07em;margin-bottom:16px;">
      INTERVIEW INVITATION
    </div>
    <h1 style="font-size:26px;font-weight:800;color:#0f172a;margin:0 0 6px;line-height:1.2;">
      You&rsquo;re Invited to Interview
    </h1>
    <p style="color:#64748b;margin:0;font-size:13px;line-height:1.5;">
      {COMPANY} &bull; {role_name}
    </p>
  </div>

  <!-- ── Greeting ───────────────────────────────────────────────────────── -->
  <p style="font-size:15px;color:#0f172a;margin:0 0 8px;">
    Hi <strong>{candidate_name}</strong>,
  </p>
  <p style="color:#475569;line-height:1.7;margin:0 0 28px;font-size:14px;">
    Congratulations! You have been selected for an AI-conducted screening interview
    for the <strong>{role_name}</strong> position at <strong>{COMPANY}</strong>.
    Please join at the scheduled time&mdash;our AI interviewer will greet you automatically.
  </p>

  <!-- ── Interview Details ──────────────────────────────────────────────── -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;
              padding:24px;margin-bottom:28px;">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;
              letter-spacing:.08em;color:#94a3b8;">INTERVIEW DETAILS</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;width:120px;vertical-align:top;">Date</td>
        <td style="font-size:15px;font-weight:600;color:#0f172a;padding:8px 0;">{date_str}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;vertical-align:top;">Time</td>
        <td style="font-size:15px;font-weight:600;color:#0f172a;padding:8px 0;">
          {time_str}&ndash;{end_time_str}
          <span style="font-size:12px;color:#64748b;font-weight:400;">&nbsp;{tz_label}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;vertical-align:top;">Duration</td>
        <td style="font-size:15px;font-weight:600;color:#0f172a;padding:8px 0;">
          {duration_minutes} minutes
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;vertical-align:top;">Timezone</td>
        <td style="font-size:15px;font-weight:600;color:#0f172a;padding:8px 0;">{tz_label}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;vertical-align:top;">Platform</td>
        <td style="font-size:15px;font-weight:600;color:#0f172a;padding:8px 0;">Google Meet</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:#94a3b8;vertical-align:top;">Meeting Link</td>
        <td style="font-size:14px;font-weight:600;color:#7c3aed;padding:8px 0;
                   word-break:break-all;">
          <a href="{safe_meet}" style="color:#7c3aed;">{safe_meet}</a>
        </td>
      </tr>
    </table>
  </div>

  <!-- ── Primary CTA ────────────────────────────────────────────────────── -->
  <div style="text-align:center;margin:0 0 8px;">
    <a href="{safe_meet}"
       style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);
              color:#fff;text-decoration:none;padding:16px 44px;border-radius:12px;
              font-size:17px;font-weight:700;letter-spacing:.01em;
              box-shadow:0 4px 14px rgba(109,40,217,.35);">
      Join Interview &rarr;
    </a>
  </div>
  <p style="text-align:center;font-size:12px;color:#94a3b8;margin:10px 0 32px;">
    Or open: <a href="{safe_meet}" style="color:#7c3aed;">{safe_meet}</a>
  </p>

  <!-- ── Calendar Buttons ───────────────────────────────────────────────── -->
  <div style="text-align:center;margin:0 0 32px;">
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
              color:#94a3b8;margin:0 0 12px;">ADD TO YOUR CALENDAR</p>
    <div>
      <a href="{safe_gcal}"
         style="display:inline-block;background:#fff;color:#374151;text-decoration:none;
                padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;
                border:1px solid #e2e8f0;margin:4px;white-space:nowrap;">
        &#128197; Google Calendar
      </a>
      <a href="{safe_outlook}"
         style="display:inline-block;background:#fff;color:#374151;text-decoration:none;
                padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;
                border:1px solid #e2e8f0;margin:4px;white-space:nowrap;">
        &#128197; Outlook Calendar
      </a>
    </div>
    <p style="font-size:11px;color:#cbd5e1;margin:12px 0 0;">
      A calendar file ({ics_filename}) is also attached to this email
    </p>
  </div>

  <!-- ── Preparation Checklist ──────────────────────────────────────────── -->
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;
              padding:20px;margin-bottom:20px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#15803d;">
      &#10003; Preparation Checklist
    </p>
    <ul style="margin:0;padding-left:20px;color:#166534;font-size:13px;line-height:2.1;">
      <li>Stable internet connection (wired preferred)</li>
      <li>Quiet, well-lit environment</li>
      <li>Working microphone (test it before joining)</li>
      <li>Use <strong>Chrome</strong> or <strong>Edge</strong> &mdash; latest version</li>
      <li>Close background applications</li>
      <li>Join <strong>2&ndash;3 minutes early</strong> to verify your setup</li>
    </ul>
  </div>

  <!-- ── AI Interviewer Notice ──────────────────────────────────────────── -->
  <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:12px;
              padding:20px;margin-bottom:20px;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#7c3aed;">
      &#129302; AI Interviewer
    </p>
    <p style="margin:0;font-size:13px;color:#6b21a8;line-height:1.7;">
      An AI interviewer will join the meeting automatically and start the conversation
      at the scheduled time. Speak naturally&mdash;follow-up questions are based on your
      responses. No special preparation for the AI format is required.
      <br><br>
      <strong>Browser recommendation:</strong> Chrome or Edge (latest version) for the
      best Google Meet experience.
    </p>
  </div>

  <!-- ── Recording Notice ───────────────────────────────────────────────── -->
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;
              padding:20px;margin-bottom:32px;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;">
      &#9654; Recording Notice
    </p>
    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.7;">
      This interview is recorded for evaluation purposes only.
      The recording is reviewed solely by the hiring team and kept strictly confidential.
      By joining, you consent to being recorded.
    </p>
  </div>

  <!-- ── Footer ─────────────────────────────────────────────────────────── -->
  <div style="text-align:center;border-top:1px solid #f1f5f9;padding-top:24px;">
    <p style="font-size:13px;color:#64748b;margin:0 0 6px;">
      Questions? Email
      <a href="mailto:{SUPPORT_EMAIL}" style="color:#7c3aed;">{SUPPORT_EMAIL}</a>
    </p>
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      {COMPANY} &bull; AI-Powered Recruitment
    </p>
  </div>

</div>
</body>
</html>"""
