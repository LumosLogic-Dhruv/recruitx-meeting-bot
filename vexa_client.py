import asyncio
import base64
import json
import httpx
import websockets
from typing import Callable, Awaitable


class VexaClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

    async def _find_bot(self, client: httpx.AsyncClient, native_meeting_id: str) -> dict | None:
        res = await client.get(f"{self.base_url}/bots", headers=self.headers, timeout=15.0)
        res.raise_for_status()
        meetings = res.json().get("meetings", [])
        return next((b for b in meetings if b.get("native_meeting_id") == native_meeting_id), None)

    async def start_bot(self, native_meeting_id: str, bot_name: str = "Lumos AI Interviewer") -> dict:
        payload = {
            "platform": "google_meet",
            "native_meeting_id": native_meeting_id,
            "bot_name": bot_name,
            "recording_enabled": True,
            "transcribe_enabled": True,
            "transcription_tier": "realtime",
        }
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self.base_url}/bots",
                headers=self.headers,
                json=payload,
                timeout=30.0,
            )
            if res.status_code == 409:
                existing = await self._find_bot(client, native_meeting_id)
                if existing:
                    print(f"[Vexa] Reusing existing bot id={existing['id']} status={existing['status']}")
                    return existing
                raise
            res.raise_for_status()
            return res.json()

    async def stop_bot(self, native_meeting_id: str) -> None:
        async with httpx.AsyncClient() as client:
            bot = await self._find_bot(client, native_meeting_id)
            if bot is None:
                return
            res = await client.delete(
                f"{self.base_url}/bots/{bot['id']}",
                headers=self.headers,
                timeout=15.0,
            )
            if res.status_code not in (200, 204, 404):
                res.raise_for_status()

    async def set_avatar(self, native_meeting_id: str, image_url: str):
        async with httpx.AsyncClient() as client:
            res = await client.put(
                f"{self.base_url}/bots/google_meet/{native_meeting_id}/avatar",
                headers=self.headers,
                json={"image_url": image_url},
                timeout=15.0,
            )
            res.raise_for_status()

    async def speak(self, native_meeting_id: str, text: str):
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self.base_url}/bots/google_meet/{native_meeting_id}/speak",
                headers=self.headers,
                json={"text": text, "provider": "piper", "voice": "auto"},
                timeout=30.0,
            )
            res.raise_for_status()

    async def get_transcript(self, native_meeting_id: str) -> list:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{self.base_url}/transcripts/google_meet/{native_meeting_id}",
                headers=self.headers,
                timeout=15.0,
            )
            res.raise_for_status()
            data = res.json()
            return data.get("segments", [])

    async def listen_transcript(
        self,
        native_meeting_id: str,
        on_update: Callable[[str, str], Awaitable[None]],
        stop_event: asyncio.Event,
    ):
        ws_url = (
            self.base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://")
            + "/ws"
        )

        async with websockets.connect(
            ws_url, extra_headers={"X-API-Key": self.api_key}
        ) as ws:
            await ws.send(json.dumps({
                "action": "subscribe",
                "meetings": [{"platform": "google_meet", "native_id": native_meeting_id}],
            }))
            print(f"[WS] Subscribed to {native_meeting_id}")

            while not stop_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    data = json.loads(raw)

                    if data.get("type") == "transcript":
                        segments = data.get("confirmed", [])
                        if segments:
                            latest = segments[-1]
                            text = latest.get("text", "").strip()
                            speaker = latest.get("speaker", data.get("speaker", "unknown"))
                            if text:
                                await on_update(text, speaker)

                except asyncio.TimeoutError:
                    continue
                except websockets.ConnectionClosed as e:
                    print(f"[WS] Connection closed: {e}")
                    break
