import asyncio
from typing import Callable, Awaitable
from openai import AsyncOpenAI

SILENCE_TIMEOUT = 2.0


class ConversationPipeline:
    def __init__(self, system_prompt: str, openai_key: str, openai_model: str = "gpt-4o-mini"):
        self._openai = AsyncOpenAI(api_key=openai_key)
        self._model = openai_model
        self._history: list[dict] = [{"role": "system", "content": system_prompt}]
        self._pending_text: str = ""
        self._silence_task: asyncio.Task | None = None
        self._speaking: bool = False
        self._on_response: Callable[[str, bytes], Awaitable[None]] | None = None

    def set_response_callback(self, callback: Callable[[str, bytes], Awaitable[None]]):
        self._on_response = callback

    def on_transcript_update(self, text: str):
        if self._speaking:
            return
        self._pending_text = text
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = asyncio.create_task(self._wait_for_silence())

    async def _wait_for_silence(self):
        await asyncio.sleep(SILENCE_TIMEOUT)
        text = self._pending_text.strip()
        self._pending_text = ""
        if text:
            await self._process_turn(text)

    async def _process_turn(self, user_text: str):
        self._speaking = True
        try:
            self._history.append({"role": "user", "content": user_text})
            response = await self._openai.chat.completions.create(
                model=self._model,
                messages=self._history,
                temperature=0.7,
                max_tokens=150,
            )
            ai_text = response.choices[0].message.content or ""
            self._history.append({"role": "assistant", "content": ai_text})

            if ai_text and self._on_response:
                audio = await self._tts(ai_text)
                await self._on_response(ai_text, audio)
        finally:
            self._speaking = False

    async def _tts(self, text: str) -> bytes:
        response = await self._openai.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=text,
            response_format="wav",
        )
        return response.content

    def get_transcript_text(self) -> str:
        lines = []
        for msg in self._history:
            if msg["role"] == "user":
                lines.append(f"Candidate: {msg['content']}")
            elif msg["role"] == "assistant":
                lines.append(f"AI: {msg['content']}")
        return "\n".join(lines)
