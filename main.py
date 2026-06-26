import asyncio
import io
import os
import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends, Header, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import jwt
import bcrypt
from convex import ConvexClient
import pypdf

from recall_client import RecallClient
from pipeline import ConversationPipeline

load_dotenv()

# Convex Client Setup
CONVEX_URL = os.getenv("CONVEX_URL", "https://focused-poodle-713.eu-west-1.convex.cloud")
convex_client = ConvexClient(CONVEX_URL)

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

app = FastAPI(title="RecruitX AI Interviewer Bot Server")
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
    pipeline = ConversationPipeline(
        system_prompt=req.system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
        elevenlabs_key=os.getenv("ELEVENLABS_API_KEY", ""),
        voice_id=os.getenv("ELEVENLABS_VOICE_ID", "V9LCAAi4tTlqe9JadbCo"),
    )

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

    # Real-time transcript segment (delivered via per-bot realtime_endpoints)
    if event == "transcript.data":
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

        print(f"[Webhook] Transcript from {speaker}: words={len(words)}")

        if words and speaker.lower() != bot_name.lower():
            text = " ".join(w.get("text", "") for w in words).strip()
            if text:
                # Deduplication: Deepgram occasionally re-delivers a corrected or
                # duplicate final segment for the same utterance. Without this check
                # the pipeline would process the same text twice, producing a second
                # AI response mid-sentence or creating doubled transcript entries.
                seen = _seen_segments.setdefault(bot_id, set())
                segment_key = f"{speaker}:{text}"
                if segment_key in seen:
                    print(f"[Webhook] Duplicate segment skipped: {text[:50]}")
                    return {"ok": True}
                seen.add(segment_key)
                # Cap the set size to avoid unbounded memory growth on long interviews
                if len(seen) > 400:
                    seen.clear()

                print(f"[Webhook] {speaker}: {text}")
                pipeline.on_transcript_update(text, speaker)

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
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
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
