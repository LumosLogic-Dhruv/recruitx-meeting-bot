import asyncio
import base64
import httpx


class RecallClient:
    def __init__(self, api_key: str, base_url: str):
        self.base_url = base_url.rstrip("/")
        # Headers stored on the client so every request inherits them automatically.
        # One persistent AsyncClient per session — eliminates the per-call TLS
        # handshake that was costing 80-150ms on every speak() call.
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    async def aclose(self):
        """Release the connection pool. Call when the interview session ends."""
        await self._client.aclose()

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
                        "model": "nova-2",
                        "language": "en-IN",
                        "smart_format": True,
                        "punctuate": True,
                        # Reduced from 1000ms → 500ms.
                        # Fires transcript segments 500ms sooner on every candidate turn.
                        # Combined with the tighter silence timers in pipeline.py, this
                        # cuts the STT-to-response floor latency by ~500ms per turn.
                        "endpointing": 500,
                    },
                }
            },
            "video_mixed_mp4": {},
            "audio_separate_mp3": {},
        }
        if webhook_url:
            recording_config["realtime_endpoints"] = [
                {"url": webhook_url, "type": "webhook", "events": ["transcript.data"]}
            ]

        payload: dict = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
            "recording_config": recording_config,
        }

        res = await self._client.post(
            f"{self.base_url}/bot/",
            json=payload,
            timeout=30.0,
        )
        if not res.is_success:
            print(f"[Recall] create_bot failed {res.status_code}: {res.text}")
            res.raise_for_status()
        print(
            f"[Recall] Bot created — Deepgram endpointing=500ms "
            f"(endpoint: {webhook_url or 'none'})"
        )
        return res.json()

    async def get_bot(self, bot_id: str) -> dict:
        res = await self._client.get(
            f"{self.base_url}/bot/{bot_id}/",
            timeout=15.0,
        )
        res.raise_for_status()
        return res.json()

    async def get_transcript(self, bot_id: str) -> list:
        res = await self._client.get(
            f"{self.base_url}/bot/{bot_id}/transcript/",
            timeout=15.0,
        )
        res.raise_for_status()
        return res.json()

    async def speak(self, bot_id: str, audio_bytes: bytes):
        b64 = base64.b64encode(audio_bytes).decode()
        res = await self._client.post(
            f"{self.base_url}/bot/{bot_id}/output_audio/",
            json={"kind": "mp3", "b64_data": b64},
            timeout=30.0,
        )
        if not res.is_success:
            print(f"[Recall] Speak error {res.status_code}: {res.text}")
        else:
            print(f"[Recall] Speak accepted: {res.status_code} | bytes={len(audio_bytes)}")
        res.raise_for_status()

    async def stop_bot(self, bot_id: str):
        res = await self._client.post(
            f"{self.base_url}/bot/{bot_id}/leave_call/",
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
        """Poll until all separate audio tracks are done. Returns results list."""
        interval = 10
        elapsed = 0
        while elapsed < max_wait:
            try:
                res = await self._client.get(
                    f"{self.base_url}/audio_separate/",
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
        print(
            f"[Recall] Separate audio not ready after {max_wait}s "
            f"for recording {recording_id}"
        )
        return []
