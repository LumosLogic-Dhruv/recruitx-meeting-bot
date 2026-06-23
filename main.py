import asyncio
import os
from fastapi import FastAPI, HTTPException, Request
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
# meeting_url → bot_id (for lookup)
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
async def start_interview(req: StartInterviewRequest):
    if req.meeting_url in _url_to_bot:
        raise HTTPException(400, "Interview already active for this meeting URL")

    recall = _make_recall()
    pipeline = ConversationPipeline(
        system_prompt=req.system_prompt,
        openai_key=os.getenv("OPENAI_API_KEY", ""),
    )

    # Create the bot with webhook for real-time transcription
    webhook = _webhook_url()
    bot_data = await recall.create_bot(req.meeting_url, req.bot_name, webhook_url=webhook)
    bot_id = bot_data["id"]
    print(f"[Recall] Bot created: {bot_id}  webhook={webhook or 'none'}")

    # When AI produces a response, speak it via Recall
    async def on_ai_response(text: str, audio_bytes: bytes):
        print(f"[AI] Speaking: {text[:80]}...")
        try:
            await recall.speak(bot_id, audio_bytes)
        except Exception as e:
            print(f"[Recall] Speak error: {e}")

    pipeline.set_response_callback(on_ai_response)

    stop_event = asyncio.Event()
    _sessions[bot_id] = {
        "bot_id": bot_id,
        "meeting_url": req.meeting_url,
        "bot_name": req.bot_name,
        "stop_event": stop_event,
        "recall": recall,
        "pipeline": pipeline,
        "seen_transcript_count": 0,
    }
    _url_to_bot[req.meeting_url] = bot_id

    # If no webhook configured, fall back to polling
    if not webhook:
        print("[Recall] No RENDER_URL set — using transcript polling fallback")
        task = asyncio.create_task(_poll_transcript(bot_id))
        _sessions[bot_id]["task"] = task

    # Greeting is sent via webhook trigger (_send_greeting_now) when bot enters call
    # _send_greeting (polling fallback) only runs if no webhook
    if not webhook:
        asyncio.create_task(_send_greeting(bot_id))

    return {"status": "started", "bot_id": bot_id, "meeting_url": req.meeting_url}


async def _poll_transcript(bot_id: str):
    """Fallback: poll transcript every 3s when no webhook is configured."""
    session = _sessions.get(bot_id)
    if not session:
        return
    recall: RecallClient = session["recall"]
    stop_event: asyncio.Event = session["stop_event"]
    pipeline: ConversationPipeline = session["pipeline"]
    bot_name: str = session["bot_name"]

    while not stop_event.is_set():
        try:
            segments = await recall.get_transcript(bot_id)
            seen = session["seen_transcript_count"]
            for seg in segments[seen:]:
                words = seg.get("words", [])
                text = " ".join(w.get("text", "") for w in words).strip()
                speaker = seg.get("speaker", {})
                name = speaker.get("name", "Candidate") if isinstance(speaker, dict) else str(speaker)
                if text and name.lower() != bot_name.lower():
                    print(f"[Transcript] {name}: {text}")
                    pipeline.on_transcript_update(text)
            session["seen_transcript_count"] = len(segments)
        except Exception as e:
            print(f"[Transcript] Poll error: {e}")
        await asyncio.sleep(3)


async def _send_greeting_now(bot_id: str):
    """Send greeting immediately — triggered by webhook event."""
    print(f"[Greeting] _send_greeting_now called for {bot_id}")
    session = _sessions.get(bot_id)
    if not session:
        print(f"[Greeting] No session found for {bot_id}, sessions={list(_sessions.keys())}")
        return
    await asyncio.sleep(3)
    pipeline: ConversationPipeline = session["pipeline"]
    bot_name: str = session["bot_name"]
    greeting = f"Hello! I'm {bot_name}, your AI interviewer today. Let's get started — could you please introduce yourself?"
    print(f"[Greeting] Sending via webhook trigger...")
    try:
        recall: RecallClient = session["recall"]
        audio = await pipeline._tts(greeting)
        await recall.speak(bot_id, audio)
        print("[Greeting] Sent successfully.")
    except Exception as e:
        print(f"[Greeting] Failed: {e}")


async def _send_greeting(bot_id: str):
    """Wait for bot to be in the call then send an opening greeting."""
    session = _sessions.get(bot_id)
    if not session:
        return
    recall: RecallClient = session["recall"]
    pipeline: ConversationPipeline = session["pipeline"]
    bot_name: str = session["bot_name"]

    print("[Greeting] Waiting for bot to join...")
    for _ in range(60):
        await asyncio.sleep(10)
        try:
            bot = await recall.get_bot(bot_id)
            changes = bot.get("status_changes", [])
            status = changes[-1].get("code", "") if changes else ""
            print(f"[Greeting] Bot status: {status}")
            if status in ("in_call_not_recording", "in_call_recording"):
                break
        except Exception as e:
            print(f"[Greeting] Status error: {e}")
    else:
        print("[Greeting] Timed out.")
        return

    await asyncio.sleep(3)
    greeting = f"Hello! I'm {bot_name}, your AI interviewer today. Let's get started — could you please introduce yourself?"
    try:
        audio = await pipeline._tts(greeting)
        await recall.speak(bot_id, audio)
        print("[Greeting] Opening message sent.")
    except Exception as e:
        print(f"[Greeting] Failed: {e}")


@app.post("/webhook/recall")
async def recall_webhook(request: Request):
    """Receive real-time transcript events from Recall.ai."""
    body = await request.json()
    event = body.get("event", "")
    data = body.get("data", {})
    print(f"[Webhook] Event: {event} | Data keys: {list(data.keys())}")

    if event in ("bot.in_call_recording", "bot.in_call_not_recording"):
        bot_id = data.get("bot", {}).get("id", "")
        print(f"[Webhook] Bot in call: {bot_id}")
        session = _sessions.get(bot_id)
        if session and not session.get("greeted"):
            session["greeted"] = True
            asyncio.create_task(_send_greeting_now(bot_id))

    if event == "transcript.data":
        bot_id = data.get("bot", {}).get("id", "")
        session = _sessions.get(bot_id)
        if not session:
            return {"ok": True}

        pipeline: ConversationPipeline = session["pipeline"]
        bot_name: str = session["bot_name"]
        transcript = data.get("data", {}).get("transcript", data.get("transcript", {}))
        words = transcript.get("words", [])
        is_final = transcript.get("is_final", False)
        speaker = transcript.get("speaker", "Candidate")
        print(f"[Webhook] Transcript from {speaker}: is_final={is_final} words={len(words)}")

        if is_final and words and speaker.lower() != bot_name.lower():
            text = " ".join(w.get("text", "") for w in words).strip()
            if text:
                print(f"[Webhook] {speaker}: {text}")
                pipeline.on_transcript_update(text, speaker)

    return {"ok": True}


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
    await recall.stop_bot(bot_id)

    pipeline: ConversationPipeline = session.get("pipeline")
    transcript = pipeline.get_transcript_text() if pipeline else ""
    transcript_list = pipeline.get_transcript_list() if pipeline else []

    # Generate scorecard
    scorecard = {}
    if pipeline and transcript:
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
        "conversation": transcript,
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
