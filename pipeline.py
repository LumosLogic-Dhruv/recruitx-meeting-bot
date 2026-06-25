import asyncio
import json
import re
import time
from typing import Callable, Awaitable
from openai import AsyncOpenAI
import httpx

# After the last Deepgram segment, wait this long before the AI responds.
# Deepgram endpointing=500ms already filters micro-pauses; 7s catches genuine
# thinking pauses without cutting the candidate off mid-sentence.
# Adaptive silence timeouts.
SILENCE_SHORT      = 1.0   # 1–5 words  — "hello", "yes", "my name is Dhruv"
SILENCE_MEDIUM     = 2.0   # 6–15 words — brief intro or one-liner
SILENCE_LONG       = 4.0   # 16–35 words
SILENCE_XLONG      = 8.0   # 35+ words  — long detailed answer
SILENCE_INCOMPLETE = 6.0   # sentence ends mid-thought ("and", "the", "so"…)
SILENCE_INTERRUPTED = 1.5  # candidate spoke over bot — respond fast

# Minimum words before the bot responds — prevents reacting to fragments.
MIN_WORDS_TO_RESPOND = 5

# Words that strongly indicate the speaker hasn't finished their sentence.
# If the accumulated text ends with one of these, use SILENCE_INCOMPLETE.
_TRAILING_WORDS = {
    # conjunctions / connectors
    'and', 'or', 'but', 'so', 'because', 'although', 'though', 'while',
    'which', 'that', 'who', 'whom', 'whose', 'where', 'when', 'how',
    # prepositions
    'the', 'a', 'an', 'in', 'on', 'at', 'for', 'by', 'with', 'from',
    'to', 'of', 'into', 'about', 'through', 'during', 'between', 'among',
    # filler / transition words people say mid-sentence
    'basically', 'like', 'just', 'also', 'then', 'now', 'as', 'well',
    'even', 'still', 'already', 'both', 'some', 'any', 'more', 'other',
    # pronouns / articles that always precede a noun
    'my', 'our', 'their', 'this', 'these', 'those', 'its',
    'i', "i'm", "i've", "i'll", "i'd", 'we', 'they', 'he', 'she',
    # verb helpers that need a following verb/noun
    'was', 'were', 'are', 'is', 'have', 'has', 'had', 'will', 'would',
    'can', 'could', 'should', 'not', 'it', 'be', 'been', 'being',
    # common speech disfluencies
    'uh', 'um', 'uhh', 'hmm', 'yeah', 'okay', 'ok', 'so',
}

# Backchannel ("I see", "Right") after this many words have arrived from the
# candidate since the last bot turn, and at most once every MIN_INTERVAL seconds.
BACKCHANNEL_WORD_THRESHOLD = 15
BACKCHANNEL_MIN_INTERVAL = 6.0
BACKCHANNELS = [
    "Mm-hmm.", "Right.", "Got it.", "Makes sense.", "Okay.",
    "Interesting.", "Sure, sure.", "Yeah, absolutely.", "Nice.",
    "I see.", "Fair enough.", "That makes sense.", "Oh, cool.",
]

# Sentence boundary — flush LLM stream to TTS on any of these.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+')

# Prepended to every system prompt regardless of what the user wrote.
# Acts as a hard guardrail so the AI cannot ignore these rules even if the
# generated prompt is script-like or overly long.
_RULES_PREFIX = """\
CORE RULES — ALWAYS FOLLOW THESE:
1. Ask EXACTLY ONE question per response. Never combine two questions in one turn.
2. Keep responses short and natural — usually 1 to 3 sentences. Never write a lecture or a list.
3. ONLY reference facts the candidate has explicitly stated in THIS conversation. \
Never invent or assume their background.
4. If the candidate's answer is unclear or very short, ask them to elaborate — \
do NOT make up what they meant or move on as if they answered fully.
5. React to what was JUST said. Do not follow a pre-written script or recite memorised lines.
6. Never start a response with the candidate's name followed by a fact you invented.
7. Sound human and conversational — use contractions (I'm, that's, you've), casual phrasing, \
and natural acknowledgments like "Oh nice," "That's interesting," "Got it, so..." \
before asking your next question. Vary how you start each response.

"""


class ConversationPipeline:
    def __init__(
        self,
        system_prompt: str,
        openai_key: str,
        openai_model: str = "gpt-4o-mini",
        elevenlabs_key: str = "",
        voice_id: str = "V9LCAAi4tTlqe9JadbCo",
    ):
        self._openai = AsyncOpenAI(api_key=openai_key)
        self._model = openai_model
        self._system_prompt = system_prompt
        self._history: list[dict] = [{"role": "system", "content": _RULES_PREFIX + system_prompt}]
        self._pending_text: str = ""
        self._pending_speaker: str = "Candidate"
        self._silence_task: asyncio.Task | None = None
        self._backchannel_task: asyncio.Task | None = None
        self._speaking: bool = False
        self._on_response: Callable[[str, bytes], Awaitable[None]] | None = None
        self._full_transcript: list[dict] = []

        self._elevenlabs_key = elevenlabs_key
        self._voice_id = voice_id
        self._http_client = httpx.AsyncClient(timeout=30.0) if elevenlabs_key else None

        # Backchannel state
        self._words_since_last_bot: int = 0
        self._last_backchannel_time: float = 0.0
        self._backchannel_idx: int = 0

        # Interruption state — set when candidate speaks while bot is talking.
        # Causes the TTS consumer to stop queuing more sentences after the
        # current one, and switches to a faster silence timeout.
        self._was_interrupted: bool = False

    # ── Public API ─────────────────────────────────────────────────────────────

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
        self._pending_text = (self._pending_text + " " + text).strip()
        self._pending_speaker = speaker

        if self._speaking:
            # Candidate spoke while bot was talking — flag an interruption so the
            # TTS consumer stops after the current sentence and we respond faster.
            self._was_interrupted = True
            print(f"[Pipeline] Interrupted — buffered: {text[:50]}")
            return

        # Count words for backchannel threshold
        self._words_since_last_bot += len(text.split())
        self._maybe_schedule_backchannel()
        self._reset_silence_timer()

    # ── Backchannel ────────────────────────────────────────────────────────────

    def _maybe_schedule_backchannel(self):
        now = time.monotonic()
        if (
            self._words_since_last_bot >= BACKCHANNEL_WORD_THRESHOLD
            and now - self._last_backchannel_time >= BACKCHANNEL_MIN_INTERVAL
        ):
            self._last_backchannel_time = now
            self._words_since_last_bot = 0
            if self._backchannel_task and not self._backchannel_task.done():
                self._backchannel_task.cancel()
            self._backchannel_task = asyncio.create_task(self._play_backchannel())

    async def _play_backchannel(self):
        bc = BACKCHANNELS[self._backchannel_idx % len(BACKCHANNELS)]
        self._backchannel_idx += 1
        try:
            audio = await self._tts(bc)
            if audio and self._on_response and not self._speaking:
                print(f"[Pipeline] Backchannel: {bc}")
                await self._on_response(bc, audio)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Pipeline] Backchannel error: {e}")

    # ── Silence timer ──────────────────────────────────────────────────────────

    def _reset_silence_timer(self):
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = asyncio.create_task(self._wait_for_silence())

    def _flush_pending(self):
        if self._pending_text:
            print(f"[Pipeline] Flushing buffered text after bot speech: {self._pending_text[:60]}")
            self._reset_silence_timer()

    def _is_incomplete(self, text: str) -> bool:
        """Return True if the text looks like the candidate is mid-sentence.
        Detects trailing conjunctions, prepositions, articles, and disfluencies."""
        words = text.strip().split()
        if not words:
            return False
        # Strip trailing punctuation except sentence-ending marks
        last = words[-1].lower().rstrip(',;:')
        # If last word is in trailing set → speaker almost certainly isn't done
        if last in _TRAILING_WORDS:
            return True
        # If last character is a comma (pause mid-list) → probably not done
        if text.rstrip().endswith(','):
            return True
        return False

    def _adaptive_timeout(self, text: str) -> float:
        """Pick silence timeout based on how much the candidate said.
        Short greetings → fast reply; incomplete sentences → wait much longer."""
        if self._was_interrupted:
            return SILENCE_INTERRUPTED
        # If text clearly ends mid-sentence, be very patient
        if self._is_incomplete(text):
            print(f"[Pipeline] Incomplete sentence detected — waiting {SILENCE_INCOMPLETE}s")
            return SILENCE_INCOMPLETE
        words = len(text.split())
        if words <= 5:
            return SILENCE_SHORT
        elif words <= 15:
            return SILENCE_MEDIUM
        elif words <= 35:
            return SILENCE_LONG
        else:
            return SILENCE_XLONG

    async def _wait_for_silence(self):
        timeout = self._adaptive_timeout(self._pending_text)
        print(f"[Pipeline] Silence timer: {timeout}s ({len(self._pending_text.split())} words so far)")
        await asyncio.sleep(timeout)
        text = self._pending_text.strip()
        speaker = self._pending_speaker
        self._pending_text = ""
        self._was_interrupted = False
        if not text:
            return
        if len(text.split()) < MIN_WORDS_TO_RESPOND:
            print(f"[Pipeline] Fragment too short ({len(text.split())} words): '{text}' — ignored")
            return
        await self._process_turn(text, speaker)

    # ── Core turn: streaming LLM → sentence-level TTS → Recall.ai ─────────────

    async def _process_turn(self, user_text: str, speaker: str = "Candidate"):
        self._speaking = True
        self._words_since_last_bot = 0
        self._was_interrupted = False  # fresh start for this turn

        # Cancel any pending backchannel before speaking
        if self._backchannel_task and not self._backchannel_task.done():
            self._backchannel_task.cancel()

        try:
            print(f"[Pipeline] Processing — {speaker}: {user_text[:100]}")
            self._full_transcript.append({"speaker": speaker, "text": user_text})
            self._history.append({"role": "user", "content": user_text})

            # Producer-consumer: LLM streams tokens → sentence queue → TTS → Recall
            queue: asyncio.Queue[str | None] = asyncio.Queue()
            full_text: list[str] = []

            async def llm_producer():
                buf = ""
                stream = await self._openai.chat.completions.create(
                    model=self._model,
                    messages=self._history,
                    temperature=0.85,
                    max_tokens=300,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    buf += delta
                    full_text.append(delta)
                    # Flush on every sentence boundary
                    while True:
                        m = _SENTENCE_END.search(buf)
                        if not m:
                            break
                        sentence = buf[:m.start() + 1].strip()
                        buf = buf[m.end():]
                        if sentence:
                            await queue.put(sentence)
                # Flush whatever is left (e.g. final sentence without trailing space)
                if buf.strip():
                    await queue.put(buf.strip())
                await queue.put(None)  # sentinel

            async def tts_consumer():
                while True:
                    sentence = await queue.get()
                    if sentence is None:
                        break
                    # Stop speaking if candidate interrupted between sentences.
                    # We can't cancel audio already sent to Recall.ai, but we can
                    # avoid queuing more sentences on top of the candidate.
                    if self._was_interrupted:
                        print(f"[Pipeline] Interrupt detected — stopping after current sentence")
                        # Drain the rest of the queue without playing
                        while sentence is not None:
                            sentence = await queue.get()
                        break
                    print(f"[Pipeline] TTS → Recall: {sentence[:70]}")
                    audio = await self._tts(sentence)
                    if audio and self._on_response:
                        await self._on_response(sentence, audio)

            await asyncio.gather(
                asyncio.create_task(llm_producer()),
                asyncio.create_task(tts_consumer()),
            )

            full_response = "".join(full_text)
            if full_response:
                self._history.append({"role": "assistant", "content": full_response})
                self._full_transcript.append({"speaker": "AI", "text": full_response})
                print(f"[Pipeline] AI complete: {full_response[:100]}")

        except Exception as e:
            print(f"[Pipeline] Error: {e}")
        finally:
            self._speaking = False
            self._flush_pending()

    # ── TTS: ElevenLabs turbo (low-latency) with OpenAI fallback ───────────────

    async def _tts(self, text: str) -> bytes:
        if self._elevenlabs_key:
            try:
                return await self._tts_elevenlabs(text)
            except Exception as e:
                print(f"[Pipeline] ElevenLabs error, falling back to OpenAI TTS: {e}")
        return await self._tts_openai(text)

    async def _tts_elevenlabs(self, text: str) -> bytes:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self._voice_id}"
        payload = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            "output_format": "mp3_44100_128",
        }
        client = self._http_client or httpx.AsyncClient(timeout=30.0)
        res = await client.post(
            url,
            headers={"xi-api-key": self._elevenlabs_key, "Content-Type": "application/json"},
            json=payload,
        )
        res.raise_for_status()
        return res.content

    async def _tts_openai(self, text: str) -> bytes:
        response = await self._openai.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=text,
            response_format="mp3",
        )
        return response.content

    # ── Transcript / Scorecard helpers ─────────────────────────────────────────

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
