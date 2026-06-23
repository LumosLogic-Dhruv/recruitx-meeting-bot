import asyncio
import base64
import httpx
from typing import Callable, Awaitable


class RecallClient:
    def __init__(self, api_key: str, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
        }

    async def create_bot(self, meeting_url: str, bot_name: str = "AI Interviewer", webhook_url: str = "") -> dict:
        payload: dict = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
        }
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self.base_url}/bot/",
                headers=self.headers,
                json=payload,
                timeout=30.0,
            )
            if not res.is_success:
                print(f"[Recall] Create bot error {res.status_code}: {res.text}")
                res.raise_for_status()
            return res.json()

    async def get_bot(self, bot_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{self.base_url}/bot/{bot_id}/",
                headers=self.headers,
                timeout=15.0,
            )
            res.raise_for_status()
            return res.json()

    async def get_transcript(self, bot_id: str) -> list:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{self.base_url}/bot/{bot_id}/transcript/",
                headers=self.headers,
                timeout=15.0,
            )
            res.raise_for_status()
            return res.json()

    async def speak(self, bot_id: str, audio_bytes: bytes):
        b64 = base64.b64encode(audio_bytes).decode()
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self.base_url}/bot/{bot_id}/output_audio/",
                headers=self.headers,
                json={"kind": "mp3", "b64_data": b64},
                timeout=30.0,
            )
            if not res.is_success:
                print(f"[Recall] Speak error {res.status_code}: {res.text}")
            else:
                print(f"[Recall] Speak accepted: {res.status_code} | bytes={len(audio_bytes)}")
            res.raise_for_status()

    async def stop_bot(self, bot_id: str):
        async with httpx.AsyncClient() as client:
            res = await client.delete(
                f"{self.base_url}/bot/{bot_id}/",
                headers=self.headers,
                timeout=15.0,
            )
            if res.status_code not in (200, 204, 404):
                res.raise_for_status()

    async def listen_transcript(
        self,
        bot_id: str,
        on_update: Callable[[str, str], Awaitable[None]],
        stop_event: asyncio.Event,
    ):
        """Poll transcript every 3s and fire on_update for new confirmed segments."""
        seen_count = 0

        while not stop_event.is_set():
            try:
                segments = await self.get_transcript(bot_id)
                new_segments = segments[seen_count:]
                for seg in new_segments:
                    words = seg.get("words", [])
                    if not words:
                        continue
                    text = " ".join(w.get("text", "") for w in words).strip()
                    speaker = seg.get("speaker", {})
                    name = speaker.get("name", "Candidate") if isinstance(speaker, dict) else str(speaker)
                    if text:
                        await on_update(text, name)
                seen_count = len(segments)
            except Exception as e:
                print(f"[Transcript] Poll error: {e}")

            await asyncio.sleep(3)
