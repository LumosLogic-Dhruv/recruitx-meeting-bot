"""
Retry service — runs daily at 09:00 UTC.
Finds candidates whose 7-day cooldown has expired, creates a new Google Meet,
sends a re-invite email, and schedules the bot for the next available slot.
"""
import asyncio
import datetime
import os
from datetime import timezone

_convex_client = None
_schedule_fn = None   # scheduler.schedule_interview
_gauth = None


def init(convex_client, schedule_fn, gauth_module):
    global _convex_client, _schedule_fn, _gauth
    _convex_client = convex_client
    _schedule_fn = schedule_fn
    _gauth = gauth_module


async def process_cooldown_candidates():
    """Find all cooldown-expired candidates, schedule their retry interviews."""
    if not _convex_client:
        print("[Retry] Not initialised — skipping")
        return

    try:
        ready = _convex_client.query("candidates:listCooldownReady") or []
    except Exception as e:
        print(f"[Retry] Failed to fetch cooldown-ready candidates: {e}")
        return

    print(f"[Retry] {len(ready)} candidate(s) ready for retry")
    for candidate in ready:
        await _schedule_retry(candidate)


async def _schedule_retry(candidate: dict):
    cid = candidate.get("_id") or candidate.get("id", "")
    name = candidate.get("name", "Candidate")
    email = candidate.get("email", "")
    role_name = candidate.get("roleName") or "Interview"
    recruiter_id = candidate.get("recruiterId") or ""

    if not email:
        print(f"[Retry] Candidate {cid} has no email — skipping")
        return

    # Schedule retry for 24 hours from now at a round hour
    now_utc = datetime.datetime.now(timezone.utc)
    scheduled_dt = (now_utc + datetime.timedelta(hours=24)).replace(
        minute=0, second=0, microsecond=0
    )

    # Look up Google tokens for meeting creation
    tokens = None
    smtp_config = {}
    try:
        tokens = _convex_client.query("settings:get", {"key": "google_tokens"})
        smtp_config = _convex_client.query("settings:get", {"key": "smtp_config"}) or {}
    except Exception as e:
        print(f"[Retry] Settings fetch error: {e}")

    meeting_url = ""
    calendar_event_id = ""
    if tokens and tokens.get("refresh_token"):
        try:
            loop = asyncio.get_event_loop()
            meet_result = await _gauth.create_google_meet(
                token_dict=tokens,
                candidate_name=name,
                candidate_email=email,
                scheduled_at=scheduled_dt.replace(tzinfo=None),
                duration_minutes=45,
                role_name=role_name,
            )
            meeting_url = meet_result.get("meet_url", "")
            calendar_event_id = meet_result.get("event_id", "")
        except Exception as e:
            print(f"[Retry] Google Meet creation failed for {name}: {e}")

    if not meeting_url:
        print(f"[Retry] No meeting URL for {name} — skipping retry scheduling")
        return

    # Send re-invite email
    email_sent = False
    import email_templates as et
    smtp_user = smtp_config.get("user") or os.getenv("SMTP_USER", "")
    smtp_pass = smtp_config.get("password") or os.getenv("SMTP_PASS", "")
    if smtp_user and smtp_pass:
        try:
            email_sent = await _gauth.send_email_smtp_generic(
                to_email=email,
                to_name=name,
                subject=f"Your Re-Interview Invitation — {role_name}",
                html_body=et.build_retry_invite_email(
                    candidate_name=name,
                    meet_url=meeting_url,
                    scheduled_at=scheduled_dt,
                    role_name=role_name,
                    duration_minutes=45,
                    sender=smtp_user,
                ),
                smtp_config=smtp_config,
            )
        except Exception as e:
            print(f"[Retry] Email send error for {name}: {e}")

    # Look up the best system prompt for the role
    system_prompt = ""
    try:
        prompts = _convex_client.query("prompts:list") or []
        for p in prompts:
            if p.get("roleName", "").lower() == role_name.lower():
                system_prompt = p.get("promptText", "")
                break
    except Exception:
        pass

    # Save scheduledInterview record
    interview_id = None
    try:
        interview_id = _convex_client.mutation("scheduledInterviews:create", {
            "candidateId": cid,
            "candidateName": name,
            "candidateEmail": email,
            "platform": "google_meet",
            "meetingUrl": meeting_url,
            "scheduledAt": int(scheduled_dt.timestamp() * 1000),
            "durationMinutes": 45,
            "roleName": role_name,
            "systemPrompt": system_prompt,
            "botName": "RecruitX AI Interviewer",
            "emailSent": email_sent,
            "calendarEventId": calendar_event_id,
            "recruiterId": recruiter_id,
            "attemptNumber": 2,
        })
    except Exception as e:
        print(f"[Retry] Failed to save scheduledInterview for {name}: {e}")
        return

    # Update candidate status
    try:
        _convex_client.mutation("candidates:updateStatus", {
            "id": cid,
            "interviewStatus": "attempt_2_scheduled",
            "cooldownUntil": None,
        })
    except Exception as e:
        print(f"[Retry] Failed to update candidate status for {name}: {e}")

    # Schedule the bot
    if _schedule_fn and interview_id:
        _schedule_fn(
            interview_id=str(interview_id),
            meeting_url=meeting_url,
            system_prompt=system_prompt,
            bot_name="RecruitX AI Interviewer",
            candidate_name=name,
            run_at=scheduled_dt,
            recruiter_id=recruiter_id,
            candidate_id=cid,
            role_name=role_name,
            attempt_number=2,
        )

    print(f"[Retry] Retry scheduled for {name} at {scheduled_dt.isoformat()} UTC, email_sent={email_sent}")
