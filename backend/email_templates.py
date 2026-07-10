"""HTML email templates for RecruitX automated emails.

Templates
---------
build_scorecard_email          – candidate scorecard after attempt 1 or 2
build_recruiter_summary_email  – recruiter summary / no-show notification
build_retry_invite_email       – second-attempt invitation to candidate
build_reminder_email           – 24h / 1h before interview reminder to candidate
build_no_show_email            – candidate missed their slot (no-show)
build_recruiter_no_show_email  – notify recruiter that candidate was a no-show
"""
import os
from datetime import datetime

COMPANY = os.getenv("COMPANY_NAME", "LumosLogic")

# ── Score badge colour helper ─────────────────────────────────────────────────

def _score_color(score: float) -> str:
    if score >= 7:
        return "#16a34a"   # green
    if score >= 5:
        return "#d97706"   # amber
    return "#dc2626"       # red


def _recommendation_color(rec: str) -> str:
    mapping = {
        "STRONG HIRE": "#16a34a",
        "HIRE": "#2563eb",
        "MAYBE": "#d97706",
        "NO HIRE": "#dc2626",
    }
    return mapping.get(rec.upper(), "#64748b")


# ── Shared outer wrapper ──────────────────────────────────────────────────────

def _wrap(body: str) -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;
  padding:32px 16px;color:#1e293b;background:#f8fafc;">
<div style="background:#fff;border-radius:16px;padding:40px;
  border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,.06);">
{body}
<p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px;">
  {COMPANY} · AI-Powered Recruitment
</p>
</div></body></html>"""


# ── 1. Attempt-1 Scorecard Email (sent to candidate) ─────────────────────────

def build_scorecard_email(
    candidate_name: str,
    scorecard: dict,
    role_name: str,
    attempt_number: int = 1,
    retry_in_days: int = 7,
) -> str:
    overall = scorecard.get("overall_score", 0)
    recommendation = scorecard.get("recommendation", "")
    summary = scorecard.get("summary", "")
    dimensions = scorecard.get("dimensions", [])
    green_flags = scorecard.get("green_flags", [])[:3]
    red_flags = scorecard.get("red_flags", [])[:2]

    score_color = _score_color(overall)
    rec_color = _recommendation_color(recommendation)

    is_final = attempt_number >= 2
    retry_note = (
        f'<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;'
        f'padding:16px;margin:24px 0;">'
        f'<p style="margin:0;color:#1d4ed8;font-size:14px;line-height:1.6;">'
        f'<strong>What\'s next?</strong> You have one more opportunity to improve your score. '
        f'We\'ll send you a new interview invitation in <strong>{retry_in_days} days</strong>. '
        f'Use this time to review the areas below and come back stronger!</p></div>'
        if not is_final else
        f'<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;'
        f'padding:16px;margin:24px 0;">'
        f'<p style="margin:0;color:#15803d;font-size:14px;line-height:1.6;">'
        f'<strong>Thank you</strong> for completing both interview sessions. '
        f'This is your final evaluation result. Our team will be in touch regarding next steps.</p></div>'
    )

    dims_html = "".join(
        f'<tr><td style="padding:8px 0;font-size:14px;color:#374151;">{d["name"]}</td>'
        f'<td style="padding:8px 0;text-align:right;">'
        f'<span style="background:{_score_color(d["score"])};color:#fff;padding:3px 10px;'
        f'border-radius:20px;font-size:13px;font-weight:700;">{d["score"]}/10</span></td>'
        f'<td style="padding:8px 12px;font-size:13px;color:#64748b;">{d.get("comment","")}</td></tr>'
        for d in dimensions
    )

    green_html = "".join(
        f'<li style="margin-bottom:6px;color:#166534;">✓ {flag}</li>'
        for flag in green_flags
    )
    red_html = "".join(
        f'<li style="margin-bottom:6px;color:#991b1b;">✗ {flag}</li>'
        for flag in red_flags
    )

    label = "Final Scorecard" if is_final else "Your Interview Scorecard"

    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:26px;font-weight:800;color:#7c3aed;margin:0 0 6px;">{label}</h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {role_name}</p>
  </div>

  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{candidate_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    {"Here is your final interview result" if is_final else "Here is your scorecard from today's AI interview"}.
    Your overall score and a breakdown of each area are shown below.
  </p>

  <div style="text-align:center;margin-bottom:28px;">
    <div style="display:inline-block;background:{score_color};color:#fff;border-radius:50%;
      width:90px;height:90px;line-height:90px;font-size:36px;font-weight:800;">
      {overall}
    </div>
    <p style="margin:8px 0 0;font-size:13px;color:#64748b;">out of 10</p>
    <span style="background:{rec_color};color:#fff;padding:5px 16px;border-radius:20px;
      font-size:14px;font-weight:700;display:inline-block;margin-top:8px;">
      {recommendation}
    </span>
  </div>

  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">{summary}</p>

  {'<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">' + dims_html + '</table>' if dims_html else ''}

  {'<div style="margin-bottom:20px;"><h3 style="color:#166534;font-size:15px;margin-bottom:8px;">Strengths</h3><ul style="margin:0;padding-left:20px;">' + green_html + '</ul></div>' if green_html else ''}
  {'<div style="margin-bottom:20px;"><h3 style="color:#991b1b;font-size:15px;margin-bottom:8px;">Areas to Improve</h3><ul style="margin:0;padding-left:20px;">' + red_html + '</ul></div>' if red_html else ''}

  {retry_note}
"""
    return _wrap(body)


# ── 2. Recruiter Summary Email ────────────────────────────────────────────────

def build_recruiter_summary_email(
    recruiter_name: str,
    candidate_name: str,
    role_name: str,
    attempt_number: int,
    scorecard: dict,
    interview_status: str,
    recording_url: str = "",
    dashboard_url: str = "",
) -> str:
    overall = scorecard.get("overall_score", 0)
    recommendation = scorecard.get("recommendation", "")
    summary = scorecard.get("summary", "")
    score_color = _score_color(overall)
    rec_color = _recommendation_color(recommendation)
    attempt_label = "Attempt 1" if attempt_number == 1 else "Final Attempt"
    is_no_show = interview_status == "no_show"

    recording_block = (
        f'<div style="text-align:center;margin:20px 0;">'
        f'<a href="{recording_url}" style="display:inline-block;background:#7c3aed;color:#fff;'
        f'text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;">'
        f'▶ Watch Recording</a></div>'
        if recording_url else
        '<p style="color:#94a3b8;font-size:13px;text-align:center;">'
        'Recording is still processing — check the dashboard in a few minutes.</p>'
    )

    dashboard_block = (
        f'<div style="text-align:center;margin:16px 0;">'
        f'<a href="{dashboard_url}" style="color:#7c3aed;font-size:14px;text-decoration:underline;">'
        f'View full scorecard in dashboard →</a></div>'
        if dashboard_url else ""
    )

    if is_no_show:
        content = f"""
  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{recruiter_name}</strong>,</p>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin:20px 0;">
    <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
      <strong>{candidate_name}</strong> did not complete the {attempt_label} interview for
      <strong>{role_name}</strong>.
      {"A retry interview will be automatically scheduled in 7 days." if attempt_number == 1 else "This was their final attempt — no further retries."}
    </p>
  </div>
"""
    else:
        content = f"""
  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{recruiter_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    <strong>{candidate_name}</strong> has completed their <strong>{attempt_label}</strong>
    interview for <strong>{role_name}</strong>. Here's a summary.
  </p>

  <div style="text-align:center;margin-bottom:24px;">
    <div style="display:inline-block;background:{score_color};color:#fff;border-radius:50%;
      width:80px;height:80px;line-height:80px;font-size:32px;font-weight:800;">{overall}</div>
    <p style="margin:6px 0 0;font-size:12px;color:#64748b;">out of 10</p>
    <span style="background:{rec_color};color:#fff;padding:4px 14px;border-radius:20px;
      font-size:13px;font-weight:700;display:inline-block;margin-top:6px;">{recommendation}</span>
  </div>

  <p style="color:#475569;line-height:1.7;margin-bottom:20px;font-style:italic;">"{summary}"</p>

  {recording_block}
  {dashboard_block}
"""

    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:24px;font-weight:800;color:#7c3aed;margin:0 0 6px;">
      Interview {"No-Show" if is_no_show else "Result"} — {candidate_name}
    </h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {attempt_label} · {role_name}</p>
  </div>
  {content}
"""
    return _wrap(body)


# ── 3. Retry Invitation Email ─────────────────────────────────────────────────

def build_retry_invite_email(
    candidate_name: str,
    meet_url: str,
    scheduled_at: datetime,
    role_name: str,
    duration_minutes: int = 45,
    sender: str = "",
) -> str:
    date_str = scheduled_at.strftime("%A, %B %d, %Y")
    time_str = scheduled_at.strftime("%I:%M %p UTC")

    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:26px;font-weight:800;color:#7c3aed;margin:0 0 6px;">
      Second Interview Invitation
    </h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {role_name}</p>
  </div>

  <p style="font-size:15px;margin-bottom:20px;">Hi <strong>{candidate_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    We'd like to give you another opportunity to interview for the
    <strong>{role_name}</strong> position at {COMPANY}.
    Your second (and final) interview has been scheduled — please join at the time below.
  </p>

  <div style="background:#f1f5f9;border-radius:12px;padding:24px;margin-bottom:28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;width:130px;">Date</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{date_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;">Time</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{time_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;">Duration</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{duration_minutes} minutes</td></tr>
    </table>
  </div>

  <div style="text-align:center;margin-bottom:28px;">
    <a href="{meet_url}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);
      color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;">
      Join Google Meet Interview
    </a>
    <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
      Or open: <a href="{meet_url}" style="color:#7c3aed;">{meet_url}</a>
    </div>
  </div>

  <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:16px;">
    <p style="font-size:13px;color:#6b21a8;margin:0;line-height:1.6;">
      <strong>Note:</strong> This is your final interview opportunity for this position.
      The AI interviewer will greet you automatically when you join.
      Please be in a quiet place with a good internet connection.
    </p>
  </div>
"""
    return _wrap(body)


# ── 4. Pre-interview Reminder Email (24 h / 1 h) ─────────────────────────────

def build_reminder_email(
    candidate_name: str,
    meet_url: str,
    scheduled_at: datetime,
    role_name: str,
    hours_before: int = 24,         # 24 or 1
    duration_minutes: int = 45,
) -> str:
    """Interview reminder sent 24 h and 1 h before the scheduled slot."""
    date_str = scheduled_at.strftime("%A, %B %d, %Y")
    time_str = scheduled_at.strftime("%I:%M %p UTC")
    urgency = "Tomorrow" if hours_before >= 24 else "In 1 Hour"
    urgency_color = "#1d4ed8" if hours_before >= 24 else "#dc2626"

    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <div style="display:inline-block;background:{urgency_color};color:#fff;padding:6px 18px;
      border-radius:20px;font-size:13px;font-weight:700;margin-bottom:12px;">
      ⏰ {urgency}
    </div>
    <h1 style="font-size:24px;font-weight:800;color:#7c3aed;margin:0 0 6px;">Interview Reminder</h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {role_name}</p>
  </div>

  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{candidate_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    {"This is your 24-hour reminder" if hours_before >= 24 else "Your interview starts in <strong>1 hour</strong>"} for the
    <strong>{role_name}</strong> position at {COMPANY}. Please review the details below.
  </p>

  <div style="background:#f1f5f9;border-radius:12px;padding:24px;margin-bottom:28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;width:130px;">Date</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{date_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;">Time</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{time_str}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:#94a3b8;">Duration</td>
          <td style="font-size:15px;font-weight:600;color:#0f172a;">{duration_minutes} minutes</td></tr>
    </table>
  </div>

  <div style="text-align:center;margin-bottom:28px;">
    <a href="{meet_url}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);
      color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;">
      Join Google Meet Interview
    </a>
    <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
      Link: <a href="{meet_url}" style="color:#7c3aed;">{meet_url}</a>
    </div>
  </div>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:20px;">
    <p style="font-size:13px;color:#166534;margin:0 0 8px;font-weight:700;">✅ Quick Checklist</p>
    <ul style="margin:0;padding-left:20px;color:#166534;font-size:13px;line-height:1.8;">
      <li>Stable internet connection</li>
      <li>Quiet, well-lit environment</li>
      <li>Working microphone</li>
      <li>Chrome or Edge browser (latest version)</li>
      <li>Close background apps to avoid interruptions</li>
    </ul>
  </div>

  <p style="font-size:13px;color:#64748b;line-height:1.6;margin-top:16px;">
    The AI interviewer will greet you automatically once you join the meeting.
    No extra software installation is required — just click the link above at the scheduled time.
  </p>
"""
    return _wrap(body)


# ── 5. No-Show Email (to candidate) ──────────────────────────────────────────

def build_no_show_email(
    candidate_name: str,
    role_name: str,
    attempt_number: int = 1,
    retry_in_days: int = 7,
) -> str:
    """Email sent to candidate when they miss their interview slot."""
    is_final = attempt_number >= 2
    retry_block = (
        f'<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:24px 0;">'
        f'<p style="margin:0;color:#1d4ed8;font-size:14px;line-height:1.6;">'
        f'<strong>Second Chance:</strong> You still have one retry opportunity. '
        f'We\'ll send you a new interview invitation in <strong>{retry_in_days} days</strong>. '
        f'Make sure to join on time!</p></div>'
        if not is_final else
        f'<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:24px 0;">'
        f'<p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;">'
        f'<strong>Important:</strong> This was your final interview attempt for this position. '
        f'No further retries are available. Our team will be in touch regarding the outcome.</p></div>'
    )
    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:24px;font-weight:800;color:#7c3aed;margin:0 0 6px;">Missed Interview</h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {role_name}</p>
  </div>

  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{candidate_name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:20px;">
    We noticed you were unable to join your {"final" if is_final else "Attempt " + str(attempt_number)}
    interview for the <strong>{role_name}</strong> position at {COMPANY}. We understand that
    unexpected situations arise.
  </p>

  {retry_block}

  <p style="font-size:13px;color:#64748b;line-height:1.6;">
    If you have any questions or need assistance, please contact your recruiter.
  </p>
"""
    return _wrap(body)


# ── 6. No-Show Notification (to recruiter) ────────────────────────────────────

def build_recruiter_no_show_email(
    recruiter_name: str,
    candidate_name: str,
    role_name: str,
    attempt_number: int,
    scheduled_at: datetime,
) -> str:
    """Alert recruiter when a candidate is a no-show."""
    attempt_label = f"Attempt {attempt_number}"
    is_final = attempt_number >= 2
    date_str = scheduled_at.strftime("%A, %B %d, %Y at %I:%M %p UTC")
    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:24px;font-weight:800;color:#7c3aed;margin:0 0 6px;">
      No-Show Alert — {candidate_name}
    </h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · {attempt_label} · {role_name}</p>
  </div>

  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{recruiter_name}</strong>,</p>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin:20px 0;">
    <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
      <strong>{candidate_name}</strong> did not join their <strong>{attempt_label}</strong> interview
      for <strong>{role_name}</strong> scheduled on {date_str}.
    </p>
  </div>
  <p style="color:#475569;font-size:14px;line-height:1.6;">
    {"The system will automatically schedule a retry interview in 7 days." if not is_final else
     "This was their final attempt — no further automatic retries will be scheduled."}
    You can view the candidate&apos;s status in the <a href="#" style="color:#7c3aed;">recruiter dashboard</a>.
  </p>
"""
    return _wrap(body)


# ── 7. Password Reset Email ───────────────────────────────────────────────────

def build_password_reset_email(name: str, reset_url: str) -> str:
    body = f"""
  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="font-size:24px;font-weight:800;color:#7c3aed;margin:0 0 6px;">Reset Your Password</h1>
    <p style="color:#94a3b8;margin:0;font-size:13px;">{COMPANY} · AI-Powered Recruitment</p>
  </div>
  <p style="font-size:15px;margin-bottom:8px;">Hi <strong>{name}</strong>,</p>
  <p style="color:#475569;line-height:1.7;margin-bottom:24px;">
    We received a request to reset your RecruitX password.
    Click the button below — this link expires in <strong>1 hour</strong>.
  </p>
  <div style="text-align:center;margin-bottom:28px;">
    <a href="{reset_url}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);
      color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;">
      Reset Password
    </a>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">
      Or copy: <a href="{reset_url}" style="color:#7c3aed;">{reset_url}</a>
    </p>
  </div>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;">
    <p style="margin:0;color:#991b1b;font-size:13px;">
      If you didn&apos;t request this, ignore this email — your password won&apos;t change.
    </p>
  </div>
"""
    return _wrap(body)
