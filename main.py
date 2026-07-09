import asyncio
import io
import os
import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends, Header, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
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

VOICE_OPTIONS = {
    "custom": os.getenv("ELEVENLABS_VOICE_ID", "SNr51KAoFWjq7b0L9cRb"),
    "nila": os.getenv("ELEVENLABS_VOICE_ID_NILA", "aGb0TwKthRLQTPThYRqI"),
}

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-key-change-me")

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid token")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    except Exception as e:
        raise HTTPException(401, f"Authentication error: {str(e)}")

@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup: initialise scheduler and reload pending interviews
    sched.init(
        create_session_fn=_scheduled_create_session,
        convex_client=convex_client,
    )
    sched.scheduler.start()
    await sched.reload_pending(convex_client)
    yield
    # Shutdown
    sched.scheduler.shutdown(wait=False)


app = FastAPI(title="RecruitX AI Interviewer Bot Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")

# bot_id → session data
_sessions: dict[str, dict] = {}
# meeting_url → bot_id
_url_to_bot: dict[str, str] = {}
# bot_id → set of "speaker:text" keys already forwarded to the pipeline.
# Prevents Deepgram from re-delivering a corrected/duplicate final segment and
# triggering a second AI response for text the pipeline has already processed.
_seen_segments: dict[str, set] = {}


class StartInterviewRequest(BaseModel):
    meeting_url: str
    system_prompt: str
    bot_name: str = "RecruitX AI Interviewer"
    voice_id: str = ""
    candidate_name: str = "Candidate"


class EndInterviewRequest(BaseModel):
    meeting_url: str
    candidate_name: str = "Candidate"


def _make_recall() -> RecallClient:
    return RecallClient(
        api_key=os.getenv("RECALL_API_KEY", ""),
        base_url=os.getenv("RECALL_API_URL", "https://us-east-1.recall.ai/api/v1"),
    )


def _deepgram_key() -> str:
    return os.getenv("DEEPGRAM_API_KEY", "")


def _webhook_url() -> str:
    base = os.getenv("RENDER_URL", "").rstrip("/")
    return f"{base}/webhook/recall" if base else ""


@app.get("/")
def ui():
    return FileResponse("static/index.html")


@app.get("/login")
def login_page():
    return FileResponse("static/login.html")


@app.get("/signup")
def signup_page():
    return FileResponse("static/signup.html")


@app.get("/dashboard")
def dashboard_page():
    return FileResponse("static/dashboard.html")


@app.get("/health")
def health():
    return {"status": "ok", "active_sessions": list(_sessions.keys())}


@app.post("/start-interview")
async def start_interview(req: StartInterviewRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    if req.meeting_url in _url_to_bot:
        raise HTTPException(400, "Interview already active for this meeting URL")

    recall = _make_recall()
    voice_id = VOICE_OPTIONS.get(req.voice_id, VOICE_OPTIONS["custom"])
    pipeline = ConversationPipeline(
        system_prompt=req.system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
        elevenlabs_key=os.getenv("ELEVENLABS_API_KEY", ""),
        voice_id=voice_id,
    )
    print(f"[Pipeline] Voice: {voice_id}")

    async def on_ai_response(text: str, audio_bytes: bytes):
        try:
            await recall.speak(bot_id, audio_bytes)
        except Exception as e:
            print(f"[Recall] Speak error: {e}")

    pipeline.set_response_callback(on_ai_response)

    bot_data = await recall.create_bot(
        req.meeting_url,
        req.bot_name,
        webhook_url=_webhook_url(),
        deepgram_api_key=_deepgram_key(),
    )
    bot_id = bot_data["id"]
    print(f"[Recall] Bot created: {bot_id}")

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
    }
    _url_to_bot[req.meeting_url] = bot_id

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

    # Send greeting if webhook hasn't already done it
    await asyncio.sleep(3)
    session = _sessions.get(bot_id)
    if session and not session.get("greeted"):
        session["greeted"] = True
        print("[Poll] Sending greeting via polling path...")
        try:
            audio = await pipeline.send_greeting(bot_name)
            await recall.speak(bot_id, audio)
        except Exception as e:
            print(f"[Poll] Greeting error: {e}")

    # Transcript comes via webhook events (transcript.data) in the AP region.
    # The /transcript/ REST endpoint requires transcription_options which AP region rejects.
    # Keep this loop alive so stop_event can cleanly terminate the task.
    print("[Poll] Waiting for transcript via webhook events...")
    while not stop_event.is_set():
        await asyncio.sleep(10)


@app.post("/webhook/recall")
async def recall_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive real-time events from Recall.ai (configure webhook URL in Recall dashboard)."""
    body = await request.json()
    event = body.get("event", "")
    data = body.get("data", {})
    print(f"[Webhook] Event: {event}")

    # Bot joined the call — send greeting
    if event in ("bot.in_call_recording", "bot.in_call_not_recording"):
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.get(bot_id)
        if session and not session.get("greeted"):
            session["greeted"] = True
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
        await recall.speak(bot_id, audio)
    except Exception as e:
        print(f"[Webhook] Greeting error: {e}")


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

    scorecard = {}
    if pipeline and transcript_text:
        print(f"[AutoEnd] Generating scorecard for {candidate_name}...")
        try:
            scorecard = await pipeline.generate_scorecard(candidate_name)
            print("[AutoEnd] Scorecard done.")
        except Exception as e:
            print(f"[AutoEnd] Scorecard error: {e}")

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
                "scorecard": scorecard,
                "botId": bot_id,
            },
        )
        print(f"[AutoEnd] Meeting stored: {meeting_id}")
    except Exception as e:
        print(f"[AutoEnd] Convex save error: {e}")

    if meeting_id:
        asyncio.create_task(_fetch_and_store_recording(bot_id, str(meeting_id)))

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


async def _fetch_and_store_recording(bot_id: str, meeting_id: str):
    """Background task: poll Recall.ai for the recording, then store URLs in Convex."""
    print(f"[Recording] Waiting for recording of bot {bot_id}...")
    recall = _make_recall()
    try:
        # Wait for the full mixed recording to be ready (up to 5 min).
        recording = await recall.poll_bot_recording(bot_id, max_wait=300)
        if not recording:
            print(f"[Recording] Gave up waiting for bot {bot_id}")
            return

        recording_id = recording.get("id")

        # Extract full mixed video URL.
        shortcuts = recording.get("media_shortcuts") or {}
        video_mixed = shortcuts.get("video_mixed") or {}
        recording_url = (video_mixed.get("data") or {}).get("download_url")

        # Fetch per-participant separate audio (bot track + candidate track).
        bot_audio_url = None
        candidate_audio_url = None
        if recording_id:
            tracks = await recall.get_separate_audio(recording_id, max_wait=120)
            for track in tracks:
                participant = track.get("participant") or {}
                url = (track.get("data") or {}).get("download_url")
                if not url:
                    continue
                # Recall.ai bots join as non-hosts; the meeting owner (candidate) is the host.
                if participant.get("is_host"):
                    candidate_audio_url = url
                else:
                    bot_audio_url = url

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
    finally:
        # Each call to _make_recall() creates its own AsyncClient.
        # Always close it when the background task finishes to free the connection pool.
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

    scorecard = {}
    if pipeline and transcript_text:
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
                "scorecard": scorecard,
                "botId": bot_id,
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
        raise HTTPException(400, str(e))


@app.post("/api/auth/login")
def login(req: LoginRequest):
    email = req.email.lower().strip()
    try:
        user = convex_client.query("users:getByEmail", {"email": email})
        if not user:
            raise HTTPException(400, "Invalid email or password")

        if not bcrypt.checkpw(req.password.encode('utf-8'), user["passwordHash"].encode('utf-8')):
            raise HTTPException(400, "Invalid email or password")

        token_payload = {
            "sub": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }
        token = jwt.encode(token_payload, JWT_SECRET, algorithm="HS256")

        return {
            "token": token,
            "user": {
                "id": user["_id"],
                "name": user["name"],
                "email": user["email"]
            }
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(500, f"Login error: {str(e)}")


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
                                     candidate_name: str, scheduled_interview_id: str):
    """Called by the scheduler at interview time — mirrors /start-interview logic."""
    if meeting_url in _url_to_bot:
        print(f"[Scheduler] Session already active for {meeting_url} — skipping")
        return

    recall = _make_recall()
    pipeline = ConversationPipeline(
        system_prompt=system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
        elevenlabs_key=os.getenv("ELEVENLABS_API_KEY", ""),
        voice_id=VOICE_OPTIONS["custom"],
    )

    bot_id_holder: list[str] = []

    async def on_ai_response(text: str, audio_bytes: bytes):
        if bot_id_holder:
            try:
                await recall.speak(bot_id_holder[0], audio_bytes)
            except Exception as e:
                print(f"[Scheduler] Speak error: {e}")

    pipeline.set_response_callback(on_ai_response)

    try:
        bot_data = await recall.create_bot(
            meeting_url,
            bot_name,
            webhook_url=_webhook_url(),
            deepgram_api_key=_deepgram_key(),
        )
    except Exception as e:
        print(f"[Scheduler] create_bot error: {e}")
        await recall.aclose()
        return

    bot_id = bot_data["id"]
    bot_id_holder.append(bot_id)
    print(f"[Scheduler] Bot created for scheduled interview {scheduled_interview_id}: {bot_id}")

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
        "scheduled_interview_id": scheduled_interview_id,
    }
    _url_to_bot[meeting_url] = bot_id

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
    if error:
        print(f"[Google OAuth] Google returned error: {error}")
        return RedirectResponse(url=f"/dashboard?google_error={error}")
    if not code:
        return RedirectResponse(url="/dashboard?google_error=missing_code")
    try:
        import urllib.parse
        loop = asyncio.get_event_loop()
        tokens = await loop.run_in_executor(None, lambda: gauth.exchange_code(code, state))
        convex_client.mutation("settings:set", {"key": "google_tokens", "value": tokens})
        print("[Google OAuth] Tokens saved to Convex successfully")
        return RedirectResponse(url="/dashboard?google_connected=1")
    except Exception as e:
        print(f"[Google OAuth] Callback exception: {type(e).__name__}: {e}")
        import urllib.parse
        return RedirectResponse(url=f"/dashboard?google_error={urllib.parse.quote(str(e)[:80])}")


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


# ── Candidate management endpoints ────────────────────────────────────────────

class CandidateCreateRequest(BaseModel):
    name: str
    email: str
    phone: str = ""
    notes: str = ""


@app.post("/api/candidates")
def create_candidate(req: CandidateCreateRequest, user: dict = Depends(get_current_user)):
    if not req.name or not req.email:
        raise HTTPException(400, "Name and email are required")
    try:
        cid = convex_client.mutation("candidates:create", {
            "name": req.name,
            "email": req.email.lower().strip(),
            **({"phone": req.phone} if req.phone else {}),
            **({"notes": req.notes} if req.notes else {}),
        })
        return {"id": cid, "name": req.name, "email": req.email}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/candidates")
def list_candidates(user: dict = Depends(get_current_user)):
    try:
        return {"candidates": convex_client.query("candidates:list") or []}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    try:
        convex_client.mutation("candidates:remove", {"id": candidate_id})
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Schedule interview endpoint ───────────────────────────────────────────────

class ScheduleInterviewRequest(BaseModel):
    candidate_id: str
    platform: str = "google_meet"      # "google_meet" | "zoom" | "teams"
    scheduled_at_iso: str              # ISO 8601 UTC e.g. "2026-07-15T10:00:00Z"
    duration_minutes: int = 30
    role_name: str = "Interview"
    system_prompt: str = ""
    bot_name: str = "RecruitX AI Interviewer"


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
    if req.platform == "google_meet":
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
        raise HTTPException(400, "Zoom integration not yet configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET env vars.")
    elif req.platform == "teams":
        raise HTTPException(400, "Microsoft Teams integration not yet configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET env vars.")
    else:
        raise HTTPException(400, f"Unknown platform: {req.platform}")

    # Send email invite
    sender = os.getenv("GOOGLE_SENDER_EMAIL", "")
    email_sent = False
    if req.platform == "google_meet" and tokens and sender:
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
        except Exception as e:
            print(f"[Schedule] Email error (non-fatal): {e}")

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
            "systemPrompt": req.system_prompt,
            "botName": req.bot_name,
            "emailSent": email_sent,
            "calendarEventId": calendar_event_id,
        })
    except Exception as e:
        raise HTTPException(500, f"Failed to save scheduled interview: {e}")

    # Schedule the bot
    from datetime import timezone
    run_at = datetime.datetime.fromtimestamp(
        int(scheduled_dt.timestamp()), tz=timezone.utc
    )
    sched.schedule_interview(
        interview_id=str(interview_id),
        meeting_url=meeting_url,
        system_prompt=req.system_prompt,
        bot_name=req.bot_name,
        candidate_name=candidate["name"],
        run_at=run_at,
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
        return {"interviews": convex_client.query("scheduledInterviews:list") or []}
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
