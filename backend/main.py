import asyncio
import io
import os
import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends, Header, UploadFile, File, Form
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import jwt
import bcrypt
from convex import ConvexClient
import pypdf

from recall_client import RecallClient
from pipeline import ConversationPipeline
import google_auth as gauth
import scheduler as sched

load_dotenv()

# Convex Client Setup
CONVEX_URL = os.getenv("CONVEX_URL", "https://focused-poodle-713.eu-west-1.convex.cloud")
convex_client = ConvexClient(CONVEX_URL)

CUSTOM_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "SNr51KAoFWjq7b0L9cRb")

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-key-change-me")

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid token")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        # Back-fill role for old tokens that predate the RBAC change
        if "role" not in payload:
            payload["role"] = "recruiter"
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    except Exception as e:
        raise HTTPException(401, f"Authentication error: {str(e)}")

@asynccontextmanager
async def lifespan(application: FastAPI):
    import retry_service
    retry_service.init(
        convex_client=convex_client,
        schedule_fn=sched.schedule_interview,
        gauth_module=gauth,
    )
    sched.init(
        create_session_fn=_scheduled_create_session,
        convex_client=convex_client,
        sessions_ref=_sessions,
        auto_end_fn=_auto_end_session,
        retry_fn=retry_service.process_cooldown_candidates,
        send_email_fn=gauth.send_email_smtp_generic,
    )
    sched.scheduler.start()
    sched.start_recurring_jobs()
    await sched.reload_pending(convex_client)
    yield
    sched.scheduler.shutdown(wait=False)


app = FastAPI(title="RecruitX AI Interviewer Bot Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# bot_id → session data
_sessions: dict[str, dict] = {}
# meeting_url → bot_id
_url_to_bot: dict[str, str] = {}


def _log_timeline(candidate_id: str, event_type: str, actor: str = "system", metadata: dict = None):
    """Fire-and-forget timeline event log. Never raises."""
    if not candidate_id:
        return
    try:
        payload = {"candidateId": candidate_id, "eventType": event_type, "actor": actor}
        if metadata:
            payload["metadata"] = metadata
        convex_client.mutation("timeline:log", payload)
    except Exception as e:
        print(f"[Timeline] Log error ({event_type}): {e}")
# bot_id → set of "speaker:text" keys already forwarded to the pipeline.
# Prevents Deepgram from re-delivering a corrected/duplicate final segment and
# triggering a second AI response for text the pipeline has already processed.
_seen_segments: dict[str, set] = {}


class StartInterviewRequest(BaseModel):
    meeting_url: str
    system_prompt: str
    bot_name: str = "RecruitX AI Interviewer"
    candidate_name: str = "Candidate"


class EndInterviewRequest(BaseModel):
    meeting_url: str
    candidate_name: str = "Candidate"


def _make_recall() -> RecallClient:
    # RECALL_API_URL must match your Recall.ai region.
    # Default: us-east-1. If your dashboard is ap-northeast-1, set:
    #   RECALL_API_URL=https://ap-northeast-1.recall.ai/api/v1
    return RecallClient(
        api_key=os.getenv("RECALL_API_KEY", ""),
        base_url=os.getenv("RECALL_API_URL", "https://us-east-1.recall.ai/api/v1"),
    )



def _webhook_url() -> str:
    base = os.getenv("RENDER_URL", "").rstrip("/")
    return f"{base}/webhook/recall" if base else ""


@app.get("/")
def root():
    return {"service": "RecruitX Backend", "status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok", "active_sessions": list(_sessions.keys())}


@app.post("/start-interview")
async def start_interview(req: StartInterviewRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    if req.meeting_url in _url_to_bot:
        raise HTTPException(400, "Interview already active for this meeting URL")

    recall = _make_recall()
    pipeline = ConversationPipeline(
        system_prompt=req.system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
        elevenlabs_key=os.getenv("ELEVENLABS_API_KEY", ""),
        voice_id=CUSTOM_VOICE_ID,
    )
    print(f"[Pipeline] Voice: {CUSTOM_VOICE_ID}")

    async def on_ai_response(text: str, audio_bytes: bytes):
        for attempt in range(3):
            try:
                await recall.speak(bot_id, audio_bytes)
                return
            except Exception as e:
                print(f"[Recall] Speak error attempt {attempt + 1}/3: {e}")
                if attempt < 2:
                    await asyncio.sleep(3)

    pipeline.set_response_callback(on_ai_response)

    bot_data = await recall.create_bot(
        req.meeting_url,
        req.bot_name,
        webhook_url=_webhook_url(),
    )
    bot_id = bot_data["id"]
    print(f"[Recall] Bot created: {bot_id}")

    import time as _time
    stop_event = asyncio.Event()
    _sessions[bot_id] = {
        "bot_id": bot_id,
        "meeting_url": req.meeting_url,
        "bot_name": req.bot_name,
        "candidate_name": req.candidate_name,
        "stop_event": stop_event,
        "recall": recall,
        "pipeline": pipeline,
        "seen_transcript_count": 0,
        "greeted": False,
        "greeted_to_human": False,
        "candidate_absent": False,
        "candidate_was_absent": False,
        "candidate_ever_joined": False,
        "created_at": _time.time(),
        "bot_status": "joining",
    }
    _url_to_bot[req.meeting_url] = bot_id

    # Wire up auto-end callback: fires when pipeline detects the bot said goodbye
    async def _on_pipeline_session_end():
        session_data = _sessions.pop(bot_id, None)
        if session_data:
            _url_to_bot.pop(session_data.get("meeting_url", ""), None)
            _seen_segments.pop(bot_id, None)
            print(f"[Pipeline] Goodbye detected — auto-ending session {bot_id}")
            asyncio.create_task(_auto_end_session(bot_id, session_data, req.candidate_name))

    pipeline.set_session_end_callback(_on_pipeline_session_end)

    # Always start a polling task as a fallback in case webhooks aren't configured
    # in the Recall.ai dashboard. The pipeline's _speaking flag prevents double-processing.
    task = asyncio.create_task(_poll_and_greet(bot_id))
    _sessions[bot_id]["task"] = task

    return {"status": "started", "bot_id": bot_id, "meeting_url": req.meeting_url}


async def _poll_and_greet(bot_id: str):
    """Wait for bot to join, send greeting, then poll transcript as fallback."""
    session = _sessions.get(bot_id)
    if not session:
        return

    recall: RecallClient = session["recall"]
    pipeline: ConversationPipeline = session["pipeline"]
    bot_name: str = session["bot_name"]
    candidate_name: str = session.get("candidate_name", "Candidate")
    stop_event: asyncio.Event = session["stop_event"]

    # Wait until bot is in the call
    print("[Poll] Waiting for bot to join call...")
    for _ in range(60):
        if stop_event.is_set():
            return
        await asyncio.sleep(8)
        try:
            bot = await recall.get_bot(bot_id)
            changes = bot.get("status_changes", [])
            status = changes[-1].get("code", "") if changes else ""
            print(f"[Poll] Bot status: {status}")
            if status in ("in_call_not_recording", "in_call_recording"):
                break
        except Exception as e:
            print(f"[Poll] Status check error: {e}")
    else:
        print("[Poll] Timed out waiting for bot to join.")
        return

    # Send greeting if webhook path hasn't delivered it yet.
    # If webhook did TTS but speak failed, greeting_audio is stored so we can
    # retry the speak without re-doing TTS (which would duplicate history).
    await asyncio.sleep(3)
    session = _sessions.get(bot_id)
    if session and not session.get("greeted"):
        session["greeted"] = True
        stored_audio = session.pop("greeting_audio", None)
        if stored_audio:
            print("[Poll] Retrying greeting speak (webhook TTS already done)...")
            try:
                await recall.speak(bot_id, stored_audio)
                print("[Poll] Greeting speak retry succeeded")
            except Exception as e:
                print(f"[Poll] Greeting speak retry error: {e}")
        else:
            print("[Poll] Sending greeting via polling path...")
            try:
                audio = await pipeline.send_greeting(bot_name)
                print(f"[Poll] Greeting TTS ready: {len(audio)} bytes")
                await recall.speak(bot_id, audio)
                print("[Poll] Greeting delivered via poll path")
            except Exception as e:
                print(f"[Poll] Greeting error: {e}")

    # Health-check loop: poll bot status every 30 s to catch hung/dropped sessions.
    # Recall.ai webhooks are the primary signal; this is the safety net.
    print("[Poll] Health-check loop started (30 s interval)...")
    consecutive_errors = 0
    while not stop_event.is_set():
        await asyncio.sleep(30)
        if stop_event.is_set():
            break
        try:
            bot = await recall.get_bot(bot_id)
            changes = bot.get("status_changes", [])
            status = changes[-1].get("code", "") if changes else ""
            if status in ("done", "fatal", "error", "call_ended"):
                print(f"[Poll] Health-check detected terminal status={status} — triggering auto-end")
                session_data = _sessions.pop(bot_id, None)
                if session_data:
                    _url_to_bot.pop(session_data.get("meeting_url", ""), None)
                    _seen_segments.pop(bot_id, None)
                    asyncio.create_task(_auto_end_session(bot_id, session_data, candidate_name))
                break
            consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            print(f"[Poll] Health-check error #{consecutive_errors}: {e}")
            if consecutive_errors >= 3:
                print("[Poll] 3 consecutive health-check failures — triggering auto-end")
                session_data = _sessions.pop(bot_id, None)
                if session_data:
                    _url_to_bot.pop(session_data.get("meeting_url", ""), None)
                    _seen_segments.pop(bot_id, None)
                    asyncio.create_task(_auto_end_session(bot_id, session_data, candidate_name))
                break


@app.post("/webhook/recall")
async def recall_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive real-time events from Recall.ai (configure webhook URL in Recall dashboard)."""
    body = await request.json()
    event = body.get("event", "")
    data = body.get("data", {})
    print(f"[Webhook] Event: {event}")

    # Bot entered Google Meet waiting room — recruiter must admit it
    if event == "bot.in_waiting_room":
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.get(bot_id)
        if session:
            session["bot_status"] = "in_waiting_room"
            _log_timeline(session.get("candidate_id", ""), "bot_waiting_room",
                         metadata={"message": "Bot is in waiting room, recruiter must admit it"})
            print(f"[Webhook] Bot {bot_id} is in WAITING ROOM — recruiter must admit it in Google Meet")

    # Bot joined the call — send greeting
    if event in ("bot.in_call_recording", "bot.in_call_not_recording"):
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.get(bot_id)
        if session:
            session["bot_status"] = "in_call"
        # Use greeting_in_progress to prevent double-scheduling while NOT blocking
        # the poll path from retrying if the webhook speak fails.
        if session and not session.get("greeted") and not session.get("greeting_in_progress"):
            session["greeting_in_progress"] = True
            background_tasks.add_task(_webhook_greeting, bot_id)

    # Meeting ended naturally — auto-end the session, generate scorecard, save recording
    if event in ("bot.done", "bot.call_ended", "bot.fatal"):
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.pop(bot_id, None)
        if session:
            meeting_url = session.get("meeting_url", "")
            _url_to_bot.pop(meeting_url, None)
            _seen_segments.pop(bot_id, None)
            candidate_name = session.get("candidate_name", "Candidate")
            print(f"[Webhook] {event} — auto-ending session {bot_id} for {candidate_name}")
            background_tasks.add_task(_auto_end_session, bot_id, session, candidate_name)

    # recording.done — Recall.ai fires this when ALL media objects for the recording
    # are fully processed and the download_url is ready. This is the authoritative signal.
    # Also handle bot.media_shortcuts_updated which fires when shortcuts are refreshed.
    if event in ("recording.done", "bot.media_shortcuts_updated"):
        try:
            from recording import handle_recording_webhook
            background_tasks.add_task(handle_recording_webhook, convex_client, body)
        except Exception as _rec_err:
            print(f"[Webhook] Recording module hook error (non-fatal): {_rec_err}")

        # Additionally: immediately fetch and store the recording URL in the meetings table
        # using the bot_id from the payload so the history page shows it right away.
        _rec_bot_id = (
            (body.get("data") or {}).get("bot", {}).get("id")
            or (body.get("data") or {}).get("data", {}).get("bot", {}).get("id")
            or ""
        )
        if _rec_bot_id:
            background_tasks.add_task(_fetch_recording_on_webhook, _rec_bot_id)

    # Participant joined the call — resume pipeline, greet first-timers or re-greet rejoinders
    if event == "participant.join":
        bot_id = data.get("bot", {}).get("id", "")
        participant = data.get("data", {}).get("participant", {})
        participant_name = participant.get("name", "")
        session = _sessions.get(bot_id)
        if session and participant_name.lower() != session.get("bot_name", "").lower():
            session["candidate_absent"] = False
            print(f"[Webhook] Participant joined: {participant_name}")

            pipeline: ConversationPipeline | None = session.get("pipeline")

            if session.get("candidate_was_absent"):
                # ── Rejoin after a disconnect ──────────────────────────────────
                # Candidate was here before, left, and came back.
                session["candidate_was_absent"] = False
                if pipeline:
                    pipeline.resume()
                background_tasks.add_task(_send_rejoin_greeting, bot_id)
                _log_timeline(session.get("candidate_id", ""), "candidate_rejoined",
                              metadata={"participantName": participant_name})

            elif not session.get("candidate_ever_joined"):
                # ── First join (possibly late) ────────────────────────────────
                # Bot greeted an empty room; candidate just arrived for the first time.
                session["candidate_ever_joined"] = True
                if pipeline:
                    pipeline.resume()
                # Send the opening greeting now that someone is actually listening.
                if not session.get("greeted"):
                    session["greeted"] = True
                    background_tasks.add_task(_webhook_greeting, bot_id)
                else:
                    # Bot already greeted empty room — send a fresh start message.
                    background_tasks.add_task(_send_late_join_greeting, bot_id)
                _log_timeline(session.get("candidate_id", ""), "candidate_joined",
                              metadata={"participantName": participant_name, "lateJoin": True})
            else:
                # Normal on-time join — already handled by _webhook_greeting
                session["candidate_ever_joined"] = True
                if pipeline:
                    pipeline.resume()
                _log_timeline(session.get("candidate_id", ""), "candidate_joined",
                              metadata={"participantName": participant_name})

    # Participant left the call — PAUSE pipeline so AI doesn't speak to an empty room
    if event == "participant.leave":
        bot_id = data.get("bot", {}).get("id", "")
        participant = data.get("data", {}).get("participant", {})
        participant_name = participant.get("name", "")
        session = _sessions.get(bot_id)
        if session and participant_name.lower() != session.get("bot_name", "").lower():
            session["candidate_absent"] = True
            session["candidate_was_absent"] = True
            pipeline: ConversationPipeline | None = session.get("pipeline")
            if pipeline:
                pipeline.pause()    # cancels silence timer — no speaking to empty room
            print(f"[Webhook] Participant left: {participant_name} — pipeline paused, waiting for rejoin or 3-min timeout")
            _log_timeline(session.get("candidate_id", ""), "candidate_left",
                          metadata={"participantName": participant_name})

    # Real-time transcript events from Recall.ai realtime_endpoints
    # transcript.partial_data = interim words (candidate is mid-sentence)
    # transcript.data         = finalized utterance (Deepgram endpointing fired)
    if event in ("transcript.data", "transcript.partial_data"):
        is_final = event == "transcript.data"
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.get(bot_id)
        if not session:
            return {"ok": True}

        pipeline: ConversationPipeline = session["pipeline"]
        bot_name: str = session["bot_name"]

        inner = data.get("data", {})
        words = inner.get("words", [])
        participant = inner.get("participant", {})
        speaker = participant.get("name") or "Candidate"

        if words and speaker.lower() != bot_name.lower():
            text = " ".join(w.get("text", "") for w in words).strip()
            if not text:
                return {"ok": True}

            if is_final:
                # Deduplicate final segments — Deepgram occasionally re-delivers a
                # corrected version of the same utterance. Prevents double AI responses.
                # BUG_03 fix: short phrases (≤ 3 words, e.g. "Hello?", "Are you there?")
                # are NOT deduplicated so the candidate can repeatedly say them to wake
                # up an unresponsive bot. Long phrases are still deduplicated normally.
                word_count_check = len(text.split())
                if word_count_check > 3:
                    seen = _seen_segments.setdefault(bot_id, set())
                    segment_key = f"{speaker}:{text}"
                    if segment_key in seen:
                        print(f"[Webhook] Duplicate final skipped: {text[:50]}")
                        return {"ok": True}
                    seen.add(segment_key)
                    if len(seen) > 400:
                        seen.clear()
                print(f"[Webhook] FINAL — {speaker}: {text}")
                pipeline.on_transcript_update(text, speaker)
            else:
                # Partial: only reset the silence timer so the pipeline knows
                # the candidate is still speaking. Do NOT accumulate partial text —
                # the final event will deliver the clean, punctuated version.
                print(f"[Webhook] PARTIAL — {speaker}: {text[:50]}…")
                pipeline.on_partial_transcript(speaker)

    return {"ok": True}


async def _webhook_greeting(bot_id: str):
    """Send greeting triggered by webhook event (bot joined)."""
    await asyncio.sleep(3)
    session = _sessions.get(bot_id)
    if not session:
        return
    pipeline: ConversationPipeline = session["pipeline"]
    recall: RecallClient = session["recall"]
    bot_name: str = session["bot_name"]
    print(f"[Webhook] Sending greeting for bot {bot_id}...")
    try:
        audio = await pipeline.send_greeting(bot_name)
        print(f"[Webhook] Greeting TTS ready: {len(audio)} bytes")
        # Store audio so poll path can retry the speak without re-doing TTS
        session["greeting_audio"] = audio
    except Exception as e:
        print(f"[Webhook] Greeting TTS error for bot {bot_id}: {e}")
        return
    for attempt in range(3):
        s = _sessions.get(bot_id)
        if not s:
            return
        try:
            await recall.speak(bot_id, audio)
            s["greeted"] = True
            s.pop("greeting_audio", None)
            print(f"[Webhook] Greeting delivered (attempt {attempt + 1}) for bot {bot_id}")
            return
        except Exception as e:
            print(f"[Webhook] Speak attempt {attempt + 1}/3 for bot {bot_id}: {e}")
            if attempt < 2:
                await asyncio.sleep(5)
    print(f"[Webhook] All greeting speak attempts failed for bot {bot_id} — poll path will retry")


async def _send_recruiter_summary_email(
    recruiter_id: str, candidate_name: str, role_name: str,
    attempt_number: int, scorecard: dict, interview_status: str,
    recording_url: str = "", meeting_id: str = "",
):
    """Send interview summary email to the recruiter who owns this candidate."""
    import email_templates as et
    try:
        recruiter = convex_client.query("users:getById", {"id": recruiter_id})
        if not recruiter or not recruiter.get("email"):
            print(f"[Email] No recruiter found for id={recruiter_id}")
            return
        smtp_config = convex_client.query("settings:get", {"key": "smtp_config"}) or {}
        frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
        dashboard_url = f"{frontend_url}/admin" if frontend_url else ""
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
        company = os.getenv("COMPANY_NAME", "LumosLogic")
        subject = f"[{company}] Interview Result — {candidate_name} ({role_name})"
        await gauth.send_email_smtp_generic(
            to_email=recruiter["email"],
            to_name=recruiter.get("name", "Recruiter"),
            subject=subject,
            html_body=html,
            smtp_config=smtp_config,
        )
    except Exception as e:
        print(f"[Email] Recruiter summary email error: {e}")


async def _send_scorecard_email(candidate_name: str, candidate_email: str,
                                scorecard: dict, role_name: str, attempt_number: int,
                                candidate_id: str = ""):
    """Send scorecard result email to candidate after interview ends."""
    import email_templates as et
    try:
        smtp_config = {}
        try:
            smtp_config = convex_client.query("settings:get", {"key": "smtp_config"}) or {}
        except Exception:
            pass
        is_final = attempt_number >= 2
        subject = (
            f"Your Final Interview Scorecard — {role_name} at {os.getenv('COMPANY_NAME','LumosLogic')}"
            if is_final else
            f"Your Interview Scorecard — {role_name} at {os.getenv('COMPANY_NAME','LumosLogic')}"
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
        if candidate_id:
            _log_timeline(candidate_id, "scorecard_email_sent",
                          metadata={"attemptNumber": attempt_number,
                                    "score": scorecard.get("overall_score")})
    except Exception as e:
        print(f"[Email] Scorecard email error: {e}")


async def _send_no_show_email(candidate_name: str, candidate_email: str,
                              role_name: str, attempt_number: int,
                              candidate_id: str = "", recruiter_id: str = "",
                              scheduled_at_ms: int = 0):
    """Send no-show notification to candidate and recruiter when bot.done fires with no transcript."""
    import email_templates as et
    import datetime as _dt
    try:
        smtp_config = convex_client.query("settings:get", {"key": "smtp_config"}) or {}
        company = os.getenv("COMPANY_NAME", "LumosLogic")

        # Email candidate
        html_cand = et.build_no_show_email(
            candidate_name=candidate_name,
            role_name=role_name,
            attempt_number=attempt_number,
        )
        await gauth.send_email_smtp_generic(
            to_email=candidate_email, to_name=candidate_name,
            subject=f"[{company}] Missed Interview — {role_name}",
            html_body=html_cand, smtp_config=smtp_config,
        )
        _log_timeline(candidate_id, "scorecard_email_sent",
                      actor="system", metadata={"type": "no_show", "attemptNumber": attempt_number})

        # Email recruiter
        if recruiter_id:
            try:
                recruiter = convex_client.query("users:getById", {"id": recruiter_id})
                if recruiter:
                    sched_dt = (_dt.datetime.fromtimestamp(scheduled_at_ms / 1000, tz=_dt.timezone.utc)
                                if scheduled_at_ms else _dt.datetime.now(_dt.timezone.utc))
                    html_rec = et.build_recruiter_no_show_email(
                        recruiter_name=recruiter.get("name", "Recruiter"),
                        candidate_name=candidate_name,
                        role_name=role_name,
                        attempt_number=attempt_number,
                        scheduled_at=sched_dt,
                    )
                    await gauth.send_email_smtp_generic(
                        to_email=recruiter["email"], to_name=recruiter.get("name", "Recruiter"),
                        subject=f"[{company}] No-Show Alert — {candidate_name}",
                        html_body=html_rec, smtp_config=smtp_config,
                    )
            except Exception as e:
                print(f"[Email] Recruiter no-show email error: {e}")
    except Exception as e:
        print(f"[Email] No-show email error: {e}")


async def _send_rejoin_greeting(bot_id: str):
    """Send re-orientation message when candidate comes back after disconnecting mid-interview."""
    await asyncio.sleep(2)
    session = _sessions.get(bot_id)
    if not session:
        return
    pipeline: ConversationPipeline = session.get("pipeline")
    recall: RecallClient = session.get("recall")
    if not pipeline or not recall:
        return
    try:
        nudge = "Welcome back — let's pick up where we left off."
        audio = await pipeline._tts(nudge)
        if not audio:
            return
    except Exception as e:
        print(f"[Webhook] Rejoin TTS error: {e}")
        return
    for attempt in range(3):
        s = _sessions.get(bot_id)
        if not s:
            return
        try:
            await recall.speak(bot_id, audio)
            return
        except Exception as e:
            print(f"[Webhook] Rejoin speak attempt {attempt + 1}/3: {e}")
            if attempt < 2:
                await asyncio.sleep(3)


async def _send_late_join_greeting(bot_id: str):
    """Greet a candidate who joined late (bot already greeted an empty room earlier)."""
    await asyncio.sleep(2)
    session = _sessions.get(bot_id)
    if not session:
        return
    pipeline: ConversationPipeline = session.get("pipeline")
    recall: RecallClient = session.get("recall")
    bot_name: str = session.get("bot_name", "RecruitX AI")
    if not pipeline or not recall:
        return
    try:
        greeting = (
            f"Hey, thanks for joining! I'm {bot_name}. "
            "So just to kick things off — tell me a bit about yourself and what you've been working on lately."
        )
        audio = await pipeline._tts(greeting)
        if not audio:
            return
        print(f"[Webhook] Late-join greeting TTS: {len(audio)} bytes for bot {bot_id}")
    except Exception as e:
        print(f"[Webhook] Late-join TTS error: {e}")
        return
    for attempt in range(3):
        s = _sessions.get(bot_id)
        if not s:
            return
        try:
            await recall.speak(bot_id, audio)
            print(f"[Webhook] Late-join greeting delivered (attempt {attempt + 1})")
            return
        except Exception as e:
            print(f"[Webhook] Late-join speak attempt {attempt + 1}/3: {e}")
            if attempt < 2:
                await asyncio.sleep(3)


async def _auto_end_session(bot_id: str, session: dict, candidate_name: str):
    """Called when Recall.ai fires bot.done — auto-generates scorecard and saves everything."""
    # Stop the polling task
    stop_event = session.get("stop_event")
    if stop_event:
        stop_event.set()
    task = session.get("task")
    if task:
        task.cancel()

    recall: RecallClient = session.get("recall") or _make_recall()
    try:
        await recall.stop_bot(bot_id)
    except Exception as e:
        print(f"[AutoEnd] stop_bot error (non-fatal): {e}")
    finally:
        try:
            await recall.aclose()
        except Exception:
            pass

    pipeline: ConversationPipeline = session.get("pipeline")
    transcript_list = pipeline.get_transcript_list() if pipeline else []
    transcript_text = pipeline.get_transcript_text() if pipeline else ""

    # Classify the interview outcome by word count
    word_count = len(transcript_text.split()) if transcript_text else 0
    if word_count >= 200:
        interview_status = "completed"
    elif word_count >= 100:
        interview_status = "partial"
    else:
        interview_status = "no_show"

    print(f"[AutoEnd] Transcript words={word_count}, status={interview_status}")

    scorecard = {}
    if pipeline and word_count >= 100:
        print(f"[AutoEnd] Generating scorecard for {candidate_name}...")
        try:
            scorecard = await pipeline.generate_scorecard(candidate_name)
            print("[AutoEnd] Scorecard done.")
        except Exception as e:
            print(f"[AutoEnd] Scorecard error: {e}")
    elif word_count < 100:
        print(f"[AutoEnd] Skipping scorecard — too little transcript ({word_count} words)")

    if pipeline:
        try:
            await pipeline.aclose()
        except Exception:
            pass

    meeting_id = None
    try:
        meeting_id = convex_client.mutation(
            "meetings:create",
            {
                "meetingUrl": session.get("meeting_url", ""),
                "candidateName": candidate_name,
                "botName": session.get("bot_name") or "RecruitX AI Interviewer",
                "transcript": transcript_list,
                "transcriptText": transcript_text,
                "wordCount": word_count,
                "scorecard": scorecard,
                "botId": bot_id,
                "interviewStatus": interview_status,
                "recruiterId": session.get("recruiter_id") or "",
                "roleName": session.get("role_name") or "Interview",
                "attemptNumber": session.get("attempt_number") or 1,
            },
        )
        print(f"[AutoEnd] Meeting stored: {meeting_id}")
    except Exception as e:
        print(f"[AutoEnd] Convex save error: {e}")

    # ── Emails — send immediately, fire-and-forget ───────────────────────────────
    candidate_email = session.get("candidate_email", "")
    recruiter_id    = session.get("recruiter_id", "")
    role_name       = session.get("role_name", "Interview")
    attempt_number  = session.get("attempt_number", 1)
    candidate_id_   = session.get("candidate_id", "")

    if candidate_email and scorecard and word_count >= 100:
        # Candidate scorecard email
        asyncio.create_task(
            _send_scorecard_email(
                candidate_name=candidate_name,
                candidate_email=candidate_email,
                scorecard=scorecard,
                role_name=role_name,
                attempt_number=attempt_number,
                candidate_id=candidate_id_,
            )
        )
        # Recruiter summary email — sent NOW (not after recording which can take 2-5 min
        # and sometimes never arrives). Recording URL is checked on the dashboard.
        if recruiter_id:
            asyncio.create_task(
                _send_recruiter_summary_email(
                    recruiter_id=recruiter_id,
                    candidate_name=candidate_name,
                    role_name=role_name,
                    attempt_number=attempt_number,
                    scorecard=scorecard,
                    interview_status=interview_status,
                    recording_url="",         # recording not ready yet — recruiter checks dashboard
                    meeting_id=str(meeting_id) if meeting_id else "",
                )
            )
    elif candidate_email and interview_status == "no_show":
        # No-show → notify candidate so they know they missed it
        asyncio.create_task(
            _send_no_show_email(
                candidate_name=candidate_name,
                candidate_email=candidate_email,
                role_name=role_name,
                attempt_number=attempt_number,
                candidate_id=candidate_id_,
                recruiter_id=recruiter_id,
                scheduled_at_ms=session.get("scheduled_at_ms", 0),
            )
        )

    if meeting_id:
        asyncio.create_task(
            _fetch_and_store_recording(
                bot_id, str(meeting_id),
                candidate_name=candidate_name,
                interview_status=interview_status,
                recruiter_id=session.get("recruiter_id"),
                role_name=session.get("role_name", "Interview"),
                attempt_number=session.get("attempt_number", 1),
                scorecard=scorecard,
            )
        )

    # Update candidate interview state machine
    candidate_id = session.get("candidate_id")
    attempt_number = int(session.get("attempt_number") or 1)
    if candidate_id:
        try:
            if interview_status in ("completed", "partial"):
                if attempt_number == 1:
                    # Start 7-day cooldown
                    import time
                    cooldown_until = int(time.time() * 1000) + 7 * 24 * 60 * 60 * 1000
                    convex_client.mutation("candidates:updateStatus", {
                        "id": candidate_id,
                        "interviewStatus": "cooldown",
                        "attemptCount": 1,
                        "cooldownUntil": cooldown_until,
                    })
                    print(f"[AutoEnd] Candidate {candidate_id} set to cooldown (7 days)")
                else:
                    # Attempt 2 done — lock permanently
                    convex_client.mutation("candidates:updateStatus", {
                        "id": candidate_id,
                        "interviewStatus": "locked",
                        "attemptCount": 2,
                        "cooldownUntil": None,
                    })
                    print(f"[AutoEnd] Candidate {candidate_id} locked (final attempt done)")
            elif interview_status == "no_show":
                if attempt_number == 1:
                    import time
                    cooldown_until = int(time.time() * 1000) + 7 * 24 * 60 * 60 * 1000
                    convex_client.mutation("candidates:updateStatus", {
                        "id": candidate_id,
                        "interviewStatus": "cooldown",
                        "attemptCount": 1,
                        "cooldownUntil": cooldown_until,
                    })
                    print(f"[AutoEnd] No-show candidate {candidate_id} still gets cooldown+retry")
                else:
                    convex_client.mutation("candidates:updateStatus", {
                        "id": candidate_id,
                        "interviewStatus": "locked",
                        "attemptCount": 2,
                    })
        except Exception as e:
            print(f"[AutoEnd] Candidate status update error: {e}")

    # If this was a scheduled session, mark it completed
    scheduled_id = session.get("scheduled_interview_id")
    if scheduled_id:
        try:
            convex_client.mutation("scheduledInterviews:updateStatus", {
                "id": scheduled_id,
                "status": "completed",
                **({"meetingId": str(meeting_id)} if meeting_id else {}),
            })
        except Exception as e:
            print(f"[AutoEnd] Failed to update scheduledInterview {scheduled_id}: {e}")

    # Timeline events
    if candidate_id:
        _log_timeline(candidate_id, "interview_ended", metadata={
            "status": interview_status, "wordCount": word_count,
            "attemptNumber": session.get("attempt_number", 1),
        })
        if scorecard and scorecard.get("overall_score"):
            _log_timeline(candidate_id, "score_generated", metadata={
                "overallScore": scorecard.get("overall_score"),
                "recommendation": scorecard.get("recommendation", ""),
                "attemptNumber": session.get("attempt_number", 1),
            })
        if interview_status in ("completed", "partial") and session.get("attempt_number", 1) == 1:
            _log_timeline(candidate_id, "cooldown_started",
                          metadata={"cooldownDays": 7, "attemptNumber": 1})
        if session.get("attempt_number", 1) >= 2:
            _log_timeline(candidate_id, "final_result", metadata={
                "overallScore": scorecard.get("overall_score") if scorecard else None,
                "recommendation": scorecard.get("recommendation", "") if scorecard else "",
            })


async def _fetch_recording_on_webhook(bot_id: str) -> None:
    """
    Triggered by recording.done / bot.media_shortcuts_updated webhook.
    Looks up the meeting by bot_id and immediately stores the recording URL.
    This is a fast path — the URL is ready, no polling needed.
    """
    if not bot_id:
        return
    try:
        # Find the meeting that owns this bot_id
        meeting = convex_client.query("meetings:getByBotId", {"botId": bot_id})
        if not meeting:
            print(f"[Recording/webhook] No meeting found for bot {bot_id} — skipping fast path")
            return
        meeting_id = str(meeting.get("_id", ""))
        if not meeting_id:
            return

        # Don't overwrite a URL we've already stored
        if meeting.get("recordingUrl"):
            print(f"[Recording/webhook] recordingUrl already set for meeting {meeting_id}")
            return

        recall = _make_recall()
        try:
            rec_url = await recall.fetch_recording_by_bot(bot_id)
            if rec_url:
                convex_client.mutation("meetings:updateRecording", {
                    "id": meeting_id,
                    "recordingUrl": rec_url,
                })
                print(f"[Recording/webhook] Fast-path URL stored for meeting {meeting_id}")
            else:
                print(f"[Recording/webhook] recording.done fired but URL still not ready — _fetch_and_store_recording will retry")
        finally:
            await recall.aclose()
    except Exception as e:
        print(f"[Recording/webhook] _fetch_recording_on_webhook error (non-fatal): {e}")


async def _fetch_and_store_recording(
    bot_id: str,
    meeting_id: str,
    candidate_name: str = "",
    interview_status: str = "completed",
    recruiter_id: str = None,
    role_name: str = "Interview",
    attempt_number: int = 1,
    scorecard: dict = None,
):
    """Background task: poll Recall.ai for the recording, then store URLs in Convex."""
    print(f"[Recording] Waiting for recording of bot {bot_id}...")
    recall = _make_recall()
    try:
        # poll_bot_recording returns the full bot dict once media_shortcuts.video_mixed_mp4
        # status == "done". extract_recording_urls then pulls all artefact URLs from it.
        bot_data = await recall.poll_bot_recording(bot_id, max_wait=300)
        if not bot_data:
            print(f"[Recording] Gave up waiting for bot {bot_id}")
            return

        urls = recall.extract_recording_urls(bot_data)
        recording_url       = urls["recording_url"]
        bot_audio_url       = urls["bot_audio_url"]
        candidate_audio_url = urls["candidate_audio_url"]

        try:
            convex_client.mutation(
                "meetings:updateRecording",
                {
                    "id": meeting_id,
                    "recordingUrl": recording_url,
                    "botAudioUrl": bot_audio_url,
                    "candidateAudioUrl": candidate_audio_url,
                },
            )
            print(
                f"[Recording] URLs stored for meeting {meeting_id}: "
                f"recording={bool(recording_url)} bot={bool(bot_audio_url)} "
                f"candidate={bool(candidate_audio_url)}"
            )
        except Exception as e:
            print(f"[Recording] Failed to update Convex: {e}")

        # Recruiter summary email is now sent directly from _auto_end_session
        # (immediately after interview, not gated on recording availability).
        # Sending it here a second time after recording was ready caused double emails.
    finally:
        await recall.aclose()


@app.post("/end-interview")
async def end_interview(req: EndInterviewRequest, user: dict = Depends(get_current_user)):
    bot_id = _url_to_bot.pop(req.meeting_url, None)
    if not bot_id:
        raise HTTPException(404, "No active interview for this meeting URL")

    session = _sessions.pop(bot_id, {})
    stop_event = session.get("stop_event")
    if stop_event:
        stop_event.set()
    task = session.get("task")
    if task:
        task.cancel()

    recall: RecallClient = session.get("recall") or _make_recall()
    try:
        await recall.stop_bot(bot_id)
    except Exception as e:
        print(f"[End] Stop bot error (non-fatal): {e}")
    finally:
        # Close the session's persistent HTTP connection pool.
        try:
            await recall.aclose()
        except Exception:
            pass

    # Clean up deduplication state for this bot
    _seen_segments.pop(bot_id, None)

    pipeline: ConversationPipeline = session.get("pipeline")
    transcript_list = pipeline.get_transcript_list() if pipeline else []
    transcript_text = pipeline.get_transcript_text() if pipeline else ""

    word_count = len(transcript_text.split()) if transcript_text else 0
    if word_count >= 200:
        interview_status = "completed"
    elif word_count >= 100:
        interview_status = "partial"
    else:
        interview_status = "no_show"

    scorecard = {}
    if pipeline and word_count >= 100:
        print("[Scorecard] Generating...")
        try:
            scorecard = await pipeline.generate_scorecard(req.candidate_name)
            print("[Scorecard] Done.")
        except Exception as e:
            print(f"[Scorecard] Error: {e}")

    # Release pipeline resources (background eval task + ElevenLabs HTTP client)
    if pipeline:
        try:
            await pipeline.aclose()
        except Exception:
            pass

    # Save the completed meeting and transcript to Convex
    meeting_id = None
    try:
        meeting_id = convex_client.mutation(
            "meetings:create",
            {
                "meetingUrl": req.meeting_url,
                "candidateName": req.candidate_name,
                "botName": session.get("bot_name") or "RecruitX AI Interviewer",
                "transcript": transcript_list,
                "transcriptText": transcript_text,
                "wordCount": word_count,
                "scorecard": scorecard,
                "botId": bot_id,
                "interviewStatus": interview_status,
                "recruiterId": session.get("recruiter_id") or "",
                "roleName": session.get("role_name") or "Interview",
                "attemptNumber": session.get("attempt_number") or 1,
            }
        )
        print(f"[Convex] Meeting stored: {meeting_id}")
    except Exception as e:
        print(f"[Convex] Failed to store meeting: {e}")

    # Kick off background task to fetch recording once Recall.ai finishes processing.
    if meeting_id:
        asyncio.create_task(_fetch_and_store_recording(bot_id, str(meeting_id)))

    return {
        "status": "ended",
        "meeting_url": req.meeting_url,
        "transcript": transcript_list,
        "conversation": transcript_text,
        "scorecard": scorecard,
    }


@app.get("/transcript/{bot_id}")
def get_transcript(bot_id: str, user: dict = Depends(get_current_user)):
    session = _sessions.get(bot_id)
    if not session:
        raise HTTPException(404, "Session not found")
    pipeline: ConversationPipeline = session.get("pipeline")
    return {"transcript": pipeline.get_transcript_list() if pipeline else []}


@app.get("/api/active-sessions")
def get_active_sessions(user: dict = Depends(get_current_user)):
    """Return all currently active bot sessions with live transcript and status."""
    import time as _time
    sessions_out = []
    for bot_id, session in list(_sessions.items()):
        pipeline: ConversationPipeline | None = session.get("pipeline")
        transcript = pipeline.get_transcript_list() if pipeline else []
        sessions_out.append({
            "bot_id": bot_id,
            "meeting_url": session.get("meeting_url", ""),
            "candidate_name": session.get("candidate_name", ""),
            "bot_name": session.get("bot_name", ""),
            "bot_status": session.get("bot_status", "joining"),
            "recruiter_id": session.get("recruiter_id", ""),
            "candidate_id": session.get("candidate_id", ""),
            "role_name": session.get("role_name", ""),
            "transcript": transcript,
            "elapsed_seconds": int(_time.time() - session.get("created_at", _time.time())),
        })
    return {"sessions": sessions_out}


@app.get("/sessions")
def list_sessions(user: dict = Depends(get_current_user)):
    return {"active": list(_url_to_bot.keys())}


# --- Authentication, Historical Meetings & Prompt Generation endpoints ---

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class GeneratePromptRequest(BaseModel):
    role_name: str


@app.post("/api/auth/signup")
def signup(req: SignupRequest):
    if not req.email or not req.password or not req.name:
        raise HTTPException(400, "All fields are required")

    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(req.password.encode('utf-8'), salt).decode('utf-8')

    try:
        user_id = convex_client.mutation("users:create", {
            "name": req.name,
            "email": req.email.lower().strip(),
            "passwordHash": password_hash
        })
        return {"status": "success", "userId": user_id}
    except Exception as e:
        msg = str(e)
        # Convex wraps thrown errors as "[Request ID: ...] Server Error" — extract the real message
        if "Email already registered" in msg or "already registered" in msg.lower():
            raise HTTPException(400, "Email already registered. Please sign in instead.")
        raise HTTPException(400, "Sign up failed. Please try again.")


@app.post("/api/auth/login")
def login(req: LoginRequest):
    email = req.email.lower().strip()
    try:
        user = convex_client.query("users:getByEmail", {"email": email})
        if not user:
            raise HTTPException(400, "Invalid email or password")

        if not bcrypt.checkpw(req.password.encode('utf-8'), user["passwordHash"].encode('utf-8')):
            raise HTTPException(400, "Invalid email or password")

        role = user.get("role") or "recruiter"
        token_payload = {
            "sub": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "role": role,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }
        token = jwt.encode(token_payload, JWT_SECRET, algorithm="HS256")

        return {
            "token": token,
            "user": {
                "id": user["_id"],
                "name": user["name"],
                "email": user["email"],
                "role": role,
            }
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(500, f"Login error: {str(e)}")


@app.post("/api/auth/forgot-password")
async def forgot_password(request: Request):
    import secrets, hashlib
    import email_templates as et
    body = await request.json()
    email = (body.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(400, "Email is required")

    user = convex_client.query("users:getByEmail", {"email": email})
    if not user:
        # Return success regardless — don't reveal if email exists
        return {"status": "ok", "message": "If that email exists, a reset link has been sent."}

    raw_token = secrets.token_urlsafe(32)
    hashed = hashlib.sha256(raw_token.encode()).hexdigest()
    expiry = int((__import__("time").time() + 3600) * 1000)  # 1 hour

    convex_client.mutation("users:setResetToken", {
        "id": user["_id"],
        "resetToken": hashed,
        "resetTokenExpiry": expiry,
    })

    frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    reset_url = f"{frontend_url}/reset-password?token={raw_token}"

    try:
        smtp_config = convex_client.query("settings:get", {"key": "smtp_config"}) or {}
        html = et.build_password_reset_email(name=user["name"], reset_url=reset_url)
        company = os.getenv("COMPANY_NAME", "LumosLogic")
        await gauth.send_email_smtp_generic(
            to_email=email,
            to_name=user["name"],
            subject=f"[{company}] Reset Your Password",
            html_body=html,
            smtp_config=smtp_config,
        )
    except Exception as e:
        print(f"[Auth] Password reset email error: {e}")

    return {"status": "ok", "message": "If that email exists, a reset link has been sent."}


@app.post("/api/auth/reset-password")
async def reset_password(request: Request):
    import hashlib
    body = await request.json()
    token = (body.get("token") or "").strip()
    new_password = body.get("password") or ""

    if not token or not new_password:
        raise HTTPException(400, "Token and new password are required")
    if len(new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    hashed = hashlib.sha256(token.encode()).hexdigest()
    user = convex_client.query("users:getByResetToken", {"resetToken": hashed})

    if not user:
        raise HTTPException(400, "Invalid or expired reset link")
    if user.get("resetTokenExpiry", 0) < int(__import__("time").time() * 1000):
        raise HTTPException(400, "Reset link has expired. Please request a new one.")

    salt = bcrypt.gensalt()
    new_hash = bcrypt.hashpw(new_password.encode(), salt).decode()
    convex_client.mutation("users:updatePassword", {"id": user["_id"], "passwordHash": new_hash})

    return {"status": "ok", "message": "Password updated successfully."}


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return {"user": user}


@app.get("/api/meetings")
def list_meetings(user: dict = Depends(get_current_user)):
    try:
        meetings = convex_client.query("meetings:list")
        return {"meetings": meetings}
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str, user: dict = Depends(get_current_user)):
    try:
        meeting = convex_client.query("meetings:get", {"id": meeting_id})
        if not meeting:
            raise HTTPException(404, "Meeting not found")
        return {"meeting": meeting}
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


@app.get("/api/meetings/{meeting_id}/recording")
def get_meeting_recording(meeting_id: str, user: dict = Depends(get_current_user)):
    """Return recording URLs for a meeting. URLs may be null while Recall.ai is still processing."""
    try:
        meeting = convex_client.query("meetings:get", {"id": meeting_id})
        if not meeting:
            raise HTTPException(404, "Meeting not found")
        recording_url = meeting.get("recordingUrl")
        bot_audio_url = meeting.get("botAudioUrl")
        candidate_audio_url = meeting.get("candidateAudioUrl")
        return {
            "ready": bool(recording_url or bot_audio_url or candidate_audio_url),
            "recording_url": recording_url,
            "bot_audio_url": bot_audio_url,
            "candidate_audio_url": candidate_audio_url,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


@app.get("/api/meetings/{meeting_id}/recording/status")
def get_recording_status(meeting_id: str, user: dict = Depends(get_current_user)):
    """Return lightweight recording status from the MeetingRecording module.
    Frontend polls this to decide when to show the video player."""
    try:
        from recording import get_recording_status as _get_status
        return _get_status(convex_client, meeting_id)
    except Exception as e:
        print(f"[API] /recording/status error (non-fatal): {e}")
        return {"status": "unavailable", "available": False}


@app.post("/api/meetings/{meeting_id}/fetch-recording")
async def fetch_recording_for_meeting(meeting_id: str, user: dict = Depends(get_current_user)):
    """Manually trigger a recording fetch from Recall.ai for an existing meeting."""
    try:
        meeting = convex_client.query("meetings:get", {"id": meeting_id})
        if not meeting:
            raise HTTPException(404, "Meeting not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")

    bot_id = meeting.get("botId")
    if not bot_id:
        raise HTTPException(400, "Meeting has no botId — it was created before recording support was added")

    asyncio.create_task(_fetch_and_store_recording(bot_id, meeting_id))
    return {
        "status": "fetching",
        "message": "Recording fetch started in background. Poll GET /api/meetings/{meeting_id}/recording in 2–5 minutes.",
        "bot_id": bot_id,
    }


@app.post("/api/meetings/{meeting_id}/recording/retry")
async def retry_recording_fetch(meeting_id: str, user: dict = Depends(get_current_user)):
    """
    Trigger the RecordingManager retry pipeline for a meeting's recording.
    Uses exponential backoff: 15 s → 30 s → 60 s → 120 s → 5 min.
    Returns immediately — the retry runs in the background.
    """
    try:
        meeting = convex_client.query("meetings:get", {"id": meeting_id})
        if not meeting:
            raise HTTPException(404, "Meeting not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")

    bot_id = meeting.get("botId")
    if not bot_id:
        raise HTTPException(400, "Meeting has no botId")

    async def _retry_task():
        try:
            from recording_manager import RecordingManager
            mgr = RecordingManager()
            await mgr.retry_until_available(convex_client, bot_id, meeting_id)
        except Exception as _e:
            print(f"[RecordingManager] retry_recording_fetch task error (non-fatal): {_e}")

    asyncio.create_task(_retry_task())
    return {
        "status": "retrying",
        "message": "Recording retry started in background with exponential backoff.",
        "bot_id": bot_id,
    }


@app.get("/api/meetings/{meeting_id}/recording/validate")
async def validate_meeting_recording(meeting_id: str, user: dict = Depends(get_current_user)):
    """
    Validate the recording URL for a meeting using the RecordingManager.
    Checks: HTTPS, reachability, non-zero content. Updates status if valid.
    """
    try:
        from recording_manager import validate_recording
        result = await validate_recording(convex_client, meeting_id)
        return result
    except Exception as e:
        return {"valid": False, "status": "error", "reason": str(e)}


@app.get("/api/prompts")
def list_prompts(user: dict = Depends(get_current_user)):
    try:
        prompts = convex_client.query("prompts:list")
        return {"prompts": prompts}
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


PROMPT_ENGINEER_INSTRUCTION = """You are an expert at writing AI voice interviewer system prompts.

CRITICAL RULES FOR WHAT YOU MUST OUTPUT:
- Output BEHAVIORAL INSTRUCTIONS only — tell the AI how to behave, NOT what to say.
- NEVER write pre-scripted lines, fake dialogues, or example Q&A exchanges.
- NEVER hardcode the candidate's name into questions or responses.
- NEVER write sentences starting with "You mentioned..." or "I see you've worked on..." — the AI has not spoken to the candidate yet and cannot know their background.
- Do NOT write "If candidate says X, respond with Y" — that creates a script, not an interviewer.

WHAT TO INCLUDE:
1. Who the AI is: a friendly, human-sounding interviewer with a name like Alex.
2. Conversation style rules:
   - ONE question per turn, always. Never combine two questions.
   - 1-2 sentences maximum per response.
   - React to what the candidate ACTUALLY says — never assume or invent facts.
   - Use natural filler: "Got it.", "Interesting.", "Right, so...", "That makes sense."
   - If answer is vague or short, ask them to elaborate — don't move on.
3. Interview flow: warm intro → candidate background → role-specific skills (3-4 areas relevant to the role) → one soft-skills question → wrap up with next steps.
4. Topic AREAS to cover (not pre-written questions — just the subjects to ask about).
5. Hard rules: never repeat a question already answered, never ask multiple questions at once, keep total interview under 10 minutes.

Output ONLY the system prompt text. No preamble. No example dialogues. No scripts."""


async def _call_openai_for_prompt(user_message: str) -> str:
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(500, "OpenAI API key not configured")
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=openai_key)
    model_to_use = os.getenv("OPENAI_PROMPT_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o"))
    response = await client.chat.completions.create(
        model=model_to_use,
        messages=[
            {"role": "system", "content": PROMPT_ENGINEER_INSTRUCTION},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=800,
    )
    return (response.choices[0].message.content or "").strip()


def _extract_pdf_text(file_bytes: bytes) -> str:
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_file_text(filename: str, file_bytes: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        return _extract_pdf_text(file_bytes)
    return file_bytes.decode("utf-8", errors="ignore")


@app.post("/api/prompts/generate")
async def generate_prompt(req: GeneratePromptRequest, user: dict = Depends(get_current_user)):
    role = req.role_name.strip()
    if not role:
        raise HTTPException(400, "Role name is required")

    user_message = f"Generate an AI interviewer system prompt for the role: '{role}'."

    try:
        generated_prompt = await _call_openai_for_prompt(user_message)

        try:
            convex_client.mutation("prompts:create", {"roleName": role, "promptText": generated_prompt})
        except Exception as e:
            print(f"[Convex] Failed to save prompt: {e}")

        return {"role_name": role, "prompt_text": generated_prompt}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"OpenAI error: {str(e)}")


@app.post("/api/prompts/generate-from-docs")
async def generate_prompt_from_docs(
    cv_file: UploadFile | None = File(None),
    jd_file: UploadFile | None = File(None),
    role_name: str = Form(""),
    user: dict = Depends(get_current_user),
):
    if not cv_file and not jd_file:
        raise HTTPException(400, "Upload at least one document (CV or Job Description).")

    cv_text = ""
    jd_text = ""

    if cv_file and cv_file.filename:
        cv_bytes = await cv_file.read()
        cv_text = _extract_file_text(cv_file.filename, cv_bytes)

    if jd_file and jd_file.filename:
        jd_bytes = await jd_file.read()
        jd_text = _extract_file_text(jd_file.filename, jd_bytes)

    role = role_name.strip() or "the role"

    parts = [f"Generate an AI interviewer system prompt for the role: '{role}'."]
    if jd_text:
        parts.append(f"\n\nJOB DESCRIPTION:\n{jd_text[:3000]}")
    if cv_text:
        parts.append(f"\n\nCANDIDATE CV:\n{cv_text[:3000]}")
    if cv_text:
        parts.append(
            "\n\nTailor the questions to the candidate's actual background from their CV — "
            "ask follow-up questions about specific projects or technologies they mention."
        )

    user_message = "".join(parts)

    try:
        generated_prompt = await _call_openai_for_prompt(user_message)

        label = role_name.strip() or (jd_file.filename if jd_file else "Document Upload")
        try:
            convex_client.mutation("prompts:create", {"roleName": label, "promptText": generated_prompt})
        except Exception as e:
            print(f"[Convex] Failed to save prompt: {e}")

        return {"role_name": label, "prompt_text": generated_prompt}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Generation error: {str(e)}")


# ── Scheduled interview: create a live session at the scheduled time ───────────

async def _scheduled_create_session(meeting_url: str, system_prompt: str, bot_name: str,
                                     candidate_name: str, scheduled_interview_id: str,
                                     recruiter_id: str = "", candidate_id: str = "",
                                     role_name: str = "Interview", attempt_number: int = 1,
                                     candidate_email: str = ""):
    """Called by the scheduler at interview time — mirrors /start-interview logic."""
    if meeting_url in _url_to_bot:
        print(f"[Scheduler] Session already active for {meeting_url} — skipping")
        return

    recall = _make_recall()
    pipeline = ConversationPipeline(
        system_prompt=system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
        elevenlabs_key=os.getenv("ELEVENLABS_API_KEY", ""),
        voice_id=CUSTOM_VOICE_ID,
    )

    bot_id_holder: list[str] = []

    async def on_ai_response(text: str, audio_bytes: bytes):
        if not bot_id_holder:
            return
        bid = bot_id_holder[0]
        for attempt in range(3):
            try:
                await recall.speak(bid, audio_bytes)
                return
            except Exception as e:
                print(f"[Scheduler] Speak error attempt {attempt + 1}/3: {e}")
                if attempt < 2:
                    await asyncio.sleep(3)

    pipeline.set_response_callback(on_ai_response)

    try:
        bot_data = await recall.create_bot(
            meeting_url,
            bot_name,
            webhook_url=_webhook_url(),
        )
    except Exception as e:
        print(f"[Scheduler] create_bot error: {e}")
        await recall.aclose()
        raise  # re-raise so _bot_join_job retries and logs the failure properly

    bot_id = bot_data["id"]
    bot_id_holder.append(bot_id)
    print(f"[Scheduler] Bot created for scheduled interview {scheduled_interview_id}: {bot_id}")

    import time as _time
    stop_event = asyncio.Event()
    _sessions[bot_id] = {
        "bot_id": bot_id,
        "meeting_url": meeting_url,
        "bot_name": bot_name,
        "candidate_name": candidate_name,
        "stop_event": stop_event,
        "recall": recall,
        "pipeline": pipeline,
        "seen_transcript_count": 0,
        "greeted": False,
        "greeted_to_human": False,
        "candidate_absent": False,
        "candidate_was_absent": False,
        "candidate_ever_joined": False,    # True once first participant.join fires
        "scheduled_interview_id": scheduled_interview_id,
        "recruiter_id": recruiter_id,
        "candidate_id": candidate_id,
        "candidate_email": candidate_email,
        "role_name": role_name,
        "attempt_number": attempt_number,
        "scheduled_at_ms": 0,              # filled by schedule_interview caller
        "created_at": _time.time(),
        "bot_status": "joining",
    }
    _url_to_bot[meeting_url] = bot_id

    # Wire up auto-end callback — same as start_interview path.
    # Without this, scheduled sessions never auto-leave on goodbye detection.
    async def _on_scheduled_session_end():
        session_data = _sessions.pop(bot_id, None)
        if session_data:
            _url_to_bot.pop(session_data.get("meeting_url", ""), None)
            _seen_segments.pop(bot_id, None)
            print(f"[Pipeline] Goodbye detected (scheduled) — auto-ending session {bot_id}")
            asyncio.create_task(_auto_end_session(bot_id, session_data, candidate_name))

    pipeline.set_session_end_callback(_on_scheduled_session_end)

    task = asyncio.create_task(_poll_and_greet(bot_id))
    _sessions[bot_id]["task"] = task


# ── Google OAuth endpoints ─────────────────────────────────────────────────────

@app.get("/api/auth/google")
def google_auth_start(user: dict = Depends(get_current_user)):
    """Return the Google OAuth URL for the admin to authorize."""
    if not os.getenv("GOOGLE_CLIENT_ID"):
        raise HTTPException(400, "GOOGLE_CLIENT_ID env var not set")
    url = gauth.get_auth_url()
    return {"auth_url": url}


@app.get("/api/auth/google/callback")
async def google_auth_callback(code: str = None, error: str = None, state: str = ""):
    """Exchange OAuth code for tokens. No JWT required — called by Google redirect."""
    import urllib.parse
    frontend = os.getenv("FRONTEND_URL", "").rstrip("/")
    dashboard = f"{frontend}/dashboard" if frontend else "/dashboard"

    if error:
        print(f"[Google OAuth] Google returned error: {error}")
        return RedirectResponse(url=f"{dashboard}?google_error={error}")
    if not code:
        return RedirectResponse(url=f"{dashboard}?google_error=missing_code")
    try:
        loop = asyncio.get_event_loop()
        tokens = await loop.run_in_executor(None, lambda: gauth.exchange_code(code, state))
        convex_client.mutation("settings:set", {"key": "google_tokens", "value": tokens})
        print("[Google OAuth] Tokens saved to Convex successfully")
        return RedirectResponse(url=f"{dashboard}?google_connected=1")
    except Exception as e:
        print(f"[Google OAuth] Callback exception: {type(e).__name__}: {e}")
        return RedirectResponse(url=f"{dashboard}?google_error={urllib.parse.quote(str(e)[:80])}")


@app.get("/api/auth/google/status")
def google_auth_status(user: dict = Depends(get_current_user)):
    """Check whether Google account is connected."""
    try:
        tokens = convex_client.query("settings:get", {"key": "google_tokens"})
        print(f"[Google Status] tokens={type(tokens).__name__}, keys={list(tokens.keys()) if isinstance(tokens, dict) else 'N/A'}")
        connected = bool(tokens and isinstance(tokens, dict) and tokens.get("refresh_token"))
        return {"connected": connected, "debug_type": type(tokens).__name__}
    except Exception as e:
        print(f"[Google Status] Error: {e}")
        return {"connected": False, "error": str(e)}


@app.get("/api/auth/google/debug")
def google_auth_debug(user: dict = Depends(get_current_user)):
    """Debug endpoint — shows what's stored in Convex settings."""
    try:
        tokens = convex_client.query("settings:get", {"key": "google_tokens"})
        if not tokens:
            return {"stored": False, "message": "No tokens in Convex — OAuth callback never completed successfully"}
        if not isinstance(tokens, dict):
            return {"stored": True, "type": type(tokens).__name__, "message": "Tokens stored but wrong type"}
        has_refresh = bool(tokens.get("refresh_token"))
        has_access = bool(tokens.get("token"))
        return {
            "stored": True,
            "has_refresh_token": has_refresh,
            "has_access_token": has_access,
            "scopes": tokens.get("scopes", []),
            "client_id_present": bool(tokens.get("client_id")),
            "message": "Connected ✓" if has_refresh else "Tokens stored but refresh_token missing — re-authorize",
        }
    except Exception as e:
        return {"stored": False, "error": str(e)}


# ── SMTP settings endpoints ───────────────────────────────────────────────────

class SmtpConfigRequest(BaseModel):
    host: str = "smtp.gmail.com"
    port: int = 587
    user: str
    password: str


@app.get("/api/settings/smtp")
def get_smtp_settings(user: dict = Depends(get_current_user)):
    try:
        config = convex_client.query("settings:get", {"key": "smtp_config"})
        if not config:
            # Fall back to env vars so existing setup still shows as configured
            env_user = os.getenv("SMTP_USER", "")
            return {
                "configured": bool(env_user),
                "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
                "port": int(os.getenv("SMTP_PORT", "587")),
                "user": env_user,
                "source": "env",
            }
        return {
            "configured": bool(config.get("user") and config.get("password")),
            "host": config.get("host", "smtp.gmail.com"),
            "port": config.get("port", 587),
            "user": config.get("user", ""),
            "source": "convex",
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/settings/smtp")
def save_smtp_settings(req: SmtpConfigRequest, user: dict = Depends(get_current_user)):
    if not req.user or not req.password:
        raise HTTPException(400, "Email and password are required")
    try:
        convex_client.mutation("settings:set", {
            "key": "smtp_config",
            "value": {
                "host": req.host.strip(),
                "port": req.port,
                "user": req.user.strip(),
                "password": req.password,
            },
        })
        return {"status": "saved", "user": req.user.strip()}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Candidate management endpoints ────────────────────────────────────────────

class CandidateCreateRequest(BaseModel):
    name: str
    email: str
    phone: str = ""
    notes: str = ""
    role_name: str = ""
    experience_years: str = ""
    current_company: str = ""
    current_role: str = ""
    current_ctc: str = ""
    expected_ctc: str = ""
    location: str = ""
    skills: list[str] = []
    education: str = ""
    linkedin_url: str = ""
    github_url: str = ""


@app.post("/api/candidates")
def create_candidate(req: CandidateCreateRequest, user: dict = Depends(get_current_user)):
    if not req.name or not req.email:
        raise HTTPException(400, "Name and email are required")
    try:
        profile_patch = {}
        if req.phone: profile_patch["phone"] = req.phone
        if req.notes: profile_patch["notes"] = req.notes
        if req.role_name: profile_patch["roleName"] = req.role_name
        if req.experience_years: profile_patch["experienceYears"] = req.experience_years
        if req.current_company: profile_patch["currentCompany"] = req.current_company
        if req.current_role: profile_patch["currentRole"] = req.current_role
        if req.current_ctc: profile_patch["currentCtc"] = req.current_ctc
        if req.expected_ctc: profile_patch["expectedCtc"] = req.expected_ctc
        if req.location: profile_patch["location"] = req.location
        if req.skills: profile_patch["skills"] = req.skills
        if req.education: profile_patch["education"] = req.education
        if req.linkedin_url: profile_patch["linkedinUrl"] = req.linkedin_url
        if req.github_url: profile_patch["githubUrl"] = req.github_url
        cid = convex_client.mutation("candidates:create", {
            "name": req.name,
            "email": req.email.lower().strip(),
            "recruiterId": user.get("sub", ""),
            **profile_patch,
        })
        _log_timeline(str(cid), "candidate_added",
                      actor=user.get("sub", "system"),
                      metadata={"name": req.name, "email": req.email, "roleName": req.role_name})
        return {"id": cid, "name": req.name, "email": req.email}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/candidates")
def list_candidates(user: dict = Depends(get_current_user)):
    try:
        role = user.get("role", "recruiter")
        if role == "admin":
            candidates = convex_client.query("candidates:list") or []
        else:
            recruiter_id = user.get("sub", "")
            candidates = convex_client.query("candidates:listByRecruiter", {"recruiterId": recruiter_id}) or []
        return {"candidates": candidates}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    try:
        if user.get("role") != "admin":
            candidate = convex_client.query("candidates:get", {"id": candidate_id})
            if candidate and candidate.get("recruiterId") != user.get("sub"):
                raise HTTPException(403, "Cannot delete another recruiter's candidate")
        convex_client.mutation("candidates:remove", {"id": candidate_id})
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class CandidateUpdateRequest(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    notes: str = ""
    role_name: str = ""
    experience_years: str = ""
    current_company: str = ""
    current_role: str = ""
    current_ctc: str = ""
    expected_ctc: str = ""
    location: str = ""
    skills: list[str] = []
    education: str = ""
    linkedin_url: str = ""
    github_url: str = ""


@app.put("/api/candidates/{candidate_id}")
def update_candidate(candidate_id: str, req: CandidateUpdateRequest,
                     user: dict = Depends(get_current_user)):
    try:
        if user.get("role") != "admin":
            candidate = convex_client.query("candidates:get", {"id": candidate_id})
            if candidate and candidate.get("recruiterId") != user.get("sub"):
                raise HTTPException(403, "Cannot edit another recruiter's candidate")
        patch: dict = {}
        if req.name:             patch["name"]            = req.name.strip()
        if req.email:            patch["email"]           = req.email.lower().strip()
        if req.phone:            patch["phone"]           = req.phone.strip()
        if req.notes:            patch["notes"]           = req.notes.strip()
        if req.role_name:        patch["roleName"]        = req.role_name.strip()
        if req.experience_years: patch["experienceYears"] = req.experience_years.strip()
        if req.current_company:  patch["currentCompany"]  = req.current_company.strip()
        if req.current_role:     patch["currentRole"]     = req.current_role.strip()
        if req.current_ctc:      patch["currentCtc"]      = req.current_ctc.strip()
        if req.expected_ctc:     patch["expectedCtc"]     = req.expected_ctc.strip()
        if req.location:         patch["location"]        = req.location.strip()
        if req.skills:           patch["skills"]          = req.skills
        if req.education:        patch["education"]       = req.education.strip()
        if req.linkedin_url:     patch["linkedinUrl"]     = req.linkedin_url.strip()
        if req.github_url:       patch["githubUrl"]       = req.github_url.strip()
        convex_client.mutation("candidates:update", {"id": candidate_id, **patch})
        return {"status": "updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Prompt CRUD ───────────────────────────────────────────────────────────────

class PromptUpdateRequest(BaseModel):
    role_name: str = ""
    prompt_text: str = ""


@app.put("/api/prompts/{prompt_id}")
def update_prompt(prompt_id: str, req: PromptUpdateRequest,
                  user: dict = Depends(get_current_user)):
    try:
        patch: dict = {"id": prompt_id}
        if req.role_name:   patch["roleName"]   = req.role_name.strip()
        if req.prompt_text: patch["promptText"] = req.prompt_text.strip()
        convex_client.mutation("prompts:update", patch)
        return {"status": "updated"}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/prompts/{prompt_id}")
def delete_prompt(prompt_id: str, user: dict = Depends(get_current_user)):
    try:
        convex_client.mutation("prompts:remove", {"id": prompt_id})
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Get single candidate endpoint ────────────────────────────────────────────

@app.get("/api/candidates/{candidate_id}")
def get_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    try:
        candidate = convex_client.query("candidates:get", {"id": candidate_id})
        if not candidate:
            raise HTTPException(404, "Candidate not found")
        if user.get("role") != "admin" and candidate.get("recruiterId") != user.get("sub"):
            raise HTTPException(403, "Access denied")
        return {"candidate": candidate}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Generate prompt from candidate profile ────────────────────────────────────

@app.post("/api/candidates/{candidate_id}/generate-prompt")
async def generate_prompt_from_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    """Generate a tailored interview system prompt from the candidate's profile and resume."""
    try:
        candidate = convex_client.query("candidates:get", {"id": candidate_id})
    except Exception as e:
        raise HTTPException(500, str(e))
    if not candidate:
        raise HTTPException(404, "Candidate not found")

    from openai import AsyncOpenAI
    openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

    resume_text = candidate.get("resumeText", "")
    role = candidate.get("roleName") or "Software Engineer"
    skills = candidate.get("skills") or []
    experience = candidate.get("experienceYears") or ""
    education = candidate.get("education") or ""
    notes = candidate.get("notes") or ""

    context_parts = []
    if resume_text:
        context_parts.append(f"RESUME:\n{resume_text[:3000]}")
    if skills:
        context_parts.append(f"Skills listed: {', '.join(skills)}")
    if experience:
        context_parts.append(f"Years of experience: {experience}")
    if education:
        context_parts.append(f"Education: {education}")
    if notes:
        context_parts.append(f"Recruiter notes: {notes}")

    context = "\n\n".join(context_parts) or f"Candidate applying for {role} role."

    prompt_request = (
        f"Generate a focused AI interviewer system prompt for a voice interview with a candidate applying for: {role}\n\n"
        f"Candidate context:\n{context}\n\n"
        "Write a concise system prompt (200-350 words) that:\n"
        "1. Specifies what topics to cover based on their actual background\n"
        "2. Lists 4-6 specific technical areas to probe (based on their skills/resume)\n"
        "3. Mentions any gaps or areas to verify from their resume\n"
        "4. Sets the interview tone and structure\n"
        "DO NOT include general rules about how to speak — only the interview-specific content.\n"
        "Start with: 'You are interviewing [candidate name] for the [role] position.'"
    )

    try:
        resp = await openai_client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt_request}],
            max_tokens=500,
            temperature=0.4,
        )
        generated = (resp.choices[0].message.content or "").strip()
        try:
            convex_client.mutation("candidates:update", {"id": candidate_id, "generatedPrompt": generated})
        except Exception:
            pass
        return {"prompt": generated, "candidate_name": candidate.get("name", "")}
    except Exception as e:
        raise HTTPException(500, f"Prompt generation error: {e}")


# ── Candidate timeline endpoint ───────────────────────────────────────────────

@app.get("/api/candidates/{candidate_id}/timeline")
def get_candidate_timeline(candidate_id: str, user: dict = Depends(get_current_user)):
    try:
        events = convex_client.query("timeline:listByCandidate", {"candidateId": candidate_id}) or []
        return {"timeline": events}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Resume upload endpoint ────────────────────────────────────────────────────

@app.post("/api/candidates/{candidate_id}/resume")
async def upload_resume(candidate_id: str, file: UploadFile = File(...),
                        user: dict = Depends(get_current_user)):
    """Upload a CV/resume PDF and store extracted text against the candidate."""
    content = await file.read()
    filename = file.filename or "resume.pdf"
    text = ""
    try:
        if filename.lower().endswith(".pdf"):
            import io
            reader = pypdf.PdfReader(io.BytesIO(content))
            text = "\n".join(
                page.extract_text() or "" for page in reader.pages
            ).strip()
        else:
            text = content.decode("utf-8", errors="ignore").strip()
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")

    if not text:
        raise HTTPException(400, "No text could be extracted from the uploaded file")

    try:
        convex_client.mutation("candidates:updateResume", {
            "id": candidate_id,
            "resumeText": text[:20000],  # cap to 20k chars
            "resumeFileName": filename,
        })
        _log_timeline(candidate_id, "resume_uploaded",
                      actor=user.get("sub", "system"),
                      metadata={"fileName": filename, "charCount": len(text)})
        return {"status": "stored", "fileName": filename, "charCount": len(text)}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Admin analytics endpoint ──────────────────────────────────────────────────

@app.get("/api/users")
def list_users(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    try:
        users = convex_client.query("users:list") or []
        # Strip password hashes before sending to frontend
        return {"users": [{"_id": u["_id"], "name": u["name"], "email": u["email"], "role": u.get("role", "recruiter")} for u in users]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/admin/analytics")
def admin_analytics(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    try:
        candidates = convex_client.query("candidates:list") or []
        meetings = convex_client.query("meetings:list") or []

        total = len(candidates)
        completed = sum(1 for c in candidates if c.get("interviewStatus") in ("locked", "completed"))
        cooldown = sum(1 for c in candidates if c.get("interviewStatus") == "cooldown")
        no_show = sum(1 for m in meetings if m.get("interviewStatus") == "no_show")

        scored = [m for m in meetings if m.get("scorecard", {}).get("overall_score")]
        avg_score = round(sum(m["scorecard"]["overall_score"] for m in scored) / len(scored), 1) if scored else 0

        # Improvement %: candidates who improved score from attempt 1 to attempt 2
        cand_meetings: dict[str, list] = {}
        for m in meetings:
            name = m.get("candidateName", "")
            if name:
                cand_meetings.setdefault(name, []).append(m)

        improved_count = 0
        total_retried = 0
        for name, cms in cand_meetings.items():
            attempts = sorted(
                [m for m in cms if m.get("scorecard", {}).get("overall_score")],
                key=lambda m: m.get("attemptNumber") or 1
            )
            if len(attempts) >= 2:
                total_retried += 1
                if attempts[1]["scorecard"]["overall_score"] > attempts[0]["scorecard"]["overall_score"]:
                    improved_count += 1

        improvement_rate = round(improved_count / total_retried * 100) if total_retried else 0

        # Recruiter performance
        recruiter_stats: dict[str, dict] = {}
        for c in candidates:
            rid = c.get("recruiterId") or "unknown"
            if rid not in recruiter_stats:
                rname = c.get("recruiterName") or rid[-6:]
                recruiter_stats[rid] = {"name": rname, "total": 0, "completed": 0, "scores": []}
            recruiter_stats[rid]["total"] += 1
            if c.get("interviewStatus") in ("locked", "completed"):
                recruiter_stats[rid]["completed"] += 1
        for m in meetings:
            rid = m.get("recruiterId") or "unknown"
            if rid in recruiter_stats and m.get("scorecard", {}).get("overall_score"):
                recruiter_stats[rid]["scores"].append(m["scorecard"]["overall_score"])
        recruiter_list = []
        for rid, rs in recruiter_stats.items():
            avg = round(sum(rs["scores"]) / len(rs["scores"]), 1) if rs["scores"] else 0
            recruiter_list.append({
                "recruiterId": rid,
                "name": rs["name"],
                "totalCandidates": rs["total"],
                "completedInterviews": rs["completed"],
                "averageScore": avg,
                "successRate": round(rs["completed"] / rs["total"] * 100) if rs["total"] else 0,
            })

        # Weekly top
        import time as _time
        now = _time.time() * 1000
        week_start = now - 7 * 24 * 3600 * 1000
        weekly = [m for m in scored if (m.get("createdAt") or 0) >= week_start]
        weekly.sort(key=lambda m: m["scorecard"]["overall_score"], reverse=True)

        return {
            "summary": {
                "totalCandidates": total,
                "completedInterviews": completed,
                "inCooldown": cooldown,
                "noShowCount": no_show,
                "averageScore": avg_score,
                "totalScoredMeetings": len(scored),
                "retryImprovedCount": improved_count,
                "totalRetried": total_retried,
                "improvementRate": improvement_rate,
            },
            "recruiterPerformance": sorted(recruiter_list, key=lambda r: r["totalCandidates"], reverse=True),
            "weeklyTop": [
                {
                    "candidateName": m.get("candidateName"),
                    "roleName": m.get("roleName"),
                    "score": m["scorecard"]["overall_score"],
                    "recommendation": m.get("scorecard", {}).get("recommendation", ""),
                }
                for m in weekly[:10]
            ],
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Candidate profile → system prompt enrichment ──────────────────────────────

def _build_candidate_context(candidate: dict, base_prompt: str) -> str:
    """Prepend candidate profile + resume to the system prompt so the AI bot
    has full context about the person it is about to interview."""
    lines = ["CANDIDATE PROFILE (use this to ask specific, relevant questions):"]
    lines.append(f"Name: {candidate.get('name', 'Candidate')}")
    if candidate.get("roleName"):
        lines.append(f"Role Applied For: {candidate['roleName']}")
    if candidate.get("experienceYears"):
        lines.append(f"Years of Experience: {candidate['experienceYears']}")
    if candidate.get("currentCompany"):
        lines.append(f"Current Company: {candidate['currentCompany']}")
    if candidate.get("currentRole"):
        lines.append(f"Current Role: {candidate['currentRole']}")
    if candidate.get("currentCtc"):
        lines.append(f"Current CTC: {candidate['currentCtc']}")
    if candidate.get("expectedCtc"):
        lines.append(f"Expected CTC: {candidate['expectedCtc']}")
    if candidate.get("location"):
        lines.append(f"Location: {candidate['location']}")
    if candidate.get("education"):
        lines.append(f"Education: {candidate['education']}")
    if candidate.get("skills"):
        skills = candidate["skills"]
        if isinstance(skills, list):
            lines.append(f"Skills: {', '.join(skills)}")
        else:
            lines.append(f"Skills: {skills}")
    if candidate.get("linkedinUrl"):
        lines.append(f"LinkedIn: {candidate['linkedinUrl']}")
    if candidate.get("githubUrl"):
        lines.append(f"GitHub: {candidate['githubUrl']}")
    if candidate.get("notes"):
        lines.append(f"Recruiter Notes: {candidate['notes']}")

    profile_block = "\n".join(lines)

    resume_block = ""
    if candidate.get("resumeText"):
        resume_text = candidate["resumeText"][:4000]
        resume_block = f"\nRESUME CONTENT:\n{resume_text}\n"

    recruiter_block = f"\n--- RECRUITER INSTRUCTIONS ---\n{base_prompt}" if base_prompt.strip() else ""

    return profile_block + resume_block + recruiter_block


# ── Schedule interview endpoint ───────────────────────────────────────────────

class ScheduleInterviewRequest(BaseModel):
    candidate_id: str
    platform: str = "google_meet"      # "google_meet" | "manual"
    scheduled_at_iso: str              # ISO 8601 UTC e.g. "2026-07-15T10:00:00Z"
    duration_minutes: int = 30
    role_name: str = "Interview"
    system_prompt: str = ""
    bot_name: str = "RecruitX AI Interviewer"
    meeting_url: str = ""              # Manual meeting link (skips Google Meet creation)


@app.post("/api/interviews/schedule")
async def schedule_interview(req: ScheduleInterviewRequest, user: dict = Depends(get_current_user)):
    # Resolve candidate
    try:
        candidate = convex_client.query("candidates:get", {"id": req.candidate_id})
    except Exception as e:
        raise HTTPException(500, f"Convex error: {e}")
    if not candidate:
        raise HTTPException(404, "Candidate not found")

    # Parse scheduled time
    try:
        from datetime import timezone
        scheduled_dt = datetime.datetime.fromisoformat(
            req.scheduled_at_iso.replace("Z", "+00:00")
        ).astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        raise HTTPException(400, "Invalid scheduled_at_iso format. Use ISO 8601 e.g. 2026-07-15T10:00:00Z")

    if scheduled_dt < datetime.datetime.utcnow():
        raise HTTPException(400, "Scheduled time must be in the future")

    # Platform routing
    calendar_event_id = ""
    if req.meeting_url.strip():
        # Manual URL provided — skip Google Meet creation entirely
        meeting_url = req.meeting_url.strip()
        print(f"[Schedule] Using manual meeting URL: {meeting_url}")
    elif req.platform == "google_meet":
        tokens = convex_client.query("settings:get", {"key": "google_tokens"})
        if not tokens or not tokens.get("refresh_token"):
            raise HTTPException(400, "Google account not connected. Go to Settings → Connect Google.")
        try:
            meet_result = await gauth.create_google_meet(
                token_dict=tokens,
                candidate_name=candidate["name"],
                candidate_email=candidate["email"],
                scheduled_at=scheduled_dt,
                duration_minutes=req.duration_minutes,
                role_name=req.role_name,
            )
        except Exception as e:
            raise HTTPException(500, f"Google Meet creation failed: {e}")
        meeting_url = meet_result["meet_url"]
        calendar_event_id = meet_result["event_id"]
    elif req.platform == "zoom":
        raise HTTPException(400, "Zoom integration not yet configured.")
    elif req.platform == "teams":
        raise HTTPException(400, "Microsoft Teams integration not yet configured.")
    else:
        raise HTTPException(400, f"Unknown platform: {req.platform}")

    # Send email invite — calendar invite (ICS) first, then SMTP fallback, then Gmail API
    email_sent = False
    smtp_config = {}
    try:
        smtp_config = convex_client.query("settings:get", {"key": "smtp_config"}) or {}
    except Exception:
        pass

    smtp_user = smtp_config.get("user") or os.getenv("SMTP_USER", "")
    smtp_pass = smtp_config.get("password") or os.getenv("SMTP_PASS", "")

    # Primary path: enhanced calendar invitation with ICS attachment and calendar buttons
    if smtp_user and smtp_pass:
        try:
            from interview_calendar import CalendarEventData, send_calendar_invite
            from datetime import timezone as _tz
            _recruiter_name = user.get("name", os.getenv("COMPANY_NAME", "LumosLogic"))
            _cal_event = CalendarEventData(
                title=f"Interview — {candidate['name']} ({req.role_name})",
                candidate_name=candidate["name"],
                candidate_email=candidate["email"],
                job_title=req.role_name,
                recruiter_name=_recruiter_name,
                organizer_email=smtp_user,
                start=scheduled_dt.replace(tzinfo=_tz.utc),
                duration_minutes=req.duration_minutes,
                meet_url=meeting_url,
                timezone_name="UTC",
            )
            email_sent = await send_calendar_invite(
                event=_cal_event,
                candidate_email=candidate["email"],
                smtp_config=smtp_config,
            )
            if email_sent:
                print("[Schedule] Calendar invite with ICS sent successfully")
        except Exception as e:
            print(f"[Schedule] Calendar invite error (non-fatal): {e}")

    # Fallback: plain SMTP email (no ICS) if calendar invite failed
    if not email_sent and smtp_user and smtp_pass:
        try:
            email_sent = await gauth.send_interview_email_smtp(
                candidate_name=candidate["name"],
                candidate_email=candidate["email"],
                meet_url=meeting_url,
                scheduled_at=scheduled_dt,
                role_name=req.role_name,
                duration_minutes=req.duration_minutes,
                smtp_config=smtp_config,
            )
            if email_sent:
                print("[Schedule] Fallback SMTP email sent")
        except Exception as e:
            print(f"[Schedule] SMTP email error (non-fatal): {e}")

    # Final fallback: Gmail API (works for both auto and manual links)
    tokens = convex_client.query("settings:get", {"key": "google_tokens"}) if not email_sent else None
    if not email_sent and tokens and tokens.get("refresh_token"):
        sender = smtp_config.get("user") or os.getenv("SMTP_USER", os.getenv("GOOGLE_SENDER_EMAIL", ""))
        if sender:
            try:
                email_sent = await gauth.send_interview_email(
                    token_dict=tokens,
                    candidate_name=candidate["name"],
                    candidate_email=candidate["email"],
                    meet_url=meeting_url,
                    scheduled_at=scheduled_dt,
                    role_name=req.role_name,
                    sender=sender,
                    duration_minutes=req.duration_minutes,
                )
                if email_sent:
                    print("[Schedule] Email sent via Gmail API fallback")
            except Exception as e:
                print(f"[Schedule] Gmail API email error (non-fatal): {e}")

    recruiter_id = user.get("sub", "")
    attempt_number = int(candidate.get("attemptCount") or 0) + 1

    # Enrich system prompt with candidate profile and resume data
    enriched_prompt = _build_candidate_context(candidate, req.system_prompt)
    print(f"[Schedule] System prompt enriched with candidate profile ({len(enriched_prompt)} chars)")

    # Save to Convex
    try:
        interview_id = convex_client.mutation("scheduledInterviews:create", {
            "candidateId": req.candidate_id,
            "candidateName": candidate["name"],
            "candidateEmail": candidate["email"],
            "platform": req.platform,
            "meetingUrl": meeting_url,
            "scheduledAt": int(scheduled_dt.timestamp() * 1000),
            "durationMinutes": req.duration_minutes,
            "roleName": req.role_name,
            "systemPrompt": enriched_prompt,
            "botName": req.bot_name,
            "emailSent": email_sent,
            "calendarEventId": calendar_event_id,
            "recruiterId": recruiter_id,
            "attemptNumber": attempt_number,
        })
    except Exception as e:
        raise HTTPException(500, f"Failed to save scheduled interview: {e}")

    # Update candidate status to reflect scheduling
    try:
        convex_client.mutation("candidates:updateStatus", {
            "id": req.candidate_id,
            "interviewStatus": f"attempt_{attempt_number}_scheduled",
        })
    except Exception as e:
        print(f"[Schedule] Failed to update candidate status: {e}")

    # Timeline: interview scheduled + email sent
    _log_timeline(req.candidate_id, "interview_scheduled",
                  actor=recruiter_id,
                  metadata={
                      "meetingUrl": meeting_url,
                      "scheduledAt": int(scheduled_dt.timestamp() * 1000),
                      "roleName": req.role_name,
                      "attemptNumber": attempt_number,
                  })
    if email_sent:
        _log_timeline(req.candidate_id, "email_invite_sent",
                      actor="system",
                      metadata={"attemptNumber": attempt_number})

    # Schedule the bot — store metadata in scheduler for session creation
    from datetime import timezone
    run_at = datetime.datetime.fromtimestamp(
        int(scheduled_dt.timestamp()), tz=timezone.utc
    )
    scheduled_at_ms = int(scheduled_dt.timestamp() * 1000)
    sched.schedule_interview(
        interview_id=str(interview_id),
        meeting_url=meeting_url,
        system_prompt=req.system_prompt,
        bot_name=req.bot_name,
        candidate_name=candidate["name"],
        run_at=run_at,
        recruiter_id=recruiter_id,
        candidate_id=req.candidate_id,
        role_name=req.role_name,
        attempt_number=attempt_number,
        candidate_email=candidate.get("email", ""),
        duration_minutes=req.duration_minutes,
        scheduled_at_ms=scheduled_at_ms,
    )

    return {
        "status": "scheduled",
        "interview_id": interview_id,
        "meeting_url": meeting_url,
        "email_sent": email_sent,
        "scheduled_at": scheduled_dt.isoformat() + "Z",
    }


@app.get("/api/interviews/scheduled")
def list_scheduled_interviews(user: dict = Depends(get_current_user)):
    try:
        role = user.get("role", "recruiter")
        if role == "admin":
            return {"interviews": convex_client.query("scheduledInterviews:list") or []}
        recruiter_id = user.get("sub", "")
        return {"interviews": convex_client.query("scheduledInterviews:listByRecruiter", {"recruiterId": recruiter_id}) or []}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/interviews/{interview_id}/cancel")
def cancel_scheduled_interview(interview_id: str, user: dict = Depends(get_current_user)):
    try:
        convex_client.mutation("scheduledInterviews:updateStatus", {
            "id": interview_id, "status": "cancelled"
        })
        sched.cancel_interview(interview_id)
        return {"status": "cancelled"}
    except Exception as e:
        raise HTTPException(500, str(e))


class RecoverInterviewRequest(BaseModel):
    bot_id: str
    candidate_id: str
    role_name: str = "Interview"
    attempt_number: int = 1
    meeting_url: str = ""
    manual_transcript: str = ""  # paste raw transcript text from Recall.ai dashboard as fallback


@app.post("/api/interviews/recover")
async def recover_interview(req: RecoverInterviewRequest, user: dict = Depends(get_current_user)):
    """Recover a lost interview: fetch transcript from Recall.ai, generate scorecard, save to Convex.
    Use when bot.done webhook was never received and the in-memory session is gone."""
    from openai import AsyncOpenAI

    recall = _make_recall()
    try:
        # 1. Fetch transcript — try Recall.ai API first, fall back to manual paste
        transcript_list = []

        if req.manual_transcript:
            # Manual paste path: parse "SPEAKER: text" lines from Recall.ai dashboard copy-paste
            print(f"[Recover] Using manual transcript ({len(req.manual_transcript)} chars)")
            for line in req.manual_transcript.splitlines():
                line = line.strip()
                if not line:
                    continue
                if ":" in line:
                    speaker, _, text = line.partition(":")
                    text = text.strip()
                    speaker = speaker.strip()
                    if text:
                        transcript_list.append({"speaker": speaker, "text": text})
                else:
                    if transcript_list:
                        transcript_list[-1]["text"] += " " + line
        else:
            # Auto-fetch from Recall.ai API
            try:
                raw_transcript = await recall.get_transcript(req.bot_id)
                for utterance in raw_transcript:
                    participant = utterance.get("participant") or {}
                    speaker_name = participant.get("name") or "Candidate"
                    words = utterance.get("words") or []
                    text = " ".join(w.get("text", "") for w in words).strip()
                    if text:
                        transcript_list.append({"speaker": speaker_name, "text": text})
            except Exception as e:
                raise HTTPException(500, f"Could not fetch transcript from Recall.ai: {e}. "
                                        f"Try passing 'manual_transcript' with text copied from the Recall.ai dashboard.")

        if not transcript_list:
            raise HTTPException(404, "Transcript is empty — no speech was captured.")

        transcript_text = "\n".join(f"{e['speaker']}: {e['text']}" for e in transcript_list)
        word_count = len(transcript_text.split())
        print(f"[Recover] Bot {req.bot_id}: {len(transcript_list)} utterances, {word_count} words")

        # 3. Determine interview status
        if word_count >= 200:
            interview_status = "completed"
        elif word_count >= 100:
            interview_status = "partial"
        else:
            interview_status = "no_show"

        # 4. Fetch candidate info
        try:
            candidate = convex_client.query("candidates:get", {"id": req.candidate_id})
        except Exception as e:
            raise HTTPException(500, f"Could not fetch candidate: {e}")
        if not candidate:
            raise HTTPException(404, "Candidate not found")

        candidate_name = candidate.get("name", "Candidate")
        recruiter_id = candidate.get("recruiterId", "")

        # 5. Generate scorecard via OpenAI (standalone, no in-memory pipeline state)
        scorecard = {}
        if word_count >= 100:
            openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
            scorecard_prompt = f"""You are an expert recruiter evaluating a voice interview conducted by an AI bot.

IMPORTANT — ASR TRANSCRIPT NOTICE:
This transcript was produced by real-time speech-to-text on a live voice call. It may contain garbled technical terms, sentence fragments, and disfluencies — these are STT artefacts. Read every answer charitably. Do NOT penalise for garbled words or broken sentences. Only penalise for genuine lack of knowledge.

Candidate: {candidate_name}
Role: {req.role_name}

Interview Transcript:
{transcript_text[:6000]}

Generate a comprehensive JSON scorecard. Return ONLY valid JSON, no extra text:
{{
  "candidate_name": "{candidate_name}",
  "overall_score": <1-10 integer>,
  "recommendation": "<Strong Hire | Hire | Maybe | No Hire>",
  "summary": "<2-3 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "concerns": ["<concern 1>", "<concern 2>"],
  "categories": {{
    "technical_knowledge": {{"score": <1-10>, "notes": "<brief note>"}},
    "communication": {{"score": <1-10>, "notes": "<brief note>"}},
    "problem_solving": {{"score": <1-10>, "notes": "<brief note>"}},
    "cultural_fit": {{"score": <1-10>, "notes": "<brief note>"}}
  }}
}}"""
            try:
                model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
                resp = await openai_client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": scorecard_prompt}],
                    max_tokens=800,
                    temperature=0.2,
                    response_format={"type": "json_object"},
                )
                import json as _json
                scorecard = _json.loads(resp.choices[0].message.content or "{}")
                print(f"[Recover] Scorecard generated: score={scorecard.get('overall_score')}")
            except Exception as e:
                print(f"[Recover] Scorecard generation error: {e}")

        # 6. Save meeting to Convex
        try:
            meeting_id = convex_client.mutation("meetings:create", {
                "meetingUrl": req.meeting_url or f"recovered/bot/{req.bot_id}",
                "candidateName": candidate_name,
                "botName": "RecruitX AI Interviewer",
                "transcript": transcript_list,
                "scorecard": scorecard,
                "botId": req.bot_id,
                "interviewStatus": interview_status,
                "recruiterId": recruiter_id,
                "roleName": req.role_name,
                "attemptNumber": req.attempt_number,
            })
            print(f"[Recover] Meeting saved: {meeting_id}")
        except Exception as e:
            raise HTTPException(500, f"Failed to save meeting to Convex: {e}")

        # 7. Update candidate status
        try:
            import time as _time
            if interview_status in ("completed", "partial"):
                if req.attempt_number == 1:
                    cooldown_until = int(_time.time() * 1000) + 7 * 24 * 60 * 60 * 1000
                    convex_client.mutation("candidates:updateStatus", {
                        "id": req.candidate_id,
                        "interviewStatus": "cooldown",
                        "attemptCount": 1,
                        "cooldownUntil": cooldown_until,
                    })
                else:
                    convex_client.mutation("candidates:updateStatus", {
                        "id": req.candidate_id,
                        "interviewStatus": "locked",
                        "attemptCount": 2,
                        "cooldownUntil": None,
                    })
        except Exception as e:
            print(f"[Recover] Candidate status update error (non-fatal): {e}")

        # 8. Mark scheduled interview as completed if one exists
        try:
            all_scheduled = convex_client.query("scheduledInterviews:list") or []
            for s in all_scheduled:
                if s.get("candidateId") == req.candidate_id and s.get("status") == "active":
                    convex_client.mutation("scheduledInterviews:updateStatus", {
                        "id": s["_id"], "status": "completed",
                        "meetingId": str(meeting_id),
                    })
                    break
        except Exception as e:
            print(f"[Recover] Scheduled interview update error (non-fatal): {e}")

        _log_timeline(req.candidate_id, "interview_ended", metadata={
            "status": interview_status, "wordCount": word_count,
            "attemptNumber": req.attempt_number, "recoveredFromBotId": req.bot_id,
        })

        return {
            "status": "recovered",
            "meeting_id": str(meeting_id),
            "interview_status": interview_status,
            "word_count": word_count,
            "utterances": len(transcript_list),
            "scorecard": scorecard,
        }
    finally:
        await recall.aclose()


@app.post("/api/admin/candidates/{candidate_id}/reset")
def admin_reset_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: reset a candidate's interview state so they can be re-scheduled.
    Clears status → never_invited, attempt count → 0, cooldown → null.
    Also cancels any pending scheduled interviews for that candidate."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    try:
        # Cancel all non-terminal scheduled interviews for this candidate
        all_scheduled = convex_client.query("scheduledInterviews:list") or []
        cancelled_count = 0
        for s in all_scheduled:
            if s.get("candidateId") == candidate_id and s.get("status") not in ("completed", "cancelled"):
                try:
                    convex_client.mutation("scheduledInterviews:updateStatus", {
                        "id": s["_id"], "status": "cancelled"
                    })
                    sched.cancel_interview(str(s["_id"]))
                    cancelled_count += 1
                except Exception as inner_e:
                    print(f"[AdminReset] Could not cancel interview {s['_id']}: {inner_e}")

        convex_client.mutation("candidates:updateStatus", {
            "id": candidate_id,
            "interviewStatus": "never_invited",
            "attemptCount": 0,
            "cooldownUntil": None,
        })
        _log_timeline(candidate_id, "interview_cancelled", actor=user.get("sub", "admin"),
                      metadata={"reason": "Admin override reset",
                                "cancelledInterviews": cancelled_count})
        return {"status": "reset", "cancelled_interviews": cancelled_count}
    except Exception as e:
        raise HTTPException(500, str(e))
