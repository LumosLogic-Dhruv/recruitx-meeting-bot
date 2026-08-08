"""
email_service.py — Post-interview email functions extracted from main.py.

All functions accept convex_client as a parameter so they are testable
and independent of module-level state.

Exports:
    send_scorecard_email(...)
    send_recruiter_summary_email(...)
    send_no_show_email(...)
"""
from __future__ import annotations

import datetime
import os

from convex import ConvexClient


async def send_scorecard_email(
    convex: ConvexClient,
    candidate_name: str,
    candidate_email: str,
    scorecard: dict,
    role_name: str,
    attempt_number: int,
    candidate_id: str = "",
    log_fn=None,
) -> None:
    """Send scorecard result email to candidate after interview ends."""
    import email_templates as et
    import google_auth as gauth

    try:
        smtp_config = {}
        try:
            smtp_config = convex.query("settings:get", {"key": "smtp_config"}) or {}
        except Exception:
            pass

        company = os.getenv("COMPANY_NAME", "LumosLogic")
        is_final = attempt_number >= 2
        subject = (
            f"Your Final Interview Scorecard — {role_name} at {company}"
            if is_final else
            f"Your Interview Scorecard — {role_name} at {company}"
        )
        html = et.build_scorecard_email(
            candidate_name=candidate_name,
            scorecard=scorecard,
            role_name=role_name,
            attempt_number=attempt_number,
        )
        await gauth.send_email_smtp_generic(
            to_email=candidate_email,
            to_name=candidate_name,
            subject=subject,
            html_body=html,
            smtp_config=smtp_config,
        )
        if candidate_id and log_fn:
            log_fn(candidate_id, "scorecard_email_sent", metadata={
                "attemptNumber": attempt_number,
                "score": scorecard.get("overall_score"),
            })
    except Exception as e:
        print(f"[Email] Scorecard email error: {e}")


async def send_recruiter_summary_email(
    convex: ConvexClient,
    recruiter_id: str,
    candidate_name: str,
    role_name: str,
    attempt_number: int,
    scorecard: dict,
    interview_status: str,
    recording_url: str = "",
    meeting_id: str = "",
) -> None:
    """Send interview summary email to the recruiter who owns this candidate."""
    import email_templates as et
    import google_auth as gauth

    try:
        recruiter = convex.query("users:getById", {"id": recruiter_id})
        if not recruiter or not recruiter.get("email"):
            print(f"[Email] No recruiter found for id={recruiter_id}")
            return
        smtp_config = convex.query("settings:get", {"key": "smtp_config"}) or {}
        frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
        dashboard_url = f"{frontend_url}/admin" if frontend_url else ""
        company = os.getenv("COMPANY_NAME", "LumosLogic")
        html = et.build_recruiter_summary_email(
            recruiter_name=recruiter.get("name", "Recruiter"),
            candidate_name=candidate_name,
            role_name=role_name,
            attempt_number=attempt_number,
            scorecard=scorecard,
            interview_status=interview_status,
            recording_url=recording_url,
            dashboard_url=dashboard_url,
        )
        await gauth.send_email_smtp_generic(
            to_email=recruiter["email"],
            to_name=recruiter.get("name", "Recruiter"),
            subject=f"[{company}] Interview Result — {candidate_name} ({role_name})",
            html_body=html,
            smtp_config=smtp_config,
        )
    except Exception as e:
        print(f"[Email] Recruiter summary email error: {e}")


async def send_no_show_email(
    convex: ConvexClient,
    candidate_name: str,
    candidate_email: str,
    role_name: str,
    attempt_number: int,
    candidate_id: str = "",
    recruiter_id: str = "",
    scheduled_at_ms: int = 0,
    log_fn=None,
) -> None:
    """Send no-show notification to candidate and recruiter."""
    import email_templates as et
    import google_auth as gauth

    try:
        smtp_config = convex.query("settings:get", {"key": "smtp_config"}) or {}
        company = os.getenv("COMPANY_NAME", "LumosLogic")

        html_cand = et.build_no_show_email(
            candidate_name=candidate_name,
            role_name=role_name,
            attempt_number=attempt_number,
        )
        await gauth.send_email_smtp_generic(
            to_email=candidate_email,
            to_name=candidate_name,
            subject=f"[{company}] Missed Interview — {role_name}",
            html_body=html_cand,
            smtp_config=smtp_config,
        )
        if log_fn and candidate_id:
            log_fn(candidate_id, "scorecard_email_sent", actor="system",
                   metadata={"type": "no_show", "attemptNumber": attempt_number})

        if recruiter_id:
            try:
                recruiter = convex.query("users:getById", {"id": recruiter_id})
                if recruiter:
                    sched_dt = (
                        datetime.datetime.fromtimestamp(scheduled_at_ms / 1000, tz=datetime.timezone.utc)
                        if scheduled_at_ms else datetime.datetime.now(datetime.timezone.utc)
                    )
                    html_rec = et.build_recruiter_no_show_email(
                        recruiter_name=recruiter.get("name", "Recruiter"),
                        candidate_name=candidate_name,
                        role_name=role_name,
                        attempt_number=attempt_number,
                        scheduled_at=sched_dt,
                    )
                    await gauth.send_email_smtp_generic(
                        to_email=recruiter["email"],
                        to_name=recruiter.get("name", "Recruiter"),
                        subject=f"[{company}] No-Show Alert — {candidate_name}",
                        html_body=html_rec,
                        smtp_config=smtp_config,
                    )
            except Exception as e:
                print(f"[Email] Recruiter no-show email error: {e}")
    except Exception as e:
        print(f"[Email] No-show email error: {e}")
