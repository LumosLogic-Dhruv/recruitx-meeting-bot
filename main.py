import asyncio
import os
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from recall_client import RecallClient
from pipeline import ConversationPipeline

load_dotenv()

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
async def start_interview(req: StartInterviewRequest, background_tasks: BackgroundTasks):
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
async def end_interview(req: EndInterviewRequest):
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

    return {
        "status": "ended",
        "meeting_url": req.meeting_url,
        "transcript": transcript_list,
        "conversation": transcript_text,
        "scorecard": scorecard,
    }


@app.get("/transcript/{bot_id}")
def get_transcript(bot_id: str):
    session = _sessions.get(bot_id)
    if not session:
        raise HTTPException(404, "Session not found")
    pipeline: ConversationPipeline = session.get("pipeline")
    return {"transcript": pipeline.get_transcript_list() if pipeline else []}


@app.get("/sessions")
def list_sessions():
    return {"active": list(_url_to_bot.keys())}
