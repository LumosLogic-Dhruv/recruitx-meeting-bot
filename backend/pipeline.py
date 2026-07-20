import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Awaitable
from openai import AsyncOpenAI
import httpx

# ── Silence timeout constants ──────────────────────────────────────────────────
# Deepgram endpointing=300ms fires a segment after 300ms of audio silence.
# These timers start AFTER Deepgram fires a final segment — so they run on top
# of whatever natural pauses already existed in the speech.
# Increased thresholds (Jul-20 fix): 0.8/1.2 were triggering on natural
# mid-sentence pauses in Indian English, causing the bot to process half-answers
# and then double-respond with a second question when the rest arrived.
SILENCE_SHORT      = 1.5   # 1–5 words   → wait a full breath before responding
SILENCE_MEDIUM     = 2.0   # 6–15 words  → let them finish the thought
SILENCE_LONG       = 2.8   # 16–35 words → long answers need more settle time
SILENCE_XLONG      = 4.0   # 35+ words
SILENCE_INCOMPLETE = 4.5   # sentence ends mid-thought ("and", "the", "so"…)
SILENCE_INTERRUPTED = 0.8  # candidate spoke over bot — respond fast but not instant

# Minimum words before SILENCE_SHORT fires — prevents 1-2 word fragments from
# triggering a full LLM response before the candidate has barely started speaking.
MIN_WORDS_FOR_SHORT_SILENCE = 8

# Thinking pause added before LLM call — makes bot feel like a human pausing
# to absorb the answer before asking the next question.
THINKING_PAUSE = 1.0

# Delay before processing text buffered during bot speech (flush_pending).
# Prevents double-responses: when bot finishes Q1, buffered fragments from
# the candidate speaking during Q1's audio get restarted with this delay,
# giving them time to arrive as a complete thought rather than firing immediately.
FLUSH_PENDING_DELAY = 2.0

MIN_WORDS_TO_RESPOND = 3   # ignore stray STT fragments shorter than this
WAKEUP_MIN_WORDS = 1       # threshold used when bot has been silent for WAKEUP_AFTER_SILENCE seconds
WAKEUP_AFTER_SILENCE = 35  # seconds of bot silence before lowering the word threshold

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

BACKCHANNEL_WORD_THRESHOLD = 30   # words candidate must speak before first backchannel
BACKCHANNEL_MIN_INTERVAL = 18.0  # minimum seconds between consecutive backchannels
BACKCHANNELS = [
    "Right.", "Sure.", "I see.", "Okay.", "Mm-hmm.",
    "Right, right.", "Sure, sure.", "Got it.", "Okay, okay.", "Interesting.",
]

CONFUSION_PIVOT_THRESHOLD = 2
CONFUSION_FALLBACKS = [
    "Sure, let's come back to that. Tell me about another project you've worked on recently.",
    "Okay, no worries. Let me ask you something different — what's your experience with system design?",
    "Got it. Let's shift gears — tell me about a technical challenge you've solved recently.",
    "That's fine. Let me ask you about something else — how do you approach debugging a production issue?",
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

_RULES_PREFIX = """\
YOU ARE A HUMAN INTERVIEWER ON A VOICE CALL — an Indian professional conducting a \
real-time interview. Speak the way a warm, experienced Indian recruiter would on a phone call. \
These rules are non-negotiable:

1. ONE question per response. Never ask two things at once.

2. MAXIMUM 2 sentences per response — usually just 1. Think phone call, not email. \
The candidate should be talking more than you.

3. NEVER say "Excellent!", "Great answer!", "Perfect!", "Fantastic!", "Absolutely!", \
"That's great!", "Wonderful!" — robotic clichés. \
React like a real Indian professional — pick from this varied list and NEVER repeat \
the same opener twice in a row: \
"Right, I see.", "Okay, so...", "Sure.", "Got it.", "Makes sense.", \
"Interesting.", "I see.", "Right right.", "Okay, understood.", "Sure, okay.", \
"That makes sense.", "Right, okay.", "I see, okay.", "Sure, good.", "Noted." \
— short, natural, varied every single turn.

3b. TONE RULE — Keep the SAME calm, steady professional tone in every single response. \
Do NOT mirror the candidate's excitement. Do NOT become flat or robotic when they give \
a short answer. Stay consistently measured and neutral — like a professional recruiter \
who has done hundreds of interviews and is genuinely interested but never shows extremes.

4. Structure every response as: [reaction from rule 3] + [one question]. \
Example: "Got it — so what stack did you use for that?" \
Example: "Interesting — how large was the team?" \
Example: "Sure, okay — what was your specific role there?" \
Example: "Makes sense — and how long did that project take?"

5. MOVE ON AFTER 2 FOLLOW-UPS ON THE SAME TOPIC. \
If you have already asked 2 questions about the same project or subject, \
move to a completely different area — a new technical skill, a different project, \
or a behavioral question. Do NOT keep drilling the same project for more than 2 turns. \
A real interviewer covers breadth, not just depth on one thing.

6. Speak natural Indian English. Avoid hyper-American slang: \
"Oh cool", "Oh nice", "Awesome", "That's amazing" — an Indian professional would never say these.

7. Only ask about what the candidate JUST said. Never invent facts or assume anything.

8. STT NOISE RULE — this is a real-time voice call. Background noise, accents, \
and fast speech all cause garbling. Strict rules: \
(a) If the WHOLE transcript is garbled (no recognizable content, under 4 words), ask ONCE: \
"Sorry, I didn't quite catch that — could you say it again?" \
(b) If only PART of the answer is garbled, infer meaning from context and ask a follow-up — \
do NOT ask to repeat for partial garbling. \
(c) Never ask for clarification more than once on the same point — move to a new topic after two failed attempts. \
(d) If the candidate mentions background noise ("there's noise", "it's loud here"), \
say "No worries, I can still hear you — please continue" and keep going. \
(e) NEVER suggest the candidate move to a quieter location — adapt and continue the interview. \
(f) Never repeat a garbled or unrecognized term back to the candidate verbatim.

8b. CORRECTION RULE — If the candidate says "it's not X" or "I mean Y": \
(a) Immediately acknowledge the corrected term: "Got it, MERN stack." \
(b) NEVER use the old garbled term again in this conversation. \
(c) Ask your next question using the corrected term only.

9. VOICE CALL — STT artifacts: text may have odd spellings or fragments. \
Infer meaning charitably from context — "one stick" is likely "MERN", \
"right level" is likely "white-label", etc. \
If you can infer the meaning, proceed without asking the candidate to repeat. \
Only ask for clarification if the meaning is completely lost. \
NEVER repeat an unusual or garbled-sounding term back to the candidate verbatim.

"""

# Context window constants
MAX_HISTORY_MESSAGES = 40   # retain the 40 most recent messages (20 exchanges)
COMPRESS_AT_MESSAGES = 50   # trigger compression when non-system messages exceed this


# ── Interview State Engine ─────────────────────────────────────────────────────

@dataclass
class InterviewState:
    """Tracks phase, topic coverage, and per-turn observations."""
    current_phase: str = "greeting"    # greeting → intro → technical → behavioral → wrap_up
    current_topic: str = ""
    topics_covered: list = field(default_factory=list)
    topics_remaining: list = field(default_factory=list)
    strengths: list = field(default_factory=list)
    concerns: list = field(default_factory=list)
    questions_asked: int = 0
    consecutive_confusion_count: int = 0
    start_time: float = field(default_factory=time.monotonic)

    def elapsed_minutes(self) -> float:
        return (time.monotonic() - self.start_time) / 60

    def advance_phase(self):
        _order = ["greeting", "intro", "technical", "behavioral", "wrap_up"]
        try:
            idx = _order.index(self.current_phase)
            if idx < len(_order) - 1:
                self.current_phase = _order[idx + 1]
        except ValueError:
            pass

    def should_advance_phase(self) -> bool:
        elapsed = self.elapsed_minutes()
        if self.current_phase == "greeting":
            return True
        if self.current_phase == "intro" and self.questions_asked >= 3:
            return True
        if self.current_phase == "technical":
            return (not self.topics_remaining) or elapsed > 40
        if self.current_phase == "behavioral" and self.questions_asked >= 2:
            return True
        return False


@dataclass
class CandidateProfile:
    """Accumulates skills, technologies, and running-average performance scores."""
    skills_detected: list = field(default_factory=list)
    technologies_detected: list = field(default_factory=list)
    confirmed_corrections: dict = field(default_factory=dict)  # garbled → correct
    communication_score: float = 3.0   # 1–5 running average
    technical_score: float = 3.0       # 1–5 running average
    answer_depth_score: float = 3.0    # 1–5 running average
    eval_count: int = 0

    def update_scores(self, depth: float, technical: float, communication: float):
        n = self.eval_count
        self.answer_depth_score   = (self.answer_depth_score   * n + depth)         / (n + 1)
        self.technical_score      = (self.technical_score      * n + technical)     / (n + 1)
        self.communication_score  = (self.communication_score  * n + communication) / (n + 1)
        self.eval_count += 1

    def difficulty_adjustment(self) -> str:
        avg = (self.technical_score + self.answer_depth_score) / 2
        if avg >= 3.8:
            return "increase"
        if avg < 2.2:
            return "decrease"
        return "maintain"


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

        # Noisy-background support: async ASR cleaning task + noise event counter
        self._pending_clean_task: asyncio.Task | None = None
        self._noise_segments_filtered: int = 0

        # Interview state engine
        self._state = InterviewState()
        self._profile = CandidateProfile()
        self._eval_task: asyncio.Task | None = None
        self._topics_initialized: bool = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def set_response_callback(self, callback: Callable[[str, bytes], Awaitable[None]]):
        self._on_response = callback

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

    async def send_greeting(self, bot_name: str) -> bytes:
        self._speaking = True
        # Extract interview topics from the system prompt in the background.
        # This runs concurrently with TTS synthesis — zero latency cost.
        # By the time the candidate finishes their intro (~30-60s), topics are ready.
        asyncio.create_task(self._ensure_topics_initialized())
        try:
            greeting = (
                f"Hey, thanks for joining! I'm {bot_name}. "
                "So just to kick things off — tell me a bit about yourself and what you've been working on lately."
            )
            audio = await self._tts(greeting)
            self._history.append({"role": "assistant", "content": greeting})
            self._full_transcript.append({"speaker": "AI", "text": greeting})
            self._last_activity_at = time.monotonic()
            print(f"[Pipeline] Greeting sent.")
            return audio
        finally:
            self._speaking = False
            self._flush_pending()

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
            print(f"[Pipeline] Interrupted — buffered: {text[:50]}")
            return

        # Start async ASR cleaning while the silence timer counts down.
        # By the time the timer fires (1-4s later), the cleaned text is ready — zero latency cost.
        if self._pending_clean_task and not self._pending_clean_task.done():
            self._pending_clean_task.cancel()
        self._pending_clean_task = asyncio.create_task(
            self._clean_transcript(self._pending_text)
        )

        self._words_since_last_bot += len(text.split())
        self._maybe_schedule_backchannel()
        self._reset_silence_timer()

    def on_partial_transcript(self, speaker: str = "Candidate"):
        """Called on interim transcript segments (transcript.partial_data events).
        Does NOT accumulate text — the final event delivers the clean version.
        Two purposes: (1) reset the silence timer so the AI knows the candidate is
        still speaking; (2) cancel in-progress bot speech so the bot never talks
        over a candidate who is mid-sentence."""
        if self._speaking:
            # Candidate is speaking while bot is generating/playing a response —
            # mark as interrupted so the TTS pipeline stops at the next checkpoint.
            self._was_interrupted = True
            return
        if self._pending_text:
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
            nudge = "Please go ahead."
            audio = await self._tts(nudge)
            if audio and self._on_response and not self._speaking:
                await self._on_response(nudge, audio)

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
        nudge = "Are you still there? Please go ahead whenever you're ready."
        try:
            audio = await self._tts(nudge)
            if audio and self._on_response and not self._speaking:
                await self._on_response(nudge, audio)
                self._last_activity_at = time.monotonic()
        except Exception as e:
            print(f"[Pipeline] Keepalive error: {e}")

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
            "tell me a bit more", "could you clarify", "can you elaborate", "what do you mean"
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

        # Use ASR-cleaned text if the background clean task finished during the silence timer.
        # The timer runs 1-4s, the clean call takes ~300ms — it's almost always ready.
        if self._pending_clean_task is not None:
            try:
                if not self._pending_clean_task.done():
                    cleaned = await asyncio.wait_for(
                        asyncio.shield(self._pending_clean_task), timeout=0.4
                    )
                else:
                    cleaned = self._pending_clean_task.result()
                if cleaned and cleaned.strip():
                    text = cleaned.strip()
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
            self._pending_clean_task = None

        # Wake-up mode: after WAKEUP_AFTER_SILENCE seconds of bot silence, respond even
        # to single-word utterances like "Hello?" so the bot never stays unresponsive.
        silent_for = time.monotonic() - self._last_activity_at
        min_words = WAKEUP_MIN_WORDS if silent_for >= WAKEUP_AFTER_SILENCE else MIN_WORDS_TO_RESPOND
        if len(text.split()) < min_words:
            print(f"[Pipeline] Fragment too short ({len(text.split())} words, min={min_words}): '{text}' — ignored")
            return
        await self._process_turn(text, speaker)

    async def _clean_transcript(self, text: str) -> str:
        """Fix obvious ASR acoustic errors before the interviewer LLM sees the text.
        Returns original text on any error — never blocks the turn."""
        try:
            resp = await self._openai.chat.completions.create(
                model=self._model,
                messages=[{
                    "role": "user",
                    "content": (
                        "This is a real-time speech-to-text transcript from a software developer. "
                        "Fix ONLY obvious acoustic errors: mangled tech names, framework names, "
                        "acronyms (e.g. 'one stick' → 'MERN', 'management development' → 'MERN stack', "
                        "'right level listen' → 'white-label', 'pseudo code' → 'solo project', "
                        "'DLP' → 'raw PDF'). Do NOT change anything else. Return only the fixed text.\n\n"
                        f"Transcript: {text}"
                    ),
                }],
                max_tokens=200,
                temperature=0.1,
            )
            cleaned = (resp.choices[0].message.content or text).strip()
            if cleaned != text:
                print(f"[Pipeline] ASR cleaned: '{text[:60]}' → '{cleaned[:60]}'")
            return cleaned
        except Exception as e:
            print(f"[Pipeline] ASR cleaner error (non-fatal): {e}")
            return text

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

    async def _evaluate_and_update(self, user_text: str):
        """Evaluate the candidate's answer and update InterviewState + CandidateProfile.
        Runs as a background asyncio.Task — never blocks the bot's response."""
        try:
            prompt = (
                'Analyze this interview answer from a live voice call. Return JSON only, no markdown.\n\n'
                'NOTE: This is a real-time STT transcript. It may contain garbled technical terms '
                '(e.g. "next sales"=Next.js, "RGS"=some framework) or be a fragment of a longer '
                'answer. Read charitably — infer the most plausible meaning from context.\n\n'
                f'Answer: "{user_text[:800]}"\n\n'
                'Return:\n'
                '{\n'
                '  "skills": [technical skills mentioned or clearly implied, empty list if none],\n'
                '  "technologies": [tools/frameworks/languages mentioned or clearly implied],\n'
                '  "depth_score": <1-5, how specific and detailed the answer was>,\n'
                '  "technical_score": <1-5, technical correctness and depth — be charitable for ASR noise>,\n'
                '  "communication_score": <1-5, clarity and structure — ignore STT artefacts>,\n'
                '  "topic_discussed": "<main topic this answer addressed, 2-4 words>",\n'
                '  "topic_covered": <true if topic was answered adequately>,\n'
                '  "strength": "<one brief standout strength, or empty string>",\n'
                '  "concern": "<one brief concern if notable, or empty string>"\n'
                '}'
            )
            resp = await self._openai.chat.completions.create(
                model=self._eval_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=180,
                temperature=0.1,
            )
            raw = _strip_code_fence((resp.choices[0].message.content or "{}").strip())
            data = json.loads(raw)

            # Update CandidateProfile
            for s in data.get("skills", []):
                if s and s not in self._profile.skills_detected:
                    self._profile.skills_detected.append(s)
            for t in data.get("technologies", []):
                if t and t not in self._profile.technologies_detected:
                    self._profile.technologies_detected.append(t)
            self._profile.update_scores(
                depth=float(data.get("depth_score", 3)),
                technical=float(data.get("technical_score", 3)),
                communication=float(data.get("communication_score", 3)),
            )

            # Update InterviewState
            topic = data.get("topic_discussed", "").strip()
            if topic and data.get("topic_covered"):
                if topic not in self._state.topics_covered:
                    self._state.topics_covered.append(topic)
                # Remove from remaining if it overlaps with any listed topic
                self._state.topics_remaining = [
                    tr for tr in self._state.topics_remaining
                    if topic.lower() not in tr.lower() and tr.lower() not in topic.lower()
                ]
            if topic:
                self._state.current_topic = topic

            strength = data.get("strength", "").strip()
            concern = data.get("concern", "").strip()
            if strength:
                self._state.strengths.append(strength)
            if concern:
                self._state.concerns.append(concern)

            if self._state.should_advance_phase():
                old = self._state.current_phase
                self._state.advance_phase()
                print(f"[State] Phase advanced: {old} → {self._state.current_phase}")

            print(
                f"[State] Eval done — depth={data.get('depth_score')}/5 "
                f"tech={data.get('technical_score')}/5 "
                f"topic='{topic}' skills={data.get('skills', [])}"
            )
        except Exception as e:
            print(f"[State] Evaluation error (non-fatal): {e}")

    def _build_state_context(self) -> str:
        """Return a concise interview-state block injected into the LLM system
        message for this turn only. Never stored in self._history."""
        s = self._state
        p = self._profile
        lines = [
            f"\n[INTERVIEW STATE | phase={s.current_phase} | "
            f"turn={s.questions_asked} | {s.elapsed_minutes():.0f}min elapsed]"
        ]
        if p.confirmed_corrections:
            lines.append(
                "CONFIRMED CORRECTIONS (use these terms ONLY, never the old ones): "
                + ", ".join(
                    f"'{old}' = actually '{new}'"
                    for old, new in p.confirmed_corrections.items()
                )
            )
        if s.consecutive_confusion_count >= CONFUSION_PIVOT_THRESHOLD:
            lines.append(
                "FORCE TOPIC CHANGE: You have asked for clarification too many times on this point. "
                "Do NOT ask for clarification again. Move immediately to a completely new topic: "
                + (s.topics_remaining[0] if s.topics_remaining else "a behavioral question")
                + ". Acknowledge the candidate briefly and pivot."
            )
        if s.topics_covered:
            lines.append(f"Already covered: {', '.join(s.topics_covered[-4:])}")
        if s.topics_remaining:
            lines.append(f"Still to cover: {', '.join(s.topics_remaining[:3])}")
        if p.skills_detected:
            lines.append(f"Candidate confirmed skills: {', '.join(p.skills_detected[:6])}")
        if p.technologies_detected:
            lines.append(f"Technologies mentioned: {', '.join(p.technologies_detected[:6])}")

        adj = p.difficulty_adjustment()
        if adj == "increase":
            lines.append(
                "Performance is strong — probe deeper or ask a harder follow-up question."
            )
        elif adj == "decrease":
            lines.append(
                "Candidate is struggling — simplify or ask a more foundational question."
            )

        if s.questions_asked >= 2:
            lines.append(
                f"Running scores: technical={p.technical_score:.1f}/5  "
                f"depth={p.answer_depth_score:.1f}/5  "
                f"communication={p.communication_score:.1f}/5"
            )
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
        # Wait briefly for the previous answer evaluation to finish — it's usually
        # already done since the candidate's response takes 10-30s. Cap at 0.2s so
        # a slow eval call never adds visible latency to the next turn.
        if self._eval_task and not self._eval_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._eval_task), timeout=0.2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        # Mark as speaking immediately so any transcripts that arrive during the
        # thinking pause are buffered as interruptions, not new turns.
        self._speaking = True
        self._words_since_last_bot = 0
        self._was_interrupted = False
        self._state.questions_asked += 1

        # Natural thinking pause — simulates a human interviewer absorbing the
        # answer before formulating the next question. Also prevents rapid-fire
        # responses when the silence timer fires slightly early.
        await asyncio.sleep(THINKING_PAUSE)

        if self._backchannel_task and not self._backchannel_task.done():
            self._backchannel_task.cancel()

        try:
            print(f"[Pipeline] Processing — {speaker}: {user_text[:100]}")
            self._full_transcript.append({"speaker": speaker, "text": user_text})
            self._history.append({"role": "user", "content": user_text})

            # Correction detection — update profile before LLM sees this turn's context
            correction = self._detect_correction(user_text)
            if correction:
                old_term, new_term = correction
                self._profile.confirmed_corrections[old_term] = new_term
                self._profile.skills_detected = [
                    s for s in self._profile.skills_detected
                    if old_term.lower() not in s.lower()
                ]
                self._profile.technologies_detected = [
                    t for t in self._profile.technologies_detected
                    if old_term.lower() not in t.lower()
                ]
                print(f"[Pipeline] Correction: '{old_term}' → '{new_term}'")

            # Forced topic pivot when confusion threshold reached — bypass LLM entirely
            if self._state.consecutive_confusion_count >= CONFUSION_PIVOT_THRESHOLD:
                fallback = CONFUSION_FALLBACKS[self._confusion_fallback_idx % len(CONFUSION_FALLBACKS)]
                self._confusion_fallback_idx += 1
                self._state.consecutive_confusion_count = 0
                print(f"[Pipeline] Forced topic pivot: {fallback}")
                audio = await self._tts(fallback)
                if audio and self._on_response:
                    await self._on_response(fallback, audio)
                self._history.append({"role": "assistant", "content": fallback})
                self._full_transcript.append({"speaker": "AI", "text": fallback})
                self._eval_task = asyncio.create_task(self._evaluate_and_update(user_text))
                return

            # Compress history if approaching the context limit (runs ~every 25 turns)
            await self._maybe_compress_history()

            # Build the message list with a transient state context injected into
            # the system message for this turn only — self._history is never modified.
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
                    max_tokens=120,
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
                    if sentence is None or self._was_interrupted:
                        # Signal deliver_tts to stop, then drain any remaining LLM sentences
                        await tts_delivery_queue.put(None)
                        if self._was_interrupted:
                            try:
                                while True:
                                    queue.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        break
                    tts_task = asyncio.create_task(self._tts(sentence))
                    await tts_delivery_queue.put((sentence, tts_task))

            async def deliver_tts():
                while True:
                    item = await tts_delivery_queue.get()
                    if item is None:
                        break
                    sentence, tts_task = item
                    if self._was_interrupted:
                        tts_task.cancel()
                        break
                    print(f"[Pipeline] TTS → Recall: {sentence[:70]}")
                    audio = await tts_task
                    if audio and self._on_response:
                        await self._on_response(sentence, audio)

            # 20-second hard timeout prevents a hung OpenAI/ElevenLabs call from
            # leaving _speaking=True forever, which was the root cause of BUG_03.
            try:
                await asyncio.wait_for(
                    asyncio.gather(
                        asyncio.create_task(llm_producer()),
                        asyncio.create_task(start_tts()),
                        asyncio.create_task(deliver_tts()),
                    ),
                    timeout=20.0,
                )
            except asyncio.TimeoutError:
                print("[Pipeline] LLM/TTS timed out (20s) — aborting this turn")

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
            elif not self._was_interrupted:
                # LLM returned nothing and we weren't interrupted — emit a safe fallback
                # so the bot doesn't silently freeze mid-interview.
                fallback = "Sorry, could you say that again?"
                print("[Pipeline] Empty LLM response — emitting fallback prompt")
                audio = await self._tts(fallback)
                if audio and self._on_response:
                    await self._on_response(fallback, audio)
                self._history.append({"role": "assistant", "content": fallback})
                self._full_transcript.append({"speaker": "AI", "text": fallback})

            # Fire answer evaluation as a background task. It runs while the candidate
            # listens to the bot's response and formulates their next answer — zero
            # latency added to the current or next turn.
            self._eval_task = asyncio.create_task(
                self._evaluate_and_update(user_text)
            )

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
        transcript = self.get_transcript_text()
        if not transcript:
            return {"error": "No transcript available"}

        p = self._profile
        s = self._state
        profile_summary = (
            f"Skills confirmed: {', '.join(p.skills_detected) or 'not explicitly stated'}\n"
            f"Technologies mentioned: {', '.join(p.technologies_detected) or 'none'}\n"
            f"Technical score (running avg): {p.technical_score:.1f}/5\n"
            f"Answer depth score (running avg): {p.answer_depth_score:.1f}/5\n"
            f"Communication score (running avg): {p.communication_score:.1f}/5\n"
            f"Topics covered: {', '.join(s.topics_covered) or 'none tracked'}\n"
            f"Noted strengths: {'; '.join(s.strengths[-5:]) or 'none'}\n"
            f"Noted concerns: {'; '.join(s.concerns[-5:]) or 'none'}\n"
            f"Questions answered: {s.questions_asked} | "
            f"Duration: {s.elapsed_minutes():.0f} minutes\n"
        )

        # Summarize long transcripts before scoring to keep the prompt token count
        # manageable and scorecard generation fast.
        eval_text = transcript
        if len(transcript.split()) > 2000:
            try:
                sum_resp = await self._openai.chat.completions.create(
                    model=self._scorecard_model,
                    messages=[{
                        "role": "user",
                        "content": (
                            "Summarize this interview transcript. Focus on the candidate's "
                            "specific answers, technical knowledge shown, communication style, "
                            "and any standout moments:\n\n"
                            f"{transcript}"
                        ),
                    }],
                    max_tokens=700,
                    temperature=0.1,
                )
                eval_text = sum_resp.choices[0].message.content or transcript
            except Exception:
                pass

        noise_notice = ""
        if self._noise_segments_filtered >= 5:
            noise_notice = (
                f"\n⚠️  NOISY ENVIRONMENT ALERT: {self._noise_segments_filtered} background-noise "
                f"segments were automatically filtered before reaching this transcript. "
                f"The candidate's audio environment had significant noise (fan, traffic, AC, etc.). "
                f"This means some answers may be shorter than usual (noise masked speech) or "
                f"contain extra garbled words. Weight the candidate's technical knowledge and "
                f"depth of answers more heavily than fluency or sentence completeness.\n"
            )

        scorecard_prompt = f"""You are an expert recruiter evaluating a voice interview conducted by an AI bot.

IMPORTANT — ASR TRANSCRIPT NOTICE:
This transcript was produced by real-time speech-to-text (Deepgram) on a live voice call. It WILL contain garbled technical terms, sentence fragments, filler words, and disfluencies — these are STT artefacts, NOT the candidate's fault. Rules for scoring:
1. Read every answer charitably — infer the most plausible technical meaning from context.
2. Do NOT penalise for garbled words, broken sentences, or repeated phrases from STT errors.
3. If a tech term looks wrong (e.g. "next sales" = Next.js, "dog her" = Docker), use the correct term.
4. Only penalise for genuine lack of knowledge — not for STT noise.{noise_notice}

Candidate: {candidate_name}

Real-Time Profile (collected turn-by-turn):
{profile_summary}

Interview Transcript:
{eval_text}

Generate a comprehensive JSON scorecard. Return ONLY valid JSON, no extra text:
{{
  "candidate_name": "{candidate_name}",
  "overall_score": <1-10 integer>,
  "recommendation": "STRONG HIRE | HIRE | MAYBE | NO HIRE",
  "summary": "<2-3 sentence balanced assessment of the candidate>",
  "dimensions": [
    {{"name": "Communication", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Technical Depth", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Problem Solving", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Cultural Fit", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Enthusiasm", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Experience Relevance", "score": <1-10>, "comment": "<brief evidence-backed comment>"}}
  ],
  "top_strengths": [
    {{"name": "<strongest area>", "score": <1-10>}},
    {{"name": "<second strongest>", "score": <1-10>}}
  ],
  "top_gaps": [
    {{"name": "<main gap>", "score": <1-10>}},
    {{"name": "<second gap>", "score": <1-10>}}
  ],
  "green_flags": [
    "<specific positive observation backed by transcript evidence>",
    "<specific positive observation>",
    "<specific positive observation>"
  ],
  "red_flags": [
    "<specific concern backed by transcript evidence>",
    "<specific concern>"
  ],
  "skill_breakdown": [
    {{"name": "<skill actually discussed>", "score": <1-10>, "description": "<what the candidate specifically said or demonstrated about this skill>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}}
  ],
  "areas_for_improvement": [
    "<specific actionable improvement with clear rationale>",
    "<specific actionable improvement>",
    "<specific actionable improvement>"
  ],
  "ai_report": {{
    "position_applied": "<role mentioned in conversation or 'Not disclosed'>",
    "years_of_experience": "<estimate from transcript or 'Not specified'>",
    "why_interested": "<candidate's stated reason or 'Not explicitly stated in the transcript'>",
    "past_experience": [
      {{
        "title": "<project or role title>",
        "objectives": ["<key objective or responsibility>"],
        "achievements": ["<specific achievement or result>"]
      }}
    ],
    "technical_skills": [
      {{"name": "<technical skill>", "description": "<evidence from transcript showing this skill>", "verified": true}},
      {{"name": "<technical skill>", "description": "<evidence>", "verified": false}}
    ],
    "soft_skills": [
      {{"name": "<soft skill e.g. Communication>", "description": "<specific behavioral evidence from transcript>", "verified": true}},
      {{"name": "<soft skill>", "description": "<evidence>", "verified": true}}
    ],
    "next_steps": [
      {{"action": "<concrete recommended next step>", "owner": "<who — e.g. Hiring Manager, Recruiter>", "timeline": "<e.g. Within 1 week>"}},
      {{"action": "<next step>", "owner": "<owner>", "timeline": "<timeline>"}}
    ]
  }}
}}

Guidelines:
- "dimensions" must have exactly 6 items (used for radar chart)
- "skill_breakdown" should cover 4-6 skills actually discussed in the interview
- "green_flags" should have 3-5 entries with specific transcript evidence
- "red_flags" should have 2-4 entries with specific transcript evidence
- "areas_for_improvement" should have 3-4 actionable suggestions
- "past_experience" should cover 2-4 projects/roles the candidate mentioned
- Use the real-time profile data to inform scores — it was collected live during the interview"""

        response = await self._openai.chat.completions.create(
            model=self._scorecard_model,
            messages=[{"role": "user", "content": scorecard_prompt}],
            temperature=0.3,
            max_tokens=2500,
        )

        try:
            content = _strip_code_fence(
                (response.choices[0].message.content or "{}").strip()
            )
            return json.loads(content)
        except Exception as e:
            return {
                "error": f"Failed to parse scorecard: {e}",
                "raw": response.choices[0].message.content,
            }

    async def aclose(self):
        """Cancel background tasks and release the HTTP client. Call on session end."""
        if self._eval_task and not self._eval_task.done():
            self._eval_task.cancel()
        if self._keepalive_task and not self._keepalive_task.done():
            self._keepalive_task.cancel()
        if self._pending_clean_task and not self._pending_clean_task.done():
            self._pending_clean_task.cancel()
        if self._http_client:
            await self._http_client.aclose()


# ── Helpers ────────────────────────────────────────────────────────────────────

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
