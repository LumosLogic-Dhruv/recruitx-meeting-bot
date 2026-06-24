import asyncio
import json
from typing import Callable, Awaitable
from openai import AsyncOpenAI

# How long the pipeline waits after the last Deepgram segment before responding.
# Deepgram endpointing=300ms means segments arrive on short pauses; we accumulate
# them for 4.5s of actual silence before the AI fires.
SILENCE_TIMEOUT = 4.5


class ConversationPipeline:
    def __init__(self, system_prompt: str, openai_key: str, openai_model: str = "gpt-4o-mini"):
        self._openai = AsyncOpenAI(api_key=openai_key)
        self._model = openai_model
        self._system_prompt = system_prompt
        self._history: list[dict] = [{"role": "system", "content": system_prompt}]
        self._pending_text: str = ""
        self._pending_speaker: str = "Candidate"
        self._silence_task: asyncio.Task | None = None
        self._speaking: bool = False
        self._on_response: Callable[[str, bytes], Awaitable[None]] | None = None
        self._full_transcript: list[dict] = []

    def set_response_callback(self, callback: Callable[[str, bytes], Awaitable[None]]):
        self._on_response = callback

    async def send_greeting(self, bot_name: str) -> bytes:
        self._speaking = True
        try:
            greeting = (
                f"Hello! I'm {bot_name}, your AI interviewer today. "
                "To get started, could you please introduce yourself and tell me a bit about your background?"
            )
            audio = await self._tts(greeting)
            self._history.append({"role": "assistant", "content": greeting})
            self._full_transcript.append({"speaker": "AI", "text": greeting})
            print(f"[Pipeline] Greeting sent.")
            return audio
        finally:
            self._speaking = False
            self._flush_pending()

    def on_transcript_update(self, text: str, speaker: str = "Candidate"):
        # Accumulate text regardless of whether bot is currently speaking.
        # Speaker-name filtering (in the webhook handler) already removes echo —
        # we don't need a time-based cooldown that drops real candidate speech.
        self._pending_text = (self._pending_text + " " + text).strip()
        self._pending_speaker = speaker

        if self._speaking:
            # Bot is mid-response: buffer without starting timer.
            # Timer starts in _flush_pending() when bot finishes.
            print(f"[Pipeline] Buffered (bot speaking): {text[:50]}")
            return

        self._reset_silence_timer()

    def _reset_silence_timer(self):
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = asyncio.create_task(self._wait_for_silence())

    def _flush_pending(self):
        """Called when bot finishes speaking — start silence timer if candidate said anything."""
        if self._pending_text:
            print(f"[Pipeline] Flushing buffered text after bot speech: {self._pending_text[:60]}")
            self._reset_silence_timer()

    async def _wait_for_silence(self):
        await asyncio.sleep(SILENCE_TIMEOUT)
        text = self._pending_text.strip()
        speaker = self._pending_speaker
        self._pending_text = ""
        if text:
            await self._process_turn(text, speaker)

    async def _process_turn(self, user_text: str, speaker: str = "Candidate"):
        self._speaking = True
        try:
            print(f"[Pipeline] Processing — {speaker}: {user_text[:100]}")
            self._full_transcript.append({"speaker": speaker, "text": user_text})
            self._history.append({"role": "user", "content": user_text})

            response = await self._openai.chat.completions.create(
                model=self._model,
                messages=self._history,
                temperature=0.7,
                max_tokens=300,
            )
            ai_text = response.choices[0].message.content or ""
            self._history.append({"role": "assistant", "content": ai_text})
            self._full_transcript.append({"speaker": "AI", "text": ai_text})
            print(f"[Pipeline] AI: {ai_text[:100]}")

            if ai_text and self._on_response:
                audio = await self._tts(ai_text)
                await self._on_response(ai_text, audio)
        except Exception as e:
            print(f"[Pipeline] Error: {e}")
        finally:
            self._speaking = False
            self._flush_pending()

    async def _tts(self, text: str) -> bytes:
        response = await self._openai.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=text,
            response_format="mp3",
        )
        return response.content

    def get_transcript_text(self) -> str:
        return "\n".join(f"{e['speaker']}: {e['text']}" for e in self._full_transcript)

    def get_transcript_list(self) -> list[dict]:
        return list(self._full_transcript)

    async def generate_scorecard(self, candidate_name: str = "Candidate") -> dict:
        transcript = self.get_transcript_text()
        if not transcript:
            return {"error": "No transcript available"}

        scorecard_prompt = f"""You are an expert recruiter. Analyze this interview transcript and generate a detailed scorecard.

Interview Transcript:
{transcript}

Generate a JSON scorecard with this exact structure:
{{
  "candidate_name": "{candidate_name}",
  "overall_score": <1-10>,
  "recommendation": "STRONG HIRE | HIRE | MAYBE | NO HIRE",
  "summary": "<2-3 sentence summary of the candidate>",
  "dimensions": [
    {{"name": "<dimension>", "score": <1-10>, "comment": "<brief comment>"}},
    ...
  ],
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "concerns": ["<concern 1>", "<concern 2>", ...],
  "suggested_next_steps": "<what should happen next>"
}}

Score 4-6 dimensions relevant to what was actually discussed.
Return ONLY valid JSON, no extra text."""

        response = await self._openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": scorecard_prompt}],
            temperature=0.3,
            max_tokens=800,
        )

        try:
            content = (response.choices[0].message.content or "{}").strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
        except Exception as e:
            return {"error": f"Failed to parse scorecard: {e}", "raw": response.choices[0].message.content}
