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
# At 300ms, breathing pauses and mid-clause gaps also trigger segments, so our
# timer must be long enough to accumulate all the fragments of one answer.
# Target: respond ~1.5s after the candidate stops speaking.
# Total per turn = endpointing(300ms) + our timer + LLM(~300ms) + TTS(~75ms).
SILENCE_SHORT      = 0.8   # 1–5 words   → total ~1.1s after candidate stops
SILENCE_MEDIUM     = 1.2   # 6–15 words  → total ~1.5s
SILENCE_LONG       = 2.0   # 16–35 words → total ~2.3s
SILENCE_XLONG      = 3.5   # 35+ words
# 1.8s: was 4.0s which caused 4-5s delays. Indian English speakers frequently end
# sentences with words like "basically", "okay", "yeah" — these are sentence-ENDERS
# not mid-sentence indicators. 1.8s gives enough buffer for genuine trailing words
# (and, but, because) without punishing normal Indian English speech patterns.
SILENCE_INCOMPLETE = 1.8   # sentence ends mid-thought ("and", "the", "because"…)
SILENCE_INTERRUPTED = 0.5  # candidate spoke over bot — respond fast

MIN_WORDS_TO_RESPOND = 4   # ignore stray fragments shorter than this

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

BACKCHANNEL_WORD_THRESHOLD = 15
BACKCHANNEL_MIN_INTERVAL = 6.0
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

8. STT NOISE RULE — this is a real-time voice call and speech-to-text makes mistakes. \
If the candidate's answer is short or garbled, ask ONE gentle follow-up: \
"Could you tell me a bit more about that?" \
Then move on to a new topic regardless. \
NEVER ask for clarification on the same point twice.

8b. CORRECTION RULE — If the candidate says "it's not X" or "I mean Y": \
(a) Immediately acknowledge the corrected term: "Got it, MERN stack." \
(b) NEVER use the old garbled term again in this conversation. \
(c) Ask your next question using the corrected term only.

9. VOICE CALL — STT artifacts: text may have odd spellings or fragments. \
Infer meaning charitably from context. NEVER repeat an unusual or garbled-sounding \
term back to the candidate verbatim. If unsure what was said, use a generic \
follow-up: "Could you tell me a bit more about that?" — never echo the garbled word.

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

        # Confusion loop prevention
        self._confusion_fallback_idx: int = 0

        # Interview state engine
        self._state = InterviewState()
        self._profile = CandidateProfile()
        self._eval_task: asyncio.Task | None = None
        self._topics_initialized: bool = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def set_response_callback(self, callback: Callable[[str, bytes], Awaitable[None]]):
        self._on_response = callback

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
            print(f"[Pipeline] Greeting sent.")
            return audio
        finally:
            self._speaking = False
            self._flush_pending()

    def on_transcript_update(self, text: str, speaker: str = "Candidate"):
        """Called on finalized transcript segments (transcript.data events)."""
        self._pending_text = (self._pending_text + " " + text).strip()
        self._pending_speaker = speaker

        if self._speaking:
            self._was_interrupted = True
            print(f"[Pipeline] Interrupted — buffered: {text[:50]}")
            return

        self._words_since_last_bot += len(text.split())
        self._maybe_schedule_backchannel()
        self._reset_silence_timer()

    def on_partial_transcript(self, speaker: str = "Candidate"):
        """Called on interim transcript segments (transcript.partial_data events).
        Does NOT accumulate text — the final event delivers the clean version.
        Only purpose: reset the silence timer so the AI knows the candidate is
        still speaking and doesn't respond to an incomplete answer."""
        if self._speaking:
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
        if self._pending_text:
            print(f"[Pipeline] Flushing buffered text after bot speech: {self._pending_text[:60]}")
            self._reset_silence_timer()

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
        if self._is_incomplete(text):
            print(f"[Pipeline] Incomplete sentence detected — waiting {SILENCE_INCOMPLETE}s")
            return SILENCE_INCOMPLETE
        words = len(text.split())
        ends_complete = text.rstrip()[-1:] in '.!?' if text.strip() else False
        # Short fragments (≤4 words) without punctuation are likely mid-sentence
        # bursts from 300ms endpointing — give more buffer to accumulate the rest.
        # Medium utterances (5-15 words) without punctuation are usually complete
        # thoughts; nova-3 smart_format just omitted the period. Minimal extra needed.
        if not ends_complete:
            extra = 0.5 if words <= 4 else 0.2
        else:
            extra = 0.0
        if words <= 5:
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
        cleaned_text = await self._clean_transcript(text)
        await self._process_turn(cleaned_text, speaker)

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
        # Wait for the previous answer evaluation to finish (usually already done —
        # the candidate's response takes 10-30s which is far longer than the ~200ms
        # eval call). 1.5s timeout ensures we never stall if eval is somehow slow.
        if self._eval_task and not self._eval_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._eval_task), timeout=1.5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        self._speaking = True
        self._words_since_last_bot = 0
        self._was_interrupted = False
        self._state.questions_asked += 1

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
                    temperature=0.85,
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

            await asyncio.gather(
                asyncio.create_task(llm_producer()),
                asyncio.create_task(start_tts()),
                asyncio.create_task(deliver_tts()),
            )

            full_response = "".join(full_text)
            if full_response:
                self._history.append({"role": "assistant", "content": full_response})
                self._full_transcript.append({"speaker": "AI", "text": full_response})
                print(f"[Pipeline] AI complete: {full_response[:100]}")

                if self._is_clarification_response(full_response):
                    self._state.consecutive_confusion_count += 1
                    print(f"[Pipeline] Clarification #{self._state.consecutive_confusion_count}")
                else:
                    self._state.consecutive_confusion_count = 0

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
                # stability 0.52: slightly above middle keeps the voice consistent
                # across turns while allowing natural pitch variation within a sentence.
                # Lower values (we tried 0.42) make short interview phrases sound erratic.
                "stability": 0.52,
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

        scorecard_prompt = f"""You are an expert recruiter evaluating a voice interview conducted by an AI bot.

IMPORTANT — ASR TRANSCRIPT NOTICE:
This transcript was produced by real-time speech-to-text (Deepgram) during a live call. It may contain:
- Garbled technical terms (e.g. "next sales" = Next.js, "famous project" = company name, "RGS" = some framework)
- Sentence fragments from mid-speech endpointing (a complete answer may appear as 2–3 short lines in sequence)
- Filler words and disfluencies that are normal in spoken conversation

You MUST read the transcript charitably: if a candidate's answer is fragmented or uses unusual spellings for a technical term, infer the most likely correct meaning from context. Do NOT penalise for transcript artefacts — only penalise for genuine lack of knowledge or inability to answer after follow-up questions.

Candidate: {candidate_name}

Real-Time Profile (collected turn-by-turn during the interview):
{profile_summary}

Interview Transcript:
{eval_text}

Generate a JSON scorecard:
{{
  "candidate_name": "{candidate_name}",
  "overall_score": <1-10>,
  "recommendation": "STRONG HIRE | HIRE | MAYBE | NO HIRE",
  "summary": "<2-3 sentence summary of the candidate>",
  "dimensions": [
    {{"name": "<dimension>", "score": <1-10>, "comment": "<brief comment>"}},
    ...
  ],
  "strengths": ["<strength>", ...],
  "concerns": ["<concern>", ...],
  "suggested_next_steps": "<what should happen next>"
}}

Score 4-6 dimensions relevant to what was discussed.
Use the real-time profile data to inform your scores — it was collected live.
Return ONLY valid JSON, no extra text."""

        response = await self._openai.chat.completions.create(
            model=self._scorecard_model,
            messages=[{"role": "user", "content": scorecard_prompt}],
            temperature=0.3,
            max_tokens=800,
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
