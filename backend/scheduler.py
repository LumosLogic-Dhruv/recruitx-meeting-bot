"""APScheduler wrapper — schedules Recall.ai bots for upcoming interviews.

Jobs managed here
-----------------
interview_{id}           – bot joins at scheduled time (with 3-try retry)
reminder_24h_{id}        – 24-hour email reminder to candidate
reminder_1h_{id}         – 1-hour email reminder to candidate
no_show_check_{id}       – fires 15 min after scheduled time; marks no-show if needed
force_kill_stale         – every 5 min safety ceiling
daily_retry              – 09:00 UTC daily cooldown check
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(timezone="UTC")

# Injected by main.py on startup
_create_session_fn = None
_convex_client = None
_sessions_ref = None
_auto_end_fn = None
_retry_fn = None
_send_email_fn = None   # async fn(to_email, to_name, subject, html, smtp_config)

BOT_JOIN_MAX_RETRIES = 3
BOT_JOIN_RETRY_DELAY = 30   # seconds between retries


def init(create_session_fn, convex_client, sessions_ref=None, auto_end_fn=None,
         retry_fn=None, send_email_fn=None):
    global _create_session_fn, _convex_client, _sessions_ref, _auto_end_fn, _retry_fn, _send_email_fn
    _create_session_fn = create_session_fn
    _convex_client = convex_client
    _sessions_ref = sessions_ref
    _auto_end_fn = auto_end_fn
    _retry_fn = retry_fn
    _send_email_fn = send_email_fn


# ── Bot join (with retry) ─────────────────────────────────────────────────────

async def _bot_join_job(interview_id: str, meeting_url: str, system_prompt: str,
                         bot_name: str, candidate_name: str, recruiter_id: str = "",
                         candidate_id: str = "", role_name: str = "Interview",
                         attempt_number: int = 1, candidate_email: str = ""):
    print(f"[Scheduler] Starting bot for scheduled interview {interview_id} → {meeting_url}")
    last_err = None
    for attempt in range(1, BOT_JOIN_MAX_RETRIES + 1):
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
            # Log timeline event
            if candidate_id:
                try:
                    _convex_client.mutation("timeline:log", {
                        "candidateId": candidate_id,
                        "eventType": "bot_joined",
                        "actor": "system",
                        "metadata": {"meetingUrl": meeting_url, "attemptNumber": attempt_number},
                    })
                except Exception:
                    pass
            print(f"[Scheduler] Bot join succeeded on attempt {attempt} for {interview_id}")
            return
        except Exception as e:
            last_err = e
            print(f"[Scheduler] Bot join attempt {attempt}/{BOT_JOIN_MAX_RETRIES} failed for {interview_id}: {e}")
            if attempt < BOT_JOIN_MAX_RETRIES:
                await asyncio.sleep(BOT_JOIN_RETRY_DELAY * attempt)

    # All retries exhausted
    print(f"[Scheduler] Bot join permanently failed for {interview_id} after {BOT_JOIN_MAX_RETRIES} attempts: {last_err}")
    if candidate_id:
        try:
            _convex_client.mutation("timeline:log", {
                "candidateId": candidate_id,
                "eventType": "bot_join_failed",
                "actor": "system",
                "metadata": {"error": str(last_err), "attempts": BOT_JOIN_MAX_RETRIES},
            })
        except Exception:
            pass


# ── Email reminder jobs ───────────────────────────────────────────────────────

async def _send_reminder_job(candidate_name: str, candidate_email: str,
                              meet_url: str, scheduled_at_ms: int,
                              role_name: str, duration_minutes: int,
                              hours_before: int, candidate_id: str = ""):
    """Send 24h or 1h reminder email to candidate."""
    import email_templates as et
    try:
        smtp_config = _convex_client.query("settings:get", {"key": "smtp_config"}) or {}
        scheduled_dt = datetime.fromtimestamp(scheduled_at_ms / 1000, tz=timezone.utc)
        html = et.build_reminder_email(
            candidate_name=candidate_name,
            meet_url=meet_url,
            scheduled_at=scheduled_dt,
            role_name=role_name,
            hours_before=hours_before,
            duration_minutes=duration_minutes,
        )
        company = os.getenv("COMPANY_NAME", "LumosLogic")
        label = "Tomorrow" if hours_before >= 24 else "In 1 Hour"
        subject = f"[{company}] Interview Reminder ({label}) — {role_name}"
        if _send_email_fn:
            await _send_email_fn(
                to_email=candidate_email,
                to_name=candidate_name,
                subject=subject,
                html_body=html,
                smtp_config=smtp_config,
            )
        event_type = "email_reminder_24h" if hours_before >= 24 else "email_reminder_1h"
        if candidate_id:
            try:
                _convex_client.mutation("timeline:log", {
                    "candidateId": candidate_id,
                    "eventType": event_type,
                    "actor": "system",
                    "metadata": {"hoursBeforeInterview": hours_before},
                })
            except Exception:
                pass
        print(f"[Scheduler] {hours_before}h reminder sent to {candidate_email}")
    except Exception as e:
        print(f"[Scheduler] Reminder email error ({hours_before}h): {e}")


# ── No-show grace period check ────────────────────────────────────────────────

async def _no_show_check_job(interview_id: str, candidate_id: str, candidate_name: str,
                              candidate_email: str, role_name: str, recruiter_id: str,
                              attempt_number: int, scheduled_at_ms: int):
    """Fires 15 min after scheduled time. If no active session exists, marks as no-show."""
    # Check if an active bot session is running for this interview
    active = False
    if _sessions_ref:
        for bot_id, session in _sessions_ref.items():
            if session.get("scheduled_interview_id") == interview_id:
                active = True
                break

    if active:
        print(f"[Scheduler] No-show check for {interview_id}: session is active — not a no-show")
        return

    print(f"[Scheduler] No-show detected for {interview_id} — candidate {candidate_name} never joined")

    import email_templates as et
    try:
        smtp_config = _convex_client.query("settings:get", {"key": "smtp_config"}) or {}

        # Update scheduled interview status
        _convex_client.mutation("scheduledInterviews:updateStatus", {
            "id": interview_id, "status": "completed"
        })

        # Update candidate status
        is_final = attempt_number >= 2
        if not is_final:
            cooldown_until = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp() * 1000)
            _convex_client.mutation("candidates:updateStatus", {
                "id": candidate_id,
                "interviewStatus": "cooldown",
                "cooldownUntil": cooldown_until,
            })
        else:
            _convex_client.mutation("candidates:updateStatus", {
                "id": candidate_id,
                "interviewStatus": "locked",
            })

        # Timeline event
        _convex_client.mutation("timeline:log", {
            "candidateId": candidate_id,
            "eventType": "no_show",
            "actor": "system",
            "metadata": {"attemptNumber": attempt_number, "scheduledAt": scheduled_at_ms},
        })

        # Email candidate
        if candidate_email:
            scheduled_dt = datetime.fromtimestamp(scheduled_at_ms / 1000, tz=timezone.utc)
            html_cand = et.build_no_show_email(
                candidate_name=candidate_name,
                role_name=role_name,
                attempt_number=attempt_number,
            )
            company = os.getenv("COMPANY_NAME", "LumosLogic")
            if _send_email_fn:
                await _send_email_fn(
                    to_email=candidate_email,
                    to_name=candidate_name,
                    subject=f"[{company}] Missed Interview — {role_name}",
                    html_body=html_cand,
                    smtp_config=smtp_config,
                )

        # Email recruiter
        if recruiter_id:
            try:
                recruiter = _convex_client.query("users:getById", {"id": recruiter_id})
                if recruiter:
                    scheduled_dt = datetime.fromtimestamp(scheduled_at_ms / 1000, tz=timezone.utc)
                    html_rec = et.build_recruiter_no_show_email(
                        recruiter_name=recruiter.get("name", "Recruiter"),
                        candidate_name=candidate_name,
                        role_name=role_name,
                        attempt_number=attempt_number,
                        scheduled_at=scheduled_dt,
                    )
                    company = os.getenv("COMPANY_NAME", "LumosLogic")
                    if _send_email_fn:
                        await _send_email_fn(
                            to_email=recruiter["email"],
                            to_name=recruiter.get("name", "Recruiter"),
                            subject=f"[{company}] No-Show Alert — {candidate_name}",
                            html_body=html_rec,
                            smtp_config=smtp_config,
                        )
            except Exception as e:
                print(f"[Scheduler] Recruiter no-show email error: {e}")

        if candidate_id:
            _convex_client.mutation("timeline:log", {
                "candidateId": candidate_id,
                "eventType": "recruiter_email_sent",
                "actor": "system",
                "metadata": {"type": "no_show_alert"},
            })

    except Exception as e:
        print(f"[Scheduler] No-show handling error for {interview_id}: {e}")


# ── Public schedule_interview entry point ─────────────────────────────────────

def schedule_interview(interview_id: str, meeting_url: str, system_prompt: str,
                        bot_name: str, candidate_name: str, run_at: datetime,
                        recruiter_id: str = "", candidate_id: str = "",
                        role_name: str = "Interview", attempt_number: int = 1,
                        candidate_email: str = "", duration_minutes: int = 30,
                        scheduled_at_ms: int = 0):
    """Schedule bot join + email reminders + no-show check for one interview."""
    sid = interview_id

    # ── Bot join job ──────────────────────────────────────────────────────────
    job_id = f"interview_{sid}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        _bot_join_job,
        trigger="date",
        run_date=run_at,
        id=job_id,
        kwargs={
            "interview_id": sid,
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

    # ── Email reminders (only if ≥1h in the future) ───────────────────────────
    now_utc = datetime.now(timezone.utc)
    # Make run_at timezone-aware for comparison
    run_at_aware = run_at if run_at.tzinfo else run_at.replace(tzinfo=timezone.utc)
    sched_at_ms = scheduled_at_ms or int(run_at_aware.timestamp() * 1000)
    reminder_kwargs_base = dict(
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        meet_url=meeting_url,
        scheduled_at_ms=sched_at_ms,
        role_name=role_name,
        duration_minutes=duration_minutes,
        candidate_id=candidate_id,
    )

    if candidate_email:
        reminder_24h = run_at_aware - timedelta(hours=24)
        if reminder_24h > now_utc:
            jid = f"reminder_24h_{sid}"
            if scheduler.get_job(jid):
                scheduler.remove_job(jid)
            scheduler.add_job(
                _send_reminder_job, trigger="date", run_date=reminder_24h.replace(tzinfo=None),
                id=jid, kwargs={**reminder_kwargs_base, "hours_before": 24},
            )
            print(f"[Scheduler] 24h reminder scheduled for {candidate_email} at {reminder_24h.isoformat()}")

        reminder_1h = run_at_aware - timedelta(hours=1)
        if reminder_1h > now_utc:
            jid = f"reminder_1h_{sid}"
            if scheduler.get_job(jid):
                scheduler.remove_job(jid)
            scheduler.add_job(
                _send_reminder_job, trigger="date", run_date=reminder_1h.replace(tzinfo=None),
                id=jid, kwargs={**reminder_kwargs_base, "hours_before": 1},
            )
            print(f"[Scheduler] 1h reminder scheduled for {candidate_email} at {reminder_1h.isoformat()}")

    # ── No-show grace period check (fires 15 min after scheduled time) ────────
    no_show_at = run_at_aware + timedelta(minutes=15)
    ns_jid = f"no_show_check_{sid}"
    if scheduler.get_job(ns_jid):
        scheduler.remove_job(ns_jid)
    scheduler.add_job(
        _no_show_check_job,
        trigger="date",
        run_date=no_show_at.replace(tzinfo=None),
        id=ns_jid,
        kwargs={
            "interview_id": sid,
            "candidate_id": candidate_id,
            "candidate_name": candidate_name,
            "candidate_email": candidate_email,
            "role_name": role_name,
            "recruiter_id": recruiter_id,
            "attempt_number": attempt_number,
            "scheduled_at_ms": sched_at_ms,
        },
    )

    print(f"[Scheduler] Interview {sid} fully scheduled: bot@{run_at.isoformat()}, "
          f"no-show-check@{no_show_at.isoformat()}")


def cancel_interview(interview_id: str):
    """Cancel all jobs associated with an interview."""
    sid = interview_id
    for prefix in ("interview_", "reminder_24h_", "reminder_1h_", "no_show_check_"):
        jid = f"{prefix}{sid}"
        if scheduler.get_job(jid):
            scheduler.remove_job(jid)
            print(f"[Scheduler] Cancelled job {jid}")


# ── Recurring background jobs ─────────────────────────────────────────────────

async def _force_kill_stale_sessions():
    """Every 5 min: safety-net for sessions running longer than 90 minutes.
    Normally the bot leaves on its own once the interview is complete (goodbye detection).
    This job is only a fallback for cases where goodbye was never triggered."""
    if not _sessions_ref or not _auto_end_fn:
        return
    now = datetime.now(timezone.utc).timestamp()
    stale = []
    for bot_id, session in list(_sessions_ref.items()):
        created_at = session.get("created_at", now)
        if (now - created_at) / 60 > 90:
            stale.append((bot_id, session))
    for bot_id, session in stale:
        age_m = int((now - session.get("created_at", now)) / 60)
        print(f"[Scheduler] Force-killing stale session {bot_id} (age={age_m}m) — goodbye not detected")
        pipeline = session.get("pipeline")
        if pipeline and not getattr(pipeline, "_session_end_triggered", False):
            # Attempt a graceful goodbye TTS before pulling the bot out
            farewell = (
                "Thank you so much for your time today. "
                "Our team will be in touch with you shortly regarding the next steps. "
                "You can now leave the call — have a great day!"
            )
            try:
                audio = await pipeline._tts(farewell)
                if audio and pipeline._on_response:
                    await pipeline._on_response(farewell, audio)
                await asyncio.sleep(6)  # let audio play before bot leaves
            except Exception as e:
                print(f"[Scheduler] Force-kill farewell TTS error (non-fatal): {e}")
        _sessions_ref.pop(bot_id, None)
        asyncio.create_task(
            _auto_end_fn(bot_id, session, session.get("candidate_name", "Candidate"))
        )


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
    scheduler.add_job(
        _force_kill_stale_sessions,
        trigger="interval", minutes=5,
        id="force_kill_stale", replace_existing=True,
    )
    scheduler.add_job(
        _run_daily_retry,
        trigger="cron", hour=9, minute=0,
        id="daily_retry", replace_existing=True,
    )
    print("[Scheduler] Recurring jobs registered: force-kill (5 min), daily retry (09:00 UTC)")


async def reload_pending(convex_client):
    """On server startup: reload all pending interviews from Convex."""
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
                    candidate_email=iv.get("candidateEmail", ""),
                    recruiter_id=iv.get("recruiterId", ""),
                    candidate_id=iv.get("candidateId", ""),
                    role_name=iv.get("roleName", "Interview"),
                    attempt_number=iv.get("attemptNumber", 1),
                    duration_minutes=iv.get("durationMinutes", 30),
                    scheduled_at_ms=iv.get("scheduledAt", 0),
                )
                count += 1
        print(f"[Scheduler] Reloaded {count} pending interview(s) from Convex")
    except Exception as e:
        print(f"[Scheduler] Reload error (non-fatal): {e}")
