import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Awaitable
from openai import AsyncOpenAI
import httpx
from speech_guard import speech_guard
from prompt_builder import MASTER_BEHAVIOR_LAYER
import scorecard as _scorecard_module
from config import (
    SILENCE_SHORT, SILENCE_MEDIUM, SILENCE_LONG, SILENCE_XLONG,
    SILENCE_INCOMPLETE, SILENCE_INTERRUPTED,
    MIN_WORDS_FOR_SHORT_SILENCE, THINKING_PAUSE, FLUSH_PENDING_DELAY,
    MIN_WORDS_TO_RESPOND, WAKEUP_MIN_WORDS, WAKEUP_AFTER_SILENCE,
    MAX_HISTORY_MESSAGES, COMPRESS_AT_MESSAGES, CONFUSION_PIVOT_THRESHOLD,
)

# Only words that GENUINELY mean the sentence is unfinished in mid-utterance.
# Removed: 'basically', 'okay', 'ok', 'yeah', 'like', 'just', 'also', 'then',
# 'now', 'well', 'even', 'still', 'already', 'both', 'some', 'any', 'more',
# 'other', 'as' — Indian English speakers commonly END sentences with these words.
# Keeping them caused 4.0s silence on almost every normal response.
_TRAILING_WORDS = {
    'and', 'or', 'but', 'so', 'because', 'although', 'though', 'while',
    'which', 'that', 'who', 'whom', 'whose', 'where', 'when', 'how',
    'the', 'a', 'an', 'in', 'on', 'at', 'for', 'by', 'with', 'from',
    'to', 'of', 'into', 'about', 'through', 'during', 'between', 'among',
    'my', 'our', 'their', 'this', 'these', 'those', 'its',
    'i', "i'm", "i've", "i'll", "i'd", 'we', 'they', 'he', 'she',
    'was', 'were', 'are', 'is', 'have', 'has', 'had', 'will', 'would',
    'can', 'could', 'should', 'not', 'it', 'be', 'been', 'being',
    'uh', 'um', 'uhh', 'hmm',
}

# Sounds that background noise / breathing commonly gets transcribed as by Deepgram.
# Segments made ENTIRELY of these are dropped before reaching the LLM so they
# never trigger a bot response or inflate the transcript word count.
_NOISE_WORDS = frozenset({
    'uh', 'um', 'uhh', 'umm', 'hmm', 'hm', 'mm', 'mmm', 'mhm',
    'ah', 'eh', 'oh', 'er', 'err', 'ugh', 'uh-huh',
})

# Used by _norm_dedup_key to strip punctuation for the text fallback path.
_DEDUP_NORM_RE = re.compile(r'[^a-z0-9\s]')

CONFUSION_FALLBACKS = [
    "Let's move to a different area. Tell me about another project you've worked on recently.",
    "Let me ask you something different — what's your experience with system design?",
    "Let's shift focus — tell me about a technical challenge you've solved recently.",
    "Let me ask you about something else — how do you approach debugging a production issue?",
]

# Fixed: (?:\s+|$) ensures the last sentence in the LLM stream flushes immediately
# even when there is no trailing whitespace — previously it sat in the buffer until
# the stream ended, delaying TTS on the final sentence.
_SENTENCE_END = re.compile(r'(?<=[.!?])(?:\s+|$)')

# Detects when a candidate makes an enumeration promise before finishing the list
# e.g. "I worked on three projects" → still listing, apply SILENCE_XLONG.
_ENUM_PROMISE = re.compile(
    r'\b(?:two|three|four|five|a\s+few|a\s+couple\s+of?|2|3|4|5)\s+'
    r'(?:projects?|things?|points?|aspects?|areas?|skills?|tools?|languages?'
    r'|frameworks?|apps?|products?|experiences?|examples?|main|key)',
    re.IGNORECASE,
)


# ── Interview State Engine ─────────────────────────────────────────────────────

@dataclass
class InterviewState:
    """Tracks phase, topic coverage, and corrections for active sessions."""
    current_phase: str = "greeting"    # greeting → technical → wrap_up
    current_topic: str = ""
    topics_covered: list = field(default_factory=list)
    topics_remaining: list = field(default_factory=list)
    confirmed_corrections: dict = field(default_factory=dict)  # garbled → correct term
    questions_asked: int = 0
    consecutive_confusion_count: int = 0
    start_time: float = field(default_factory=time.monotonic)

    def elapsed_minutes(self) -> float:
        return (time.monotonic() - self.start_time) / 60


# ── ConversationPipeline ───────────────────────────────────────────────────────

class ConversationPipeline:
    def __init__(
        self,
        system_prompt: str,
        openai_key: str,
        openai_model: str | None = None,
        elevenlabs_key: str = "",
        voice_id: str = "V9LCAAi4tTlqe9JadbCo",
    ):
        self._openai = AsyncOpenAI(api_key=openai_key)
        self._model = openai_model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self._eval_model = os.getenv("OPENAI_EVAL_MODEL", "gpt-4o")
        self._scorecard_model = os.getenv("OPENAI_SCORECARD_MODEL", "gpt-4o")
        self._system_prompt = system_prompt
        self._history: list[dict] = [{"role": "system", "content": MASTER_BEHAVIOR_LAYER + system_prompt}]
        self._pending_text: str = ""
        self._pending_speaker: str = "Candidate"
        self._silence_task: asyncio.Task | None = None
        self._backchannel_task: asyncio.Task | None = None
        self._speaking: bool = False
        self._on_response: Callable[[str, bytes], Awaitable[None]] | None = None
        self._full_transcript: list[dict] = []
        self._current_turn_id: int = 0
        self._bot_id: str = ""
        self._speech_id: int = 0

        self._elevenlabs_key = elevenlabs_key
        self._voice_id = voice_id
        self._http_client = httpx.AsyncClient(timeout=30.0) if elevenlabs_key else None

        # Backchannel state
        self._words_since_last_bot: int = 0
        self._last_backchannel_time: float = 0.0
        self._backchannel_idx: int = 0

        # Interruption state
        self._was_interrupted: bool = False

        # Candidate presence — paused when candidate is absent from the call.
        # While paused, silence timers are suppressed so we never speak to an empty room.
        self._paused: bool = False

        # Confusion loop prevention
        self._confusion_fallback_idx: int = 0

        # Activity tracking for BUG_03 keepalive — last time bot OR candidate spoke
        self._last_activity_at: float = time.monotonic()
        self._keepalive_task: asyncio.Task | None = None

        # Noisy-background support: noise event counter for scorecard notice
        self._noise_segments_filtered: int = 0

        # Interview state engine
        self._state = InterviewState()
        self._topics_initialized: bool = False

        # Session end callback — called when pipeline detects interview is complete
        # (bot said goodbye). Wired up by main.py to trigger auto-end + scorecard.
        self._session_end_callback: Callable[[], Awaitable[None]] | None = None
        self._session_end_triggered: bool = False  # prevents double-trigger

        # Inline topic counter — advances topics_remaining after 3 turns per topic
        self._topic_turn_count: int = 0
        # Inline question dedup — prevents the LLM repeating a question it already asked
        self._asked_questions: set = set()

    # ── Public API ─────────────────────────────────────────────────────────────

    def set_response_callback(self, callback: Callable[[str, bytes], Awaitable[None]]):
        self._on_response = callback

    def set_bot_id(self, bot_id: str):
        """Associate this pipeline with a Recall.ai bot_id for speech guard tracking."""
        self._bot_id = bot_id

    def set_session_end_callback(self, callback: Callable[[], Awaitable[None]]):
        """Wire up a callback that fires when the bot says goodbye.
        main.py uses this to auto-end the Recall.ai session and generate the scorecard."""
        self._session_end_callback = callback

    def pause(self):
        """Suspend all AI responses — call when candidate leaves the meeting."""
        self._paused = True
        # Cancel any pending silence timer so we don't speak to an empty room.
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
            self._silence_task = None
        if self._backchannel_task and not self._backchannel_task.done():
            self._backchannel_task.cancel()
            self._backchannel_task = None
        print("[Pipeline] PAUSED — candidate absent")

    def resume(self):
        """Resume AI responses — call when candidate rejoins the meeting."""
        self._paused = False
        print("[Pipeline] RESUMED — candidate present")

    def is_turn_valid(self, turn_id: int) -> bool:
        """Returns True if the specified turn is still active, uninterrupted, unpaused, and owns speech."""
        if self._bot_id and not speech_guard.is_speech_valid(self._bot_id, self._speech_id):
            return False
        return (not self._was_interrupted) and (not self._paused) and (self._current_turn_id == turn_id)

    async def send_greeting(self, bot_name: str, candidate_name: str = "") -> bytes:
        if self._bot_id:
            # claim_greeting is handled by the caller (_webhook_greeting / _poll_and_greet).
            # Calling it again here causes a double-claim: the second call always returns False,
            # making send_greeting return b"" even when the caller legitimately owns the greeting.
            speech_id = speech_guard.start_speech(self._bot_id, "greeting")
            if not speech_id:
                print("[Pipeline] Speech ownership denied for greeting — returning empty bytes")
                return b""
            self._speech_id = speech_id

        self._current_turn_id += 1
        turn_id = self._current_turn_id
        self._speaking = True
        self._was_interrupted = False
        # Extract interview topics from the system prompt in the background.
        # This runs concurrently with TTS synthesis — zero latency cost.
        # By the time the candidate finishes their intro (~30-60s), topics are ready.
        asyncio.create_task(self._ensure_topics_initialized())
        try:
            name_part = f", {candidate_name.split()[0]}" if candidate_name.strip() else ""
            greeting = (
                f"Hello{name_part}, thank you for joining. I'm {bot_name}. "
                "Please start by telling me a little about yourself and your recent work experience."
            )
            audio = await self._tts(greeting)
            if not self.is_turn_valid(turn_id):
                print("[Pipeline] Greeting interrupted/invalidated — returning empty bytes")
                return b""
            self._history.append({"role": "assistant", "content": greeting})
            self._full_transcript.append({"speaker": "AI", "text": greeting})
            self._last_activity_at = time.monotonic()
            print(f"[Pipeline] Greeting sent.")
            return audio
        finally:
            self._speaking = False
            self._flush_pending()
            # Schedule keepalive so that if transcript.data webhooks never arrive after
            # the greeting (e.g. Recall.ai realtime_endpoints not reachable), the bot
            # will nudge the candidate after WAKEUP_AFTER_SILENCE seconds instead of
            # staying silent permanently. _process_turn reschedules this after every turn.
            if self._keepalive_task and not self._keepalive_task.done():
                self._keepalive_task.cancel()
            self._keepalive_task = asyncio.create_task(self._keepalive_check())

    def on_transcript_update(self, text: str, speaker: str = "Candidate"):
        """Called on finalized transcript segments (transcript.data events)."""
        self._last_activity_at = time.monotonic()

        # Drop pure-noise segments (filler sounds / background noise bursts) before
        # they reach the LLM or trigger a bot response.
        if self._is_noise_only(text):
            self._noise_segments_filtered += 1
            print(f"[Pipeline] Noise segment #{self._noise_segments_filtered} filtered: '{text[:40]}'")
            return

        self._pending_text = (self._pending_text + " " + text).strip()
        self._pending_speaker = speaker

        if self._speaking:
            self._was_interrupted = True
            if self._bot_id:
                speech_guard.interrupt_speech(self._bot_id)
            print(f"[Pipeline] Interrupted — buffered: {text[:50]}")
            return

        self._words_since_last_bot += len(text.split())
        self._reset_silence_timer()

    def on_partial_transcript(self, speaker: str = "Candidate", text: str = ""):
        """Called on interim transcript segments (transcript.partial_data events).
        Two purposes: cancel bot speech if candidate interrupts; reset silence timer
        so the AI waits for the candidate to finish before responding."""
        if self._speaking:
            self._was_interrupted = True
            if self._bot_id:
                speech_guard.interrupt_speech(self._bot_id)
            return

        if self._pending_text:
            self._reset_silence_timer()

    # ── Backchannel (DISABLED) ─────────────────────────────────────────────────
    # Backchannels ("I see", "Got it", etc.) are disabled because ElevenLabs TTS
    # latency (~150ms) means the audio always arrives AFTER the candidate has paused,
    # not during their speech. This caused two recall.speak() calls to queue in Recall.ai
    # back-to-back: the backchannel then the main response, producing a dual-voice/dual-
    # tone effect. The raised silence thresholds already make the bot feel natural without
    # these listening cues.

    def _maybe_schedule_backchannel(self):
        pass  # disabled — see comment above

    async def _play_backchannel(self):
        pass  # disabled — see comment above

    # ── Silence timer ──────────────────────────────────────────────────────────

    def _reset_silence_timer(self):
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = asyncio.create_task(self._wait_for_silence())

    def _flush_pending(self):
        if not self._pending_text:
            return
        word_count = len(self._pending_text.split())
        # Text accumulated DURING bot speech (interruption) is often reflexive noise —
        # "hmm", "okay sure", "yeah" — too short to be a real answer. Require 8 words
        # minimum to avoid rapid double-responses.
        if self._was_interrupted and word_count < 8:
            print(
                f"[Pipeline] Post-speech buffer too short ({word_count} words) — discarding"
            )
            self._pending_text = ""
            self._was_interrupted = False
            asyncio.create_task(self._reprompt_if_silent(delay=5.0))
            return
        print(f"[Pipeline] Flushing buffered text after bot speech: {self._pending_text[:60]}")
        self._was_interrupted = False
        # Delay before restarting the silence timer — gives the candidate time to finish
        # their complete thought rather than firing immediately on the buffered fragment.
        # This prevents the double-response where bot asks Q2 then immediately asks Q3
        # from the second half of the answer that arrived while Q2 was playing.
        asyncio.create_task(self._delayed_flush(FLUSH_PENDING_DELAY))

    async def _delayed_flush(self, delay: float):
        """Wait `delay` seconds, then restart the silence timer if there's still pending text.
        Called from _flush_pending() to give the candidate time to finish speaking
        before the pipeline fires on buffered fragments from mid-bot-speech transcripts."""
        await asyncio.sleep(delay)
        if self._pending_text and not self._speaking and not self._paused:
            print(f"[Pipeline] Delayed flush: restarting silence timer with {len(self._pending_text.split())} words")
            self._reset_silence_timer()

    async def _reprompt_if_silent(self, delay: float):
        """After discarding a short post-speech fragment, wait `delay` seconds.
        If the candidate still hasn't spoken and the bot hasn't spoken, emit a
        gentle nudge so the interview doesn't freeze in dead silence."""
        await asyncio.sleep(delay)
        if self._paused:
            return
        if not self._speaking and not self._pending_text and not self._silence_task:
            print("[Pipeline] Dead silence after discarded fragment — emitting re-prompt")
            self._current_turn_id += 1
            turn_id = self._current_turn_id
            self._speaking = True
            self._was_interrupted = False
            try:
                nudge = "Please go ahead."
                audio = await self._tts(nudge)
                if audio and self._on_response and self.is_turn_valid(turn_id):
                    await self._on_response(nudge, audio)
            finally:
                self._speaking = False

    async def _keepalive_check(self):
        """BUG_03 fix: if bot and candidate are both silent for WAKEUP_AFTER_SILENCE
        seconds after any turn, send a gentle nudge. Prevents permanent freeze caused
        by a stuck _speaking flag or missed transcript events."""
        await asyncio.sleep(WAKEUP_AFTER_SILENCE)
        if self._paused or self._speaking or self._pending_text or self._silence_task:
            return
        elapsed = time.monotonic() - self._last_activity_at
        if elapsed < WAKEUP_AFTER_SILENCE - 2:
            return  # activity happened after we started sleeping — no nudge needed
        print(f"[Pipeline] Keepalive: {elapsed:.0f}s of silence — sending nudge")
        self._current_turn_id += 1
        turn_id = self._current_turn_id
        self._speaking = True
        self._was_interrupted = False
        nudge = "Are you still there? Please go ahead whenever you're ready."
        try:
            audio = await self._tts(nudge)
            if audio and self._on_response and self.is_turn_valid(turn_id):
                await self._on_response(nudge, audio)
                self._last_activity_at = time.monotonic()
        except Exception as e:
            print(f"[Pipeline] Keepalive error (non-fatal): {e}")
        finally:
            self._speaking = False

    def _is_incomplete(self, text: str) -> bool:
        words = text.strip().split()
        if not words:
            return False
        last = words[-1].lower().rstrip(',;:')
        if last in _TRAILING_WORDS:
            return True
        if text.rstrip().endswith(','):
            return True
        return False

    def _adaptive_timeout(self, text: str) -> float:
        if self._was_interrupted:
            return SILENCE_INTERRUPTED
        # Enumeration promise check BEFORE _is_incomplete — needs the longer XLONG window,
        # not just the incomplete timer, because listing multiple items has longer pauses.
        if _ENUM_PROMISE.search(text):
            print(f"[Pipeline] Enumeration in progress — waiting {SILENCE_XLONG}s")
            return SILENCE_XLONG
        if self._is_incomplete(text):
            print(f"[Pipeline] Incomplete sentence detected — waiting {SILENCE_INCOMPLETE}s")
            return SILENCE_INCOMPLETE
        words = len(text.split())
        ends_complete = text.rstrip()[-1:] in '.!?' if text.strip() else False
        extra = 0.0 if ends_complete else 0.4
        if words <= 5:
            # Very short fragments — if below word threshold, bump up to MEDIUM
            # so we don't fire on breathing pauses or sentence-starters.
            if words < MIN_WORDS_FOR_SHORT_SILENCE:
                print(f"[Pipeline] Fragment too short for SILENCE_SHORT ({words} words) — using MEDIUM")
                return SILENCE_MEDIUM + extra
            return SILENCE_SHORT + extra
        elif words <= 15:
            return SILENCE_MEDIUM + extra
        elif words <= 35:
            return SILENCE_LONG
        else:
            return SILENCE_XLONG

    def _detect_correction(self, text: str) -> tuple[str, str] | None:
        """Returns (old_garbled_term, corrected_term) if the candidate corrects a mishearing."""
        # "it's not X, it's Y" → old=group1, new=group2
        m = re.search(r"(?:it'?s not|not)\s+(.+?)[,.]?\s+it'?s\s+(.+)", text, re.IGNORECASE)
        if m:
            return (m.group(1).strip(), m.group(2).strip())
        # "I mean Y not X" / "I said Y not X" → old=group2, new=group1
        m = re.search(r"(?:I mean|I said)\s+(.+?)[,.]?\s+not\s+(.+)", text, re.IGNORECASE)
        if m:
            return (m.group(2).strip(), m.group(1).strip())
        return None

    def _is_clarification_response(self, text: str) -> bool:
        patterns = [
            "tell me a bit more", "could you clarify", "can you clarify",
            "can you elaborate", "could you elaborate",
            "what do you mean", "sorry, could you",
            "i didn't quite catch", "i didn't catch",
        ]
        return any(p in text.lower() for p in patterns)

    def _is_noise_only(self, text: str) -> bool:
        """Return True when a Deepgram segment is almost certainly background noise.
        Filters: all-filler-sound segments, single-character tokens, empty text."""
        words = text.lower().split()
        if not words:
            return True
        stripped = [w.strip('.,!?-–—') for w in words]
        # Entirely filler / noise sounds (uh, um, hmm, etc.)
        if all(w in _NOISE_WORDS or w == '' for w in stripped):
            return True
        # Single token of 1 character (static clicks, keyboard taps)
        if len(stripped) == 1 and len(stripped[0]) <= 1:
            return True
        return False

    def _compute_thinking_pause(self, user_text: str) -> float:
        """Adaptive thinking pause — scales with answer length to mirror how a human
        interviewer naturally absorbs a response before speaking.
        Pure helper: no network calls, no state mutations, no side effects.
        Falls back to THINKING_PAUSE on any error so the interview is never affected."""
        try:
            words = len(user_text.split())
            if words <= 3:
                pause = 0.35
            elif words <= 12:
                pause = 0.50
            elif words <= 35:
                pause = 0.70
            elif words <= 80:
                pause = 0.75
            else:
                pause = 0.85
            return max(0.30, min(1.20, pause))
        except Exception:
            return THINKING_PAUSE

    async def _wait_for_silence(self):
        timeout = self._adaptive_timeout(self._pending_text)
        print(f"[Pipeline] Silence timer: {timeout}s ({len(self._pending_text.split())} words so far)")
        await asyncio.sleep(timeout)
        if self._paused:
            print("[Pipeline] Silence timer fired but pipeline is paused — suppressing response")
            return
        text = self._pending_text.strip()
        speaker = self._pending_speaker
        self._pending_text = ""
        self._was_interrupted = False
        if not text:
            return

        # Wake-up mode: after WAKEUP_AFTER_SILENCE seconds of bot silence, respond even
        # to single-word utterances like "Hello?" so the bot never stays unresponsive.
        silent_for = time.monotonic() - self._last_activity_at
        min_words = WAKEUP_MIN_WORDS if silent_for >= WAKEUP_AFTER_SILENCE else MIN_WORDS_TO_RESPOND
        if len(text.split()) < min_words:
            print(f"[Pipeline] Fragment too short ({len(text.split())} words, min={min_words}): '{text}' — ignored")
            return
        await self._process_turn(text, speaker)

    # ── Interview State Engine ─────────────────────────────────────────────────

    async def _ensure_topics_initialized(self):
        """Parse interview topics from the system prompt once at greeting time.
        Fires as a background task so it never blocks the greeting TTS."""
        if self._topics_initialized:
            return
        self._topics_initialized = True
        try:
            resp = await self._openai.chat.completions.create(
                model=self._eval_model,
                messages=[{
                    "role": "user",
                    "content": (
                        "From this interviewer system prompt, list the main topics that "
                        "should be covered during the interview. "
                        "Return ONLY a JSON array of 3-6 short topic names (2-4 words each). "
                        'Example: ["Python experience", "system design", "past projects"]\n\n'
                        f"{self._system_prompt[:1500]}"
                    ),
                }],
                max_tokens=100,
                temperature=0.1,
            )
            raw = (resp.choices[0].message.content or "[]").strip()
            raw = _strip_code_fence(raw)
            topics = json.loads(raw)
            if isinstance(topics, list) and topics:
                self._state.topics_remaining = [str(t) for t in topics[:6]]
                print(f"[State] Topics extracted: {self._state.topics_remaining}")
        except Exception as e:
            print(f"[State] Topic extraction failed (non-fatal): {e}")

    def _build_state_context(self) -> str:
        """4-line state block injected per-turn into the system message. Never stored in history."""
        s = self._state
        lines = [
            f"\n[INTERVIEW STATE — phase={s.current_phase} | turn={s.questions_asked} | {s.elapsed_minutes():.0f}min elapsed]",
        ]
        if s.confirmed_corrections:
            lines.append(
                "Use these corrected terms only, never the original: "
                + ", ".join(f"'{o}' → '{n}'" for o, n in s.confirmed_corrections.items())
            )
        if s.consecutive_confusion_count >= CONFUSION_PIVOT_THRESHOLD:
            next_topic = s.topics_remaining[0] if s.topics_remaining else "a behavioral question"
            lines.append(f"FORCE TOPIC CHANGE NOW — move immediately to: {next_topic}")
        if s.topics_covered:
            lines.append(f"Topics covered: {', '.join(s.topics_covered[-4:])}")
        if s.topics_remaining:
            lines.append(f"Topics remaining: {', '.join(s.topics_remaining[:4])}")
        if s.current_phase == "wrap_up":
            lines.append("WRAP-UP — deliver the closing sequence now. No more questions.")
        lines.append("")
        return "\n".join(lines)

    # ── Context window management ──────────────────────────────────────────────

    async def _maybe_compress_history(self):
        """When conversation history exceeds the rolling window, summarize the
        oldest messages and fold the summary into the system message.
        Prevents unbounded context growth that degrades LLM response time."""
        non_system = [m for m in self._history if m["role"] != "system"]
        if len(non_system) < COMPRESS_AT_MESSAGES:
            return

        old_msgs = non_system[: len(non_system) - MAX_HISTORY_MESSAGES]
        recent_msgs = non_system[len(non_system) - MAX_HISTORY_MESSAGES :]
        old_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in old_msgs
        )
        try:
            sum_resp = await self._openai.chat.completions.create(
                model=self._eval_model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Summarize this interview excerpt in 5-7 bullet points. "
                        "Capture: candidate's background, skills and technologies mentioned, "
                        "specific projects or experiences described, and any notable answers.\n\n"
                        f"{old_text}"
                    ),
                }],
                max_tokens=300,
                temperature=0.1,
            )
            summary = sum_resp.choices[0].message.content or ""
            original_system = self._history[0]["content"]
            compressed_system = (
                original_system
                + f"\n\n[EARLIER CONVERSATION SUMMARY — treat as verified facts]:\n{summary}\n"
            )
            self._history = (
                [{"role": "system", "content": compressed_system}] + recent_msgs
            )
            print(
                f"[Pipeline] History compressed: {len(old_msgs)} messages → summary "
                f"({len(self._history)} messages remaining)"
            )
        except Exception as e:
            print(f"[Pipeline] History compression failed (non-fatal): {e}")

    # ── Core turn: streaming LLM → sentence-level TTS → Recall.ai ─────────────

    async def _process_turn(self, user_text: str, speaker: str = "Candidate"):
        if self._bot_id:
            utterance_key = f"{speaker}:{user_text.strip()}"
            speech_id = speech_guard.start_speech(self._bot_id, utterance_key)
            if not speech_id:
                print(f"[Pipeline] Turn skipped (duplicate utterance or revoked speech ownership): '{user_text[:40]}'")
                return
            self._speech_id = speech_id

        # Mark as speaking immediately so any transcripts that arrive during the
        # thinking pause are buffered as interruptions, not new turns.
        self._current_turn_id += 1
        turn_id = self._current_turn_id
        self._speaking = True
        self._words_since_last_bot = 0
        self._was_interrupted = False
        self._state.questions_asked += 1

        # Adaptive thinking pause — scales with answer length so the bot sounds natural.
        await asyncio.sleep(self._compute_thinking_pause(user_text))

        if self._backchannel_task and not self._backchannel_task.done():
            self._backchannel_task.cancel()

        try:
            print(f"[Pipeline] Processing — {speaker}: {user_text[:100]}")
            self._full_transcript.append({"speaker": speaker, "text": user_text})
            self._history.append({"role": "user", "content": user_text})

            # Correction detection — store on state so future turns reference the right term
            correction = self._detect_correction(user_text)
            if correction:
                old_term, new_term = correction
                self._state.confirmed_corrections[old_term] = new_term
                print(f"[Pipeline] Correction: '{old_term}' → '{new_term}'")

            # Forced topic pivot when confusion threshold reached — bypass LLM entirely
            if self._state.consecutive_confusion_count >= CONFUSION_PIVOT_THRESHOLD:
                fallback = CONFUSION_FALLBACKS[self._confusion_fallback_idx % len(CONFUSION_FALLBACKS)]
                self._confusion_fallback_idx += 1
                self._state.consecutive_confusion_count = 0
                print(f"[Pipeline] Forced topic pivot: {fallback}")
                audio = await self._tts(fallback)
                if audio and self._on_response and self.is_turn_valid(turn_id):
                    await self._on_response(fallback, audio)
                self._history.append({"role": "assistant", "content": fallback})
                self._full_transcript.append({"speaker": "AI", "text": fallback})
                return

            # Compress history if approaching the context limit (runs ~every 25 turns)
            await self._maybe_compress_history()

            # Build messages: history[0] + 4-line state context only. No planning overhead.
            state_ctx = self._build_state_context()
            messages = list(self._history)
            messages[0] = {
                "role": "system",
                "content": messages[0]["content"] + state_ctx,
            }

            queue: asyncio.Queue[str | None] = asyncio.Queue()
            full_text: list[str] = []

            async def llm_producer():
                buf = ""
                stream = await self._openai.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    temperature=0.5,
                    max_tokens=200,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    buf += delta
                    full_text.append(delta)
                    while True:
                        m = _SENTENCE_END.search(buf)
                        if not m:
                            break
                        sentence = buf[: m.start() + 1].strip()
                        buf = buf[m.end() :]
                        if sentence:
                            await queue.put(sentence)
                if buf.strip():
                    await queue.put(buf.strip())
                await queue.put(None)

            # tts_delivery_queue carries (sentence_text, tts_task) pairs in order.
            # start_tts kicks off synthesis the moment text is available; deliver_tts
            # awaits each task and calls speak() in order. TTS for sentence N+1 runs
            # in parallel with the speak() call for sentence N, saving ~300ms per
            # additional sentence compared to sequential synthesis.
            tts_delivery_queue: asyncio.Queue = asyncio.Queue()

            async def start_tts():
                while True:
                    sentence = await queue.get()
                    if sentence is None or not self.is_turn_valid(turn_id):
                        # Signal deliver_tts to stop, then drain any remaining LLM sentences
                        await tts_delivery_queue.put(None)
                        if not self.is_turn_valid(turn_id):
                            try:
                                while True:
                                    queue.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        break
                    # Inline question dedup — skip if this question was already asked this session
                    if sentence.strip().endswith("?"):
                        key = sentence.strip().lower()[:60]
                        if key in self._asked_questions:
                            print(f"[Pipeline] Duplicate question skipped: {sentence[:50]}")
                            continue
                        self._asked_questions.add(key)
                    tts_task = asyncio.create_task(self._tts(sentence))
                    await tts_delivery_queue.put((sentence, tts_task))

            async def deliver_tts():
                while True:
                    item = await tts_delivery_queue.get()
                    if item is None:
                        break
                    sentence, tts_task = item
                    if not self.is_turn_valid(turn_id):
                        tts_task.cancel()
                        break
                    print(f"[Pipeline] TTS → Recall: {sentence[:70]}")
                    audio = await tts_task
                    if not self.is_turn_valid(turn_id):
                        break
                    if audio and self._on_response and self.is_turn_valid(turn_id):
                        await self._on_response(sentence, audio)

            # 30-second hard timeout prevents a hung OpenAI/ElevenLabs call from
            # leaving _speaking=True forever. Increased from 20s to accommodate
            # longer closing messages and multi-sentence responses (max_tokens=200).
            try:
                await asyncio.wait_for(
                    asyncio.gather(
                        asyncio.create_task(llm_producer()),
                        asyncio.create_task(start_tts()),
                        asyncio.create_task(deliver_tts()),
                    ),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                print("[Pipeline] LLM/TTS timed out (30s) — aborting this turn")

            full_response = "".join(full_text)
            if full_response:
                self._history.append({"role": "assistant", "content": full_response})
                self._full_transcript.append({"speaker": "AI", "text": full_response})
                self._last_activity_at = time.monotonic()  # bot spoke — reset inactivity clock
                print(f"[Pipeline] AI complete: {full_response[:100]}")

                if self._is_clarification_response(full_response):
                    self._state.consecutive_confusion_count += 1
                    print(f"[Pipeline] Clarification #{self._state.consecutive_confusion_count}")
                else:
                    self._state.consecutive_confusion_count = 0

                # Inline topic counter — advance to next topic after 3 turns on the same one
                if self._state.topics_remaining:
                    self._topic_turn_count += 1
                    if self._topic_turn_count >= 3:
                        covered = self._state.topics_remaining.pop(0)
                        self._state.topics_covered.append(covered)
                        self._topic_turn_count = 0
                        print(f"[Pipeline] Topic advanced: '{covered}' → remaining: {self._state.topics_remaining}")

                # Phase advancement — deterministic from topics remaining
                if self._state.current_phase == "greeting":
                    self._state.current_phase = "technical"
                elif not self._state.topics_remaining and self._state.current_phase != "wrap_up":
                    self._state.current_phase = "wrap_up"
                    print("[Pipeline] All topics covered — phase → wrap_up")

                # Auto-end session when bot says goodbye — triggers scorecard + cleanup
                if (self._session_end_callback
                        and not self._session_end_triggered
                        and self._is_interview_closing(full_response)):
                    self._session_end_triggered = True
                    print(f"[Pipeline] Goodbye detected in response — scheduling auto-end")
                    asyncio.create_task(self._trigger_session_end())
            elif not self._was_interrupted and self.is_turn_valid(turn_id):
                # LLM returned nothing and we weren't interrupted — emit a safe fallback
                # so the bot doesn't silently freeze mid-interview.
                fallback = "Sorry, could you say that again?"
                print("[Pipeline] Empty LLM response — emitting fallback prompt")
                audio = await self._tts(fallback)
                if audio and self._on_response and self.is_turn_valid(turn_id):
                    await self._on_response(fallback, audio)
                self._history.append({"role": "assistant", "content": fallback})
                self._full_transcript.append({"speaker": "AI", "text": fallback})

        except Exception as e:
            print(f"[Pipeline] Error: {e}")
        finally:
            self._speaking = False
            self._flush_pending()
            # Keepalive: if nothing happens for WAKEUP_AFTER_SILENCE seconds after this
            # turn, send a gentle nudge so the bot never freezes permanently (BUG_03).
            if self._keepalive_task and not self._keepalive_task.done():
                self._keepalive_task.cancel()
            self._keepalive_task = asyncio.create_task(self._keepalive_check())

    # ── TTS: ElevenLabs streaming with OpenAI fallback ─────────────────────────

    async def _tts(self, text: str) -> bytes:
        if self._elevenlabs_key:
            try:
                return await self._tts_elevenlabs(text)
            except Exception as e:
                print(f"[Pipeline] ElevenLabs error, falling back to OpenAI TTS: {e}")
        return await self._tts_openai(text)

    async def _tts_elevenlabs(self, text: str) -> bytes:
        """Streaming TTS endpoint — audio chunks start arriving in ~80-150ms.
        Previously used the non-streaming endpoint which waited for full synthesis
        (~350-700ms) before returning any bytes. Switching to /stream + latency
        optimization cuts time-to-first-audio by 250-550ms per sentence."""
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self._voice_id}/stream"
        payload = {
            "text": text,
            # eleven_flash_v2_5: ~75ms TTFA, optimized for low latency.
            "model_id": os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
            "voice_settings": {
                # stability 0.65: higher stability locks the voice tone more tightly
                # so the bot sounds the same whether the answer was good or short.
                # 0.52 allowed too much turn-to-turn drift (excited vs flat).
                "stability": 0.65,
                # similarity_boost 0.85: with eleven_multilingual_v2, higher values
                # lock the model closer to the original voice's accent characteristics.
                # Critical for Indian voices — lower values let the model drift neutral.
                "similarity_boost": 0.85,
                # style MUST be 0.0 for conversational use. Non-zero style adds
                # ElevenLabs server-side compute (~50ms/sentence) AND makes short
                # 1-2 sentence responses sound over-dramatic rather than natural.
                "style": 0.0,
                "use_speaker_boost": False, # False saves ~50ms/sentence — keep for latency
            },
            # mp3_22050_32: 22kHz mono 32kbps — smallest MP3 Recall.ai accepts.
            # Half the bytes of mp3_44100_128 with imperceptible quality difference for voice.
            "output_format": "mp3_22050_32",
            # optimize_streaming_latency=4: maximum server-side latency reduction.
            # Still valid per ElevenLabs docs (not deprecated).
            "optimize_streaming_latency": 4,
        }
        chunks: list[bytes] = []
        async with self._http_client.stream(
            "POST",
            url,
            headers={
                "xi-api-key": self._elevenlabs_key,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30.0,
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes(chunk_size=4096):
                if chunk:
                    chunks.append(chunk)
        return b"".join(chunks)

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
        return await _scorecard_module.generate_scorecard(
            transcript=self.get_transcript_text(),
            candidate_name=candidate_name,
            openai_client=self._openai,
            scorecard_model=self._scorecard_model,
            noise_segments_filtered=self._noise_segments_filtered,
            topics_covered=list(self._state.topics_covered),
            questions_asked=self._state.questions_asked,
            elapsed_minutes=self._state.elapsed_minutes(),
        )

    def _is_interview_closing(self, text: str) -> bool:
        """Detect if the bot just said goodbye — triggers auto-leave + scorecard generation.
        Uses a tiered signal approach: one strong signal OR two weak signals."""
        t = text.lower()
        strong_signals = [
            "you can now leave the call", "you can leave the call",
            "feel free to leave", "feel free to close",
            "we will be in touch", "we'll be in touch",
            "our team will be in touch", "team will be in touch",
            "we'll reach out", "we will reach out",
            "thank you for your time", "thanks for your time",
            "that concludes our interview",
            "we'll let you know", "we will let you know",
        ]
        weak_signals = [
            "best of luck", "all the best", "good luck",
            "goodbye", "good bye", "take care",
            "have a great day", "have a good day",
            "thank you for sharing", "thanks for sharing",
        ]
        strong_count = sum(1 for p in strong_signals if p in t)
        weak_count = sum(1 for p in weak_signals if p in t)
        return strong_count >= 1 or weak_count >= 2

    async def _trigger_session_end(self):
        """Wait for goodbye audio to finish playing, then fire the session end callback.
        The closing message is 3 sentences (~12-15s of audio). The delay must be long
        enough for Recall.ai to finish playing all queued audio before the bot leaves.
        5s was too short — bot left while sentences 2-3 were still playing, causing
        the dual-audio overlap on the closing line. Increased to 15s."""
        await asyncio.sleep(15.0)
        if self._session_end_callback:
            try:
                print("[Pipeline] Firing session end callback (goodbye complete)")
                await self._session_end_callback()
            except Exception as e:
                print(f"[Pipeline] Session end callback error: {e}")

    async def aclose(self):
        """Cancel background tasks and release the HTTP client. Call on session end."""
        if self._keepalive_task and not self._keepalive_task.done():
            self._keepalive_task.cancel()
        if self._http_client:
            await self._http_client.aclose()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _norm_dedup_key(speaker: str, words: list, text: str = "") -> str:
    """Build a stable dedup key for transcript segment deduplication.

    Primary strategy: use the segment's start_time (from the first word object).
    Both the Recall.ai webhook path and the REST polling path include Deepgram
    word-level timestamps, so the same spoken segment produces the same key even
    when Deepgram revises the text between real-time delivery and batch retrieval
    (e.g. "Node" → "Node.js", added punctuation, capitalisation fixes).

    Fallback (no timing info): normalise text — lowercase + strip punctuation —
    which handles the most common differences (terminal periods, commas).
    """
    if words:
        try:
            t_start = float(
                words[0].get("start_time") or words[0].get("start") or 0.0
            )
            if t_start > 0:
                return f"{speaker.lower()}:t{round(t_start, 1)}"
        except (TypeError, ValueError):
            pass
    # Fallback: normalise text (handles punctuation variants, not word expansions)
    norm = _DEDUP_NORM_RE.sub("", text.lower()).split()
    return f"{speaker.lower()}:{' '.join(norm[:8])}"


def _strip_code_fence(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` fences from LLM output."""
    if "```" not in text:
        return text
    parts = text.split("```")
    # parts[1] is the content inside the first fence pair
    inner = parts[1] if len(parts) >= 2 else text
    if inner.startswith("json"):
        inner = inner[4:]
    return inner.strip()
