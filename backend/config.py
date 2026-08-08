"""
config.py — Environment constants and interview timing parameters.

All tuneable numbers live here so they can be found and changed in one place.
Import this module wherever these values are needed.
"""
import os

# ── OpenAI models ──────────────────────────────────────────────────────────────
OPENAI_MODEL          = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_EVAL_MODEL     = os.getenv("OPENAI_EVAL_MODEL", "gpt-4o")
OPENAI_SCORECARD_MODEL = os.getenv("OPENAI_SCORECARD_MODEL", "gpt-4o")
OPENAI_PROMPT_MODEL   = os.getenv("OPENAI_PROMPT_MODEL", OPENAI_MODEL)

# ── ElevenLabs ─────────────────────────────────────────────────────────────────
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "SNr51KAoFWjq7b0L9cRb")

# ── Silence timeout constants (seconds) ────────────────────────────────────────
# Deepgram endpointing=300ms fires a segment after 300ms of audio silence.
# These timers start AFTER Deepgram fires — so they run on top of natural pauses.
SILENCE_SHORT      = 2.0   # 1–5 words   → wait a full breath before responding
SILENCE_MEDIUM     = 2.8   # 6–15 words  → let them finish the thought
SILENCE_LONG       = 3.8   # 16–35 words → long answers need more settle time
SILENCE_XLONG      = 5.0   # 35+ words
SILENCE_INCOMPLETE = 5.5   # sentence ends mid-thought ("and", "the", "so"…)
SILENCE_INTERRUPTED = 0.8  # candidate spoke over bot — respond fast

# Minimum words before SILENCE_SHORT fires.
MIN_WORDS_FOR_SHORT_SILENCE = 10

# Thinking pause before LLM call (makes bot feel human).
THINKING_PAUSE = 0.6

# Delay before processing text buffered during bot speech.
FLUSH_PENDING_DELAY = 2.0

# Minimum words to trigger a response at all.
MIN_WORDS_TO_RESPOND = 3

# Wakeup nudge thresholds.
WAKEUP_MIN_WORDS    = 1
WAKEUP_AFTER_SILENCE = 35  # seconds of bot silence before lowering word threshold

# ── Context window ─────────────────────────────────────────────────────────────
MAX_HISTORY_MESSAGES = 40   # retain the 40 most recent messages (20 exchanges)
COMPRESS_AT_MESSAGES = 50   # trigger compression when non-system messages exceed this

# ── Topic and confusion thresholds ─────────────────────────────────────────────
TOPIC_FOLLOWUP_LIMIT    = 3   # how many turns per topic before advancing
CONFUSION_PIVOT_THRESHOLD = 2  # failed attempts before switching topics
