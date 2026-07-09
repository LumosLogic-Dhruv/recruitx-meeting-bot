"""APScheduler wrapper — schedules Recall.ai bots for upcoming interviews."""
import asyncio
import os
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(timezone="UTC")

# Injected by main.py on startup so the job can reach session state
_create_session_fn = None   # async fn(meeting_url, system_prompt, bot_name, candidate_name, interview_id)
_convex_client = None


def init(create_session_fn, convex_client):
    global _create_session_fn, _convex_client
    _create_session_fn = create_session_fn
    _convex_client = convex_client


async def _bot_join_job(interview_id: str, meeting_url: str, system_prompt: str,
                         bot_name: str, candidate_name: str):
    print(f"[Scheduler] Starting bot for scheduled interview {interview_id} → {meeting_url}")
    try:
        await _create_session_fn(
            meeting_url=meeting_url,
            system_prompt=system_prompt,
            bot_name=bot_name,
            candidate_name=candidate_name,
            scheduled_interview_id=interview_id,
        )
        _convex_client.mutation("scheduledInterviews:updateStatus", {
            "id": interview_id, "status": "active"
        })
    except Exception as e:
        print(f"[Scheduler] Bot join error for {interview_id}: {e}")


def schedule_interview(interview_id: str, meeting_url: str, system_prompt: str,
                        bot_name: str, candidate_name: str, run_at: datetime):
    """Schedule a one-shot job to launch the bot at run_at (UTC datetime)."""
    job_id = f"interview_{interview_id}"
    # Remove if already scheduled (e.g. after server restart reload)
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
        },
    )
    print(f"[Scheduler] Scheduled bot for interview {interview_id} at {run_at.isoformat()} UTC")


def cancel_interview(interview_id: str):
    job_id = f"interview_{interview_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Cancelled job {job_id}")


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
