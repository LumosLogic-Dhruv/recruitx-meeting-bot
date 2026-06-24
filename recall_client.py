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
                        # 1000ms: waits a full second of silence before firing a segment.
                        # Reduces mid-sentence fragmentation when candidate pauses to think.
                        "endpointing": 1000,
                    },
                }
            },
            # Full meeting recording (mixed audio + video as MP4).
            "video_mixed_mp4": {},
            # Separate MP3 audio track per participant (bot track + candidate track).
            "audio_separate_mp3": {},
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

    async def poll_bot_recording(self, bot_id: str, max_wait: int = 300) -> dict:
        """Poll GET /bot/{id}/ until recording is done. Returns the recording object."""
        interval = 15
        elapsed = 0
        while elapsed < max_wait:
            await asyncio.sleep(interval)
            elapsed += interval
            try:
                bot = await self.get_bot(bot_id)
                print(f"[Recall] Bot keys: {list(bot.keys())}")

                # Recall.ai may return 'recording' (object), 'recordings' (list), or both.
                candidates: list[dict] = []
                r = bot.get("recording")
                if isinstance(r, list):
                    candidates = r
                elif isinstance(r, dict):
                    candidates = [r]
                rs = bot.get("recordings")
                if isinstance(rs, list):
                    candidates += rs
                elif isinstance(rs, dict):
                    candidates.append(rs)

                print(f"[Recall] Recording candidates: {len(candidates)}")
                for rec in candidates:
                    status_code = (rec.get("status") or {}).get("code", "")
                    print(f"[Recall] Recording id={rec.get('id')} status={status_code}")
                    if status_code == "done":
                        print(f"[Recall] Recording done: id={rec.get('id')}")
                        return rec
            except Exception as e:
                print(f"[Recall] Recording poll error: {e}")
        print(f"[Recall] Recording not ready after {max_wait}s for bot {bot_id}")
        return {}

    async def get_separate_audio(self, recording_id: str, max_wait: int = 120) -> list:
        """Poll GET /audio_separate/?recording_id={id} until all tracks are done. Returns results list."""
        interval = 10
        elapsed = 0
        while elapsed < max_wait:
            try:
                async with httpx.AsyncClient() as client:
                    res = await client.get(
                        f"{self.base_url}/audio_separate/",
                        headers=self.headers,
                        params={"recording_id": recording_id},
                        timeout=15.0,
                    )
                    res.raise_for_status()
                    results = res.json().get("results", [])
                    if results and all(
                        (r.get("status") or {}).get("code") == "done" for r in results
                    ):
                        print(f"[Recall] Separate audio ready: {len(results)} track(s)")
                        return results
            except Exception as e:
                print(f"[Recall] Separate audio poll error: {e}")
            await asyncio.sleep(interval)
            elapsed += interval
        print(f"[Recall] Separate audio not ready after {max_wait}s for recording {recording_id}")
        return []
