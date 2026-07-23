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

    async def poll_bot_recording(self, bot_id: str, max_wait: int = 300) -> dict:
        """Poll GET /bot/{id}/ until the mixed-video recording is ready.

        Recall.ai stores recording artefacts in bot.media_shortcuts, keyed by the
        recording_config field names (video_mixed_mp4, audio_separate_mp3, transcript).
        The old code looked for bot.recording / bot.recordings which do not exist in
        the current Recall.ai API — that is why recordings were never being stored.

        Returns the full bot dict (so callers can pull any shortcut they need),
        or {} if the recording never becomes ready within max_wait seconds.
        """
        interval = 15
        elapsed  = 0
        while elapsed < max_wait:
            await asyncio.sleep(interval)
            elapsed += interval
            try:
                bot      = await self.get_bot(bot_id)
                shortcuts = bot.get("media_shortcuts") or {}

                # Check both possible key names — Recall.ai uses the same key as
                # the recording_config entry (video_mixed_mp4) but some regions/plans
                # may expose it as video_mixed. Check both to be safe.
                video_info = (
                    shortcuts.get("video_mixed_mp4")
                    or shortcuts.get("video_mixed")
                    or {}
                )
                status = video_info.get("status", "")
                print(f"[Recall] Recording status={status!r} (bot {bot_id})")

                if status == "done":
                    url = (video_info.get("data") or {}).get("download_url", "")
                    print(f"[Recall] Recording ready — url={'yes' if url else 'no'}")
                    return bot   # return full bot so caller can extract any artefact

            except Exception as e:
                print(f"[Recall] Recording poll error: {e}")

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
