import asyncio
import base64
import os
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
    ) -> dict:
        recording_config: dict = {
            # Include the AI bot's own audio track inside the mixed recording.
            # Without this, only the candidate's audio is captured.
            "include_bot_in_recording": {"audio": True},
            "transcript": {
                # Enable speaker diarization using separate streams when available.
                # This allows clean per-speaker transcript attribution in the recording.
                "diarization": {"use_separate_streams_when_available": True},
                "provider": {
                    "deepgram_streaming": {
                        "model": os.getenv("DEEPGRAM_MODEL", "nova-3"),
                        # "multi" = nova-3 multilingual mode: handles Indian English,
                        # Hindi, and Hinglish code-switching natively. Better than
                        # "en-IN" (single dialect lock) for mixed-language speakers.
                        "language": "multi",
                        # smart_format=true supersedes punctuate — handles punctuation,
                        # dates, currency, phones, URLs. Do NOT add punctuate=true.
                        "smart_format": True,
                        # 500ms: balanced between responsiveness and preventing false
                        # VAD fires on breath pauses. 300ms was too aggressive for
                        # Indian English with natural mid-sentence breath breaks.
                        "endpointing": 500,
                        # filler_words=false (default) — suppresses "uh", "um", "hmm"
                        # from Deepgram output so background noise filler doesn't reach
                        # the pipeline and trigger bot responses.
                        "filler_words": False,
                        # keyterms: biases nova-3 beam-search toward these tokens when
                        # acoustically plausible. No latency cost. Recall.ai passes
                        # unknown fields through to Deepgram as-is. Expanded for noisy
                        # environments where tech terms are most commonly garbled.
                        "keyterms": [
                            "MERN", "React", "Node.js", "Express", "MongoDB", "Next.js",
                            "TypeScript", "JavaScript", "Python", "Django", "FastAPI",
                            "Supabase", "Firebase", "PostgreSQL", "MySQL", "Redis",
                            "Docker", "Kubernetes", "AWS", "GCP", "Azure",
                            "white-label", "Gemini", "OpenAI", "LLM", "API",
                            "microservices", "REST", "GraphQL", "WebSocket",
                            "Flutter", "Swift", "Kotlin", "Spring Boot", "Kafka",
                            "Elasticsearch", "Terraform", "CI/CD", "Jenkins",
                            "GitHub", "GitLab", "Figma", "Tailwind", "Redux",
                        ],
                    },
                }
            },
            "video_mixed_mp4": {},
            "audio_separate_mp3": {},
        }
        if webhook_url:
            recording_config["realtime_endpoints"] = [
                {
                    "url": webhook_url,
                    "type": "webhook",
                    # transcript.data = finalized utterance (primary)
                    # transcript.partial_data = interim words while candidate is speaking
                    # participant.join / participant.leave come as top-level webhook events,
                    # NOT as realtime_endpoint events — they are NOT valid here.
                    "events": [
                        "transcript.data",
                        "transcript.partial_data",
                    ],
                }
            ]

        payload: dict = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
            "recording_config": recording_config,
            # Automatic leave settings — prevents hung sessions
            "automatic_leave": {
                # Fire bot.done if nobody joins within 5 minutes of bot entering
                "noone_joined_timeout": 300,
                # Fire bot.done 3 minutes after ALL participants leave (grace window for rejoin)
                "everyone_left_timeout": 180,
            },
            # Absolute ceiling — no session ever exceeds 60 minutes
            "max_duration_minutes": 60,
        }

        # Top-level webhook_url receives all bot lifecycle events:
        # bot.done, bot.fatal, bot.in_call_recording, participant.join, participant.leave, etc.
        # This is SEPARATE from realtime_endpoints which only handles transcript streaming.
        if webhook_url:
            payload["webhook_url"] = webhook_url

        # Signed-in Google Meet bot: set RECALL_GOOGLE_LOGIN_GROUP_ID to the
        # Login Group ID from Recall.ai → API Explorer → Google Logins → Groups.
        # When set, the bot signs in as the configured Google Workspace account
        # before joining — it is recognised as an invitee and skips the waiting room.
        google_login_group_id = os.getenv("RECALL_GOOGLE_LOGIN_GROUP_ID", "").strip()
        if google_login_group_id:
            payload["google_meet"] = {"google_login_group_id": google_login_group_id}
            print(f"[Recall] Using signed-in bot (login_group={google_login_group_id[:8]}...)")

        res = await self._client.post(
            f"{self.base_url}/bot/",
            json=payload,
            timeout=30.0,
        )
        if not res.is_success:
            print(f"[Recall] create_bot failed {res.status_code}: {res.text}")
            res.raise_for_status()
        print(
            f"[Recall] Bot created — Deepgram endpointing=500ms, nova-3 multi, "
            f"keyterms active (endpoint: {webhook_url or 'none'})"
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

    async def get_recording_by_id(self, recording_id: str) -> dict:
        """Fetch a single recording object from GET /recording/{id}/.
        Returns the full recording dict or {} on failure."""
        try:
            res = await self._client.get(
                f"{self.base_url}/recording/{recording_id}/",
                timeout=15.0,
            )
            if res.status_code == 404:
                return {}
            res.raise_for_status()
            return res.json()
        except Exception as e:
            print(f"[Recall] get_recording_by_id error for {recording_id}: {e}")
            return {}

    async def list_recordings_for_bot(self, bot_id: str) -> list:
        """Fetch all recordings for a bot from GET /recording/?bot_id={id}.
        Returns a list of recording objects or [] on failure."""
        try:
            res = await self._client.get(
                f"{self.base_url}/recording/",
                params={"bot_id": bot_id},
                timeout=15.0,
            )
            if not res.is_success:
                print(f"[Recall] list_recordings_for_bot {res.status_code}: {res.text[:200]}")
                return []
            data = res.json()
            # Handles both paginated {"results": [...]} and plain list responses
            if isinstance(data, list):
                return data
            return data.get("results", [])
        except Exception as e:
            print(f"[Recall] list_recordings_for_bot error for bot {bot_id}: {e}")
            return []

    def _extract_url_from_recording(self, recording: dict) -> str:
        """Extract the video download URL from a /recording/ API object.
        Handles both the media_shortcuts format and the media array format."""
        if not recording:
            return ""

        # Format 1: media_shortcuts (mirrors bot.media_shortcuts)
        shortcuts = recording.get("media_shortcuts") or {}
        video_info = (
            shortcuts.get("video_mixed_mp4")
            or shortcuts.get("video_mixed")
            or {}
        )
        url = (video_info.get("data") or {}).get("download_url", "")
        if url:
            return url

        # Format 2: media array [{key, status, data: {download_url}}]
        for item in recording.get("media", []) or []:
            if not isinstance(item, dict):
                continue
            key = item.get("key", "")
            if key in ("video_mixed_mp4", "video_mixed"):
                status_obj = item.get("status") or {}
                status_code = (
                    status_obj.get("code") if isinstance(status_obj, dict)
                    else status_obj
                )
                if status_code == "done":
                    url = (item.get("data") or {}).get("download_url", "")
                    if url:
                        return url

        # Format 3: direct download_url on the recording object
        return recording.get("download_url", "") or recording.get("video_url", "")

    async def fetch_recording_by_bot(self, bot_id: str) -> str:
        """
        Try the /recording/ API first to get the video URL for a bot.
        Returns the download URL string or "" if not ready/found.
        """
        recordings = await self.list_recordings_for_bot(bot_id)
        for rec in recordings:
            # Accept any recording whose status is done
            status_obj = rec.get("status") or {}
            code = (
                status_obj.get("code") if isinstance(status_obj, dict)
                else status_obj
            )
            if code == "done":
                url = self._extract_url_from_recording(rec)
                if url:
                    print(f"[Recall] Got recording URL via /recording/ API for bot {bot_id}")
                    return url
        return ""

    async def poll_bot_recording(self, bot_id: str, max_wait: int = 300) -> dict:
        """Poll for a bot's video recording using two strategies in parallel:
        1. GET /recording/?bot_id={id}  — the dedicated recording endpoint (primary)
        2. GET /bot/{id}/               — bot media_shortcuts (fallback)

        Returns the full bot dict (enriched with recording_url) once the video
        is ready, or {} if the recording never becomes available within max_wait.
        """
        interval = 15
        elapsed  = 0
        while elapsed < max_wait:
            await asyncio.sleep(interval)
            elapsed += interval
            try:
                # ── Strategy 1: dedicated /recording/ API ──────────────────────
                rec_url = await self.fetch_recording_by_bot(bot_id)
                if rec_url:
                    # Attach the URL directly on a synthetic bot dict so callers
                    # can use extract_recording_urls without modification.
                    bot = await self.get_bot(bot_id)
                    if "media_shortcuts" not in bot:
                        bot["media_shortcuts"] = {}
                    bot["media_shortcuts"].setdefault("video_mixed_mp4", {})
                    bot["media_shortcuts"]["video_mixed_mp4"]["status"] = "done"
                    bot["media_shortcuts"]["video_mixed_mp4"]["data"] = {
                        "download_url": rec_url
                    }
                    print(f"[Recall] Recording ready via /recording/ API (bot {bot_id})")
                    return bot

                # ── Strategy 2: bot.media_shortcuts ───────────────────────────
                bot = await self.get_bot(bot_id)
                shortcuts = bot.get("media_shortcuts") or {}

                video_info = (
                    shortcuts.get("video_mixed_mp4")
                    or shortcuts.get("video_mixed")
                    or {}
                )
                # Recall.ai status: "processing" → "done" (also accept "complete"/"available")
                raw_status = video_info.get("status", "")
                status = raw_status.lower() if raw_status else ""
                print(
                    f"[Recall] Recording poll elapsed={elapsed}s "
                    f"media_shortcuts_status={raw_status!r} (bot {bot_id})"
                )

                if status in ("done", "complete", "available"):
                    url = (video_info.get("data") or {}).get("download_url", "")
                    print(
                        f"[Recall] Recording ready via media_shortcuts "
                        f"url={'yes' if url else 'NO — missing download_url'}"
                    )
                    return bot

                # Log full shortcuts keys to help diagnose key-name mismatches
                if shortcuts:
                    print(f"[Recall] media_shortcuts keys: {list(shortcuts.keys())}")

            except Exception as e:
                print(f"[Recall] Recording poll error at elapsed={elapsed}s: {e}")

        print(f"[Recall] Recording not ready after {max_wait}s for bot {bot_id}")
        return {}

    def extract_recording_urls(self, bot: dict) -> dict:
        """Pull all recording artefact URLs out of a bot dict returned by poll_bot_recording.
        Returns a dict with keys: recording_url, bot_audio_url, candidate_audio_url.
        All values default to None if the artefact is missing or not yet ready."""
        shortcuts = bot.get("media_shortcuts") or {}

        # ── Mixed video ────────────────────────────────────────────────────────
        video_info = (
            shortcuts.get("video_mixed_mp4")
            or shortcuts.get("video_mixed")
            or {}
        )
        recording_url = (video_info.get("data") or {}).get("download_url")

        # ── Separate audio tracks ──────────────────────────────────────────────
        # Recall.ai returns audio_separate_mp3 as a LIST of per-participant objects.
        audio_tracks = (
            shortcuts.get("audio_separate_mp3")
            or shortcuts.get("audio_separate")
            or []
        )
        if isinstance(audio_tracks, dict):
            # Some API versions return a dict keyed by participant_id
            audio_tracks = list(audio_tracks.values())

        bot_audio_url       = None
        candidate_audio_url = None
        for track in audio_tracks:
            url         = (track.get("data") or {}).get("download_url")
            participant = track.get("participant") or {}
            if not url:
                continue
            # Recall.ai bots join as non-hosts; the candidate is typically the host.
            if participant.get("is_host"):
                candidate_audio_url = url
            else:
                bot_audio_url = url

        return {
            "recording_url":       recording_url,
            "bot_audio_url":       bot_audio_url,
            "candidate_audio_url": candidate_audio_url,
        }
