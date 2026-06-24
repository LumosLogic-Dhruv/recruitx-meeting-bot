import asyncio
import os
import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import jwt
import bcrypt
from convex import ConvexClient

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

app = FastAPI(title="Lumos Meet Interview Bot Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")

# bot_id → session data
_sessions: dict[str, dict] = {}
# meeting_url → bot_id
_url_to_bot: dict[str, str] = {}


class StartInterviewRequest(BaseModel):
    meeting_url: str
    system_prompt: str
    bot_name: str = "AI Interviewer"


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

        # New API payload: data.data.words + data.data.participant.name
        inner = data.get("data", {})
        words = inner.get("words", [])
        participant = inner.get("participant", {})
        speaker = participant.get("name") or "Candidate"

        print(f"[Webhook] Transcript from {speaker}: words={len(words)}")

        if words and speaker.lower() != bot_name.lower():
            text = " ".join(w.get("text", "") for w in words).strip()
            if text:
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

    # Save the completed meeting and transcript to Convex
    try:
        convex_client.mutation(
            "meetings:create",
            {
                "meetingUrl": req.meeting_url,
                "candidateName": req.candidate_name,
                "botName": session.get("bot_name") or "Alex",
                "transcript": transcript_list,
                "scorecard": scorecard,
            }
        )
        print("[Convex] Meeting stored successfully.")
    except Exception as e:
        print(f"[Convex] Failed to store meeting in database: {e}")

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
    
    # Hash password
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
        
        # Verify password
        if not bcrypt.checkpw(req.password.encode('utf-8'), user["passwordHash"].encode('utf-8')):
            raise HTTPException(400, "Invalid email or password")
        
        # Create JWT token
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
        # Pass ID directly to get details
        meeting = convex_client.query("meetings:get", {"id": meeting_id})
        if not meeting:
            raise HTTPException(404, "Meeting not found")
        return {"meeting": meeting}
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


@app.get("/api/prompts")
def list_prompts(user: dict = Depends(get_current_user)):
    try:
        prompts = convex_client.query("prompts:list")
        return {"prompts": prompts}
    except Exception as e:
        raise HTTPException(500, f"Convex error: {str(e)}")


@app.post("/api/prompts/generate")
async def generate_prompt(req: GeneratePromptRequest, user: dict = Depends(get_current_user)):
    role = req.role_name.strip()
    if not role:
        raise HTTPException(400, "Role name is required")

    system_instruction = (
        "You are an expert recruiter and prompt engineer. "
        "Generate a highly detailed and effective system prompt for an AI interviewer. "
        "The generated prompt should tell the AI interviewer how to act, what rules to follow, and the flow of the interview.\n"
        "Ensure the output is ONLY the system prompt text, formatted cleanly. "
        "It MUST contain rules like: ask exactly ONE question per response, keep responses under 40 words, introduce yourself, review candidate background, and end with a summary. "
        "Make it highly tailored to the specific role name provided."
    )
    
    user_message = f"Generate an AI interviewer system prompt for the role: '{role}'."
    
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(500, "OpenAI API key not configured")
        
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=openai_key)
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
            max_tokens=600
        )
        generated_prompt = response.choices[0].message.content.strip()
        
        # Save to Convex
        try:
            convex_client.mutation(
                "prompts:create",
                {
                    "roleName": role,
                    "promptText": generated_prompt
                }
            )
        except Exception as e:
            print(f"[Convex] Failed to save prompt: {e}")

        return {"role_name": role, "prompt_text": generated_prompt}
    except Exception as e:
        raise HTTPException(500, f"OpenAI error: {str(e)}")
