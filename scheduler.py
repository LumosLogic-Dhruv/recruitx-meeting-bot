"""APScheduler wrapper — schedules Recall.ai bots for upcoming interviews."""
import asyncio
import os
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(timezone="UTC")

# Injected by main.py on startup so the job can reach session state
_create_session_fn = None   # async fn(meeting_url, system_prompt, bot_name, candidate_name, interview_id)
_convex_client = None
_sessions_ref = None        # reference to main._sessions dict for force-kill
_auto_end_fn = None         # reference to main._auto_end_session
_retry_fn = None            # reference to retry_service.process_cooldown_candidates


def init(create_session_fn, convex_client, sessions_ref=None, auto_end_fn=None, retry_fn=None):
    global _create_session_fn, _convex_client, _sessions_ref, _auto_end_fn, _retry_fn
    _create_session_fn = create_session_fn
    _convex_client = convex_client
    _sessions_ref = sessions_ref
    _auto_end_fn = auto_end_fn
    _retry_fn = retry_fn


async def _bot_join_job(interview_id: str, meeting_url: str, system_prompt: str,
                         bot_name: str, candidate_name: str, recruiter_id: str = "",
                         candidate_id: str = "", role_name: str = "Interview",
                         attempt_number: int = 1, candidate_email: str = ""):
    print(f"[Scheduler] Starting bot for scheduled interview {interview_id} → {meeting_url}")
    try:
        await _create_session_fn(
            meeting_url=meeting_url,
            system_prompt=system_prompt,
            bot_name=bot_name,
            candidate_name=candidate_name,
            scheduled_interview_id=interview_id,
            recruiter_id=recruiter_id,
            candidate_id=candidate_id,
            role_name=role_name,
            attempt_number=attempt_number,
            candidate_email=candidate_email,
        )
        _convex_client.mutation("scheduledInterviews:updateStatus", {
            "id": interview_id, "status": "active"
        })
    except Exception as e:
        print(f"[Scheduler] Bot join error for {interview_id}: {e}")


def schedule_interview(interview_id: str, meeting_url: str, system_prompt: str,
                        bot_name: str, candidate_name: str, run_at: datetime,
                        recruiter_id: str = "", candidate_id: str = "",
                        role_name: str = "Interview", attempt_number: int = 1,
                        candidate_email: str = ""):
    """Schedule a one-shot job to launch the bot at run_at (UTC datetime)."""
    job_id = f"interview_{interview_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        _bot_join_job,
        trigger="date",
        run_date=run_at,
        id=job_id,
        kwargs={
            "interview_id": interview_id,
            "meeting_url": meeting_url,
            "system_prompt": system_prompt,
            "bot_name": bot_name,
            "candidate_name": candidate_name,
            "recruiter_id": recruiter_id,
            "candidate_id": candidate_id,
            "role_name": role_name,
            "attempt_number": attempt_number,
            "candidate_email": candidate_email,
        },
    )
    print(f"[Scheduler] Scheduled bot for interview {interview_id} at {run_at.isoformat()} UTC")


def cancel_interview(interview_id: str):
    job_id = f"interview_{interview_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Cancelled job {job_id}")


async def _force_kill_stale_sessions():
    """Every 5 min: kill sessions older than 75 minutes (absolute safety ceiling)."""
    if not _sessions_ref or not _auto_end_fn:
        return
    now = datetime.now(timezone.utc).timestamp()
    stale = []
    for bot_id, session in list(_sessions_ref.items()):
        created_at = session.get("created_at", now)
        age_minutes = (now - created_at) / 60
        if age_minutes > 75:
            stale.append((bot_id, session))
    for bot_id, session in stale:
        print(f"[Scheduler] Force-killing stale session {bot_id} (age={age_minutes:.0f}m)")
        _sessions_ref.pop(bot_id, None)
        candidate_name = session.get("candidate_name", "Candidate")
        asyncio.create_task(_auto_end_fn(bot_id, session, candidate_name))


async def _run_daily_retry():
    """Daily cron: find candidates whose cooldown has expired and send re-invites."""
    if not _retry_fn:
        return
    print("[Scheduler] Running daily retry check...")
    try:
        await _retry_fn()
    except Exception as e:
        print(f"[Scheduler] Daily retry error: {e}")


def start_recurring_jobs():
    """Register the force-kill and daily-retry crons. Call after scheduler.start()."""
    scheduler.add_job(
        _force_kill_stale_sessions,
        trigger="interval",
        minutes=5,
        id="force_kill_stale",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_daily_retry,
        trigger="cron",
        hour=9,
        minute=0,
        id="daily_retry",
        replace_existing=True,
    )
    print("[Scheduler] Recurring jobs registered: force-kill (5 min), daily retry (09:00 UTC)")


async def reload_pending(convex_client):
    """On server startup: reload all pending interviews from Convex and re-schedule them."""
    try:
        pending = convex_client.query("scheduledInterviews:listPending")
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        count = 0
        for iv in (pending or []):
            if iv.get("scheduledAt", 0) > now_ms:
                run_at = datetime.fromtimestamp(iv["scheduledAt"] / 1000, tz=timezone.utc)
                schedule_interview(
                    interview_id=iv["_id"],
                    meeting_url=iv["meetingUrl"],
                    system_prompt=iv["systemPrompt"],
                    bot_name=iv["botName"],
                    candidate_name=iv["candidateName"],
                    run_at=run_at,
                )
                count += 1
        print(f"[Scheduler] Reloaded {count} pending interview(s) from Convex")
    except Exception as e:
        print(f"[Scheduler] Reload error (non-fatal): {e}")
