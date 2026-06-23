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

    async def create_bot(
        self,
        meeting_url: str,
        bot_name: str = "AI Interviewer",
        webhook_url: str = "",
        deepgram_api_key: str = "",
    ) -> dict:
        recording_config: dict = {
            "transcript": {
                "provider": {
                    "deepgram_streaming": {
                        "model": "nova-3",
                        "smart_format": True,
                        # 300ms matches CallerX's proven value — short enough to feel
                        # responsive but long enough to capture natural speech segments.
                        # The pipeline accumulates multiple segments before responding.
                        "endpointing": 300,
                    },
                }
            }
        }
        # Per-bot realtime endpoint so transcript.data events reach our server.
        # This is separate from the global webhook (which handles bot lifecycle events).
        if webhook_url:
            recording_config["realtime_endpoints"] = [
                {"url": webhook_url, "type": "webhook", "events": ["transcript.data"]}
            ]

        payload: dict = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
            "recording_config": recording_config,
        }

        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self.base_url}/bot/",
                headers=self.headers,
                json=payload,
                timeout=30.0,
            )
        if not res.is_success:
            print(f"[Recall] create_bot failed {res.status_code}: {res.text}")
            res.raise_for_status()
        print(f"[Recall] Bot created with Deepgram streaming transcription (endpoint: {webhook_url or 'none'})")
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
            res = await client.post(
                f"{self.base_url}/bot/{bot_id}/leave_call/",
                headers=self.headers,
                timeout=15.0,
            )
            if res.status_code not in (200, 204, 404):
                res.raise_for_status()
