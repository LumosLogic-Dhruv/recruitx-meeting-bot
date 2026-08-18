"""
Unit tests for pure-Python pipeline logic.

Run from the bot-server/backend directory:
    python -m pytest ../tests/test_pipeline_logic.py -v

No external APIs, Convex, or Recall.ai needed.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
import pytest

# ── Minimal stubs so pipeline imports without real credentials ─────────────────

import types

# Stub openai so AsyncOpenAI can be imported
openai_stub = types.ModuleType("openai")
class _FakeAsyncOpenAI:
    def __init__(self, **kw): pass
openai_stub.AsyncOpenAI = _FakeAsyncOpenAI
sys.modules.setdefault("openai", openai_stub)

# Stub httpx
httpx_stub = types.ModuleType("httpx")
class _FakeClient:
    def __init__(self, **kw): pass
httpx_stub.AsyncClient = _FakeClient
sys.modules.setdefault("httpx", httpx_stub)

# Now import the modules under test
import config
from pipeline import (
    ConversationPipeline,
    InterviewState,
    _NOISE_WORDS,
    _TRAILING_WORDS,
    CONFUSION_FALLBACKS,
    _norm_dedup_key,
)
from prompt_builder import build_system_message, MASTER_BEHAVIOR_LAYER


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_pipeline(prompt: str = "Interview an engineer.") -> ConversationPipeline:
    return ConversationPipeline(
        system_prompt=prompt,
        openai_key="test-key",
        elevenlabs_key="",   # no ElevenLabs — TTS falls back to OpenAI stub
    )


# ── Config constants ───────────────────────────────────────────────────────────

class TestConfig:
    def test_silence_constants_ascending(self):
        assert config.SILENCE_SHORT < config.SILENCE_MEDIUM
        assert config.SILENCE_MEDIUM < config.SILENCE_LONG
        assert config.SILENCE_LONG < config.SILENCE_XLONG
        assert config.SILENCE_XLONG < config.SILENCE_INCOMPLETE

    def test_silence_interrupted_fastest(self):
        assert config.SILENCE_INTERRUPTED < config.SILENCE_SHORT

    def test_thinking_pause_positive(self):
        assert 0 < config.THINKING_PAUSE < 2.0

    def test_min_words_positive(self):
        assert config.MIN_WORDS_TO_RESPOND >= 1
        assert config.MIN_WORDS_FOR_SHORT_SILENCE >= 1

    def test_history_limits_sane(self):
        assert config.MAX_HISTORY_MESSAGES < config.COMPRESS_AT_MESSAGES

    def test_confusion_pivot_threshold(self):
        assert config.CONFUSION_PIVOT_THRESHOLD >= 1


# ── Noise detection ────────────────────────────────────────────────────────────

class TestNoiseDetection:
    def setup_method(self):
        self.p = make_pipeline()

    def test_empty_string_is_noise(self):
        assert self.p._is_noise_only("") is True

    def test_pure_filler_is_noise(self):
        assert self.p._is_noise_only("uh") is True
        assert self.p._is_noise_only("um um um") is True
        assert self.p._is_noise_only("hmm") is True
        assert self.p._is_noise_only("mhm") is True

    def test_single_char_is_noise(self):
        assert self.p._is_noise_only("a") is True

    def test_real_speech_not_noise(self):
        assert self.p._is_noise_only("I worked on a React project") is False
        assert self.p._is_noise_only("Hello, can you hear me?") is False

    def test_mixed_filler_and_content_not_noise(self):
        assert self.p._is_noise_only("um, I used Docker") is False

    def test_punctuation_stripped_before_check(self):
        assert self.p._is_noise_only("uh,") is True
        assert self.p._is_noise_only("hmm.") is True


# ── Silence timeout selection ──────────────────────────────────────────────────

class TestAdaptiveTimeout:
    def setup_method(self):
        self.p = make_pipeline()

    def test_interrupted_returns_short_timeout(self):
        self.p._was_interrupted = True
        t = self.p._adaptive_timeout("hello world")
        assert t == config.SILENCE_INTERRUPTED

    def test_few_words_returns_medium_below_threshold(self):
        # 3 words < MIN_WORDS_FOR_SHORT_SILENCE (10) → MEDIUM not SHORT
        # No trailing punctuation → +0.4 extra added
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout("one two three")
        assert t == pytest.approx(config.SILENCE_MEDIUM + 0.4)

    def test_medium_words_returns_medium(self):
        # No trailing punctuation → +0.4 extra added to SILENCE_MEDIUM
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout(" ".join(["word"] * 10))
        assert t == pytest.approx(config.SILENCE_MEDIUM + 0.4)

    def test_medium_words_with_punctuation_exact(self):
        # Sentence ending in '.' → no extra, exact SILENCE_MEDIUM
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout(" ".join(["word"] * 10) + ".")
        assert t == pytest.approx(config.SILENCE_MEDIUM)

    def test_long_response_returns_long(self):
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout(" ".join(["word"] * 25))
        assert t == config.SILENCE_LONG

    def test_very_long_returns_xlong(self):
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout(" ".join(["word"] * 40))
        assert t == config.SILENCE_XLONG

    def test_trailing_word_triggers_incomplete(self):
        self.p._was_interrupted = False
        # sentence ending in "and" → incomplete
        t = self.p._adaptive_timeout(" ".join(["word"] * 15) + " and")
        assert t == config.SILENCE_INCOMPLETE

    def test_enum_promise_triggers_xlong(self):
        self.p._was_interrupted = False
        t = self.p._adaptive_timeout("I worked on three projects")
        assert t == config.SILENCE_XLONG


# ── Closing phrase detection ───────────────────────────────────────────────────

class TestClosingDetection:
    def setup_method(self):
        self.p = make_pipeline()

    def test_strong_signal_triggers_close(self):
        assert self.p._is_interview_closing(
            "Thank you for your time and for sharing your experience. "
            "Our team will be in touch with you shortly regarding the next steps. "
            "You can now leave the call — have a great day!"
        ) is True

    def test_two_weak_signals_trigger_close(self):
        assert self.p._is_interview_closing(
            "Best of luck and goodbye, have a great day!"
        ) is True

    def test_one_weak_signal_does_not_trigger(self):
        assert self.p._is_interview_closing("Goodbye.") is False

    def test_normal_response_does_not_trigger(self):
        assert self.p._is_interview_closing(
            "That's an interesting approach. What were the main trade-offs?"
        ) is False

    def test_partial_phrase_does_not_trigger(self):
        # "in touch" alone is not a strong signal
        assert self.p._is_interview_closing("Keep in touch!") is False

    def test_case_insensitive(self):
        assert self.p._is_interview_closing(
            "THANK YOU FOR YOUR TIME — our team WILL BE IN TOUCH"
        ) is True


# ── Correction detection ───────────────────────────────────────────────────────

class TestCorrectionDetection:
    def setup_method(self):
        self.p = make_pipeline()

    def test_standard_correction(self):
        result = self.p._detect_correction("It's not MySQL, it's PostgreSQL")
        assert result is not None
        old, new = result
        assert "mysql" in old.lower()
        assert "postgresql" in new.lower()

    def test_i_mean_correction(self):
        result = self.p._detect_correction("I mean Kubernetes not Docker")
        assert result is not None
        old, new = result
        assert "docker" in old.lower()
        assert "kubernetes" in new.lower()

    def test_no_correction_in_normal_text(self):
        result = self.p._detect_correction("I used React and TypeScript")
        assert result is None


# ── Clarification detection ────────────────────────────────────────────────────

class TestClarificationDetection:
    def setup_method(self):
        self.p = make_pipeline()

    def test_detected(self):
        assert self.p._is_clarification_response("Could you elaborate on that?") is True
        assert self.p._is_clarification_response("Can you elaborate on that?") is True
        assert self.p._is_clarification_response("Can you clarify what you mean?") is True
        assert self.p._is_clarification_response("Could you clarify that?") is True
        assert self.p._is_clarification_response("Sorry, could you repeat that?") is True

    def test_not_detected_in_normal_question(self):
        assert self.p._is_clarification_response("What trade-offs did you consider?") is False


# ── Thinking pause scaling ─────────────────────────────────────────────────────

class TestThinkingPause:
    def setup_method(self):
        self.p = make_pipeline()

    def test_very_short_answer_fast_response(self):
        pause = self.p._compute_thinking_pause("yes")
        assert pause < 0.5

    def test_long_answer_longer_pause(self):
        short_pause = self.p._compute_thinking_pause("yes")
        long_pause = self.p._compute_thinking_pause(" ".join(["word"] * 100))
        assert long_pause > short_pause

    def test_pause_within_bounds(self):
        for n in [1, 5, 15, 40, 150]:
            p = self.p._compute_thinking_pause(" ".join(["word"] * n))
            assert 0.30 <= p <= 1.20


# ── InterviewState ─────────────────────────────────────────────────────────────

class TestInterviewState:
    def test_initial_phase(self):
        s = InterviewState()
        assert s.current_phase == "greeting"
        assert s.topics_remaining == []
        assert s.topics_covered == []
        assert s.questions_asked == 0

    def test_elapsed_minutes_positive(self):
        s = InterviewState()
        assert s.elapsed_minutes() >= 0.0


# ── Confusion fallbacks ────────────────────────────────────────────────────────

class TestConfusionFallbacks:
    def test_fallbacks_non_empty(self):
        assert len(CONFUSION_FALLBACKS) >= 2

    def test_fallbacks_are_questions_or_pivots(self):
        for fb in CONFUSION_FALLBACKS:
            assert len(fb) > 20


# ── Prompt builder ─────────────────────────────────────────────────────────────

class TestPromptBuilder:
    def test_build_system_message_contains_all_parts(self):
        base = "You are interviewing a React developer."
        state = "Phase: technical\nTurn: 3 of 12\nTopics covered: intro\nTopics remaining: React, testing"
        result = build_system_message(base, state)
        assert MASTER_BEHAVIOR_LAYER in result
        assert base in result
        assert state in result

    def test_master_behavior_layer_has_core_rules(self):
        assert "ONE QUESTION PER RESPONSE" in MASTER_BEHAVIOR_LAYER
        assert "CLOSING" in MASTER_BEHAVIOR_LAYER
        assert "DEPTH CALIBRATION" in MASTER_BEHAVIOR_LAYER
        assert "STT NOISE" in MASTER_BEHAVIOR_LAYER
        assert "TOPIC COVERAGE" in MASTER_BEHAVIOR_LAYER

    def test_order_is_behavior_then_base_then_state(self):
        result = build_system_message("BASE_PROMPT", "STATE_CTX")
        behavior_pos = result.index(MASTER_BEHAVIOR_LAYER[:20])
        base_pos = result.index("BASE_PROMPT")
        state_pos = result.index("STATE_CTX")
        assert behavior_pos < base_pos < state_pos


# ── Regression: duplicate-transcript dedup (ISSUE 1 fix) ──────────────────────

def _words_with_timing(text: str, start: float = 1.0) -> list:
    """Build minimal Recall.ai-format word objects with start_time."""
    return [
        {"text": w, "start_time": round(start + i * 0.3, 3)}
        for i, w in enumerate(text.split())
    ]


def _words_no_timing(text: str) -> list:
    """Word objects without start_time — exercises the text-fallback path."""
    return [{"text": w} for w in text.split()]


class TestDedupNormalization:
    """
    Regression suite for _norm_dedup_key.

    The dual-tone / duplicate-response bug was caused by the webhook and polling
    paths producing slightly different text for the same Deepgram segment (e.g.,
    punctuation added by smart_format, or word expansion like Node → Node.js).
    Both paths now call _norm_dedup_key with the raw word objects; the timestamp-
    based primary key makes the dedup text-independent.
    """

    def test_same_segment_same_timestamp_same_key(self):
        # Identical words and start_time → must produce identical key.
        w = _words_with_timing("I worked with React and Node", start=3.0)
        k1 = _norm_dedup_key("Candidate", w, "I worked with React and Node")
        k2 = _norm_dedup_key("Candidate", w, "I worked with React and Node")
        assert k1 == k2

    def test_punctuation_difference_same_timestamp_same_key(self):
        # Webhook delivers without trailing period; REST API adds it via smart_format.
        webhook_words = _words_with_timing("I worked with React and Node", start=5.0)
        poll_words    = _words_with_timing("I worked with React and Node.", start=5.0)
        k1 = _norm_dedup_key("Candidate", webhook_words, "I worked with React and Node")
        k2 = _norm_dedup_key("Candidate", poll_words,    "I worked with React and Node.")
        assert k1 == k2, f"Punctuation variant produced different keys: {k1!r} vs {k2!r}"

    def test_word_expansion_same_timestamp_same_key(self):
        # "Node" (webhook) vs "Node.js" (REST poll) — same segment start_time.
        webhook_words = _words_with_timing("I worked with React and Node",    start=5.0)
        poll_words    = _words_with_timing("I worked with React and Node.js", start=5.0)
        k1 = _norm_dedup_key("Candidate", webhook_words, "I worked with React and Node")
        k2 = _norm_dedup_key("Candidate", poll_words,    "I worked with React and Node.js")
        assert k1 == k2, f"Word-expansion variant produced different keys: {k1!r} vs {k2!r}"

    def test_different_speakers_yield_different_keys(self):
        w = _words_with_timing("I used React", start=2.0)
        k1 = _norm_dedup_key("Candidate", w, "I used React")
        k2 = _norm_dedup_key("Bot",       w, "I used React")
        assert k1 != k2

    def test_different_start_times_yield_different_keys(self):
        # Two separate turns from the same speaker must not collide.
        w1 = _words_with_timing("I used React", start=5.0)
        w2 = _words_with_timing("I used React", start=45.0)
        k1 = _norm_dedup_key("Candidate", w1, "I used React")
        k2 = _norm_dedup_key("Candidate", w2, "I used React")
        assert k1 != k2

    def test_key_uses_timestamp_prefix(self):
        w = _words_with_timing("hello world", start=3.0)
        key = _norm_dedup_key("Candidate", w, "hello world")
        assert key.startswith("candidate:t3.")

    def test_fallback_text_normalization_strips_punctuation(self):
        # Without timestamps the fallback normalises text — punctuation stripped.
        w1 = _words_no_timing("I used React and Node")
        w2 = _words_no_timing("I used React and Node.")
        k1 = _norm_dedup_key("Candidate", w1, "I used React and Node")
        k2 = _norm_dedup_key("Candidate", w2, "I used React and Node.")
        assert k1 == k2

    def test_fallback_text_normalization_is_case_insensitive(self):
        w1 = _words_no_timing("I used React")
        w2 = _words_no_timing("I used react")
        k1 = _norm_dedup_key("Candidate", w1, "I used React")
        k2 = _norm_dedup_key("Candidate", w2, "I used react")
        assert k1 == k2

    def test_empty_words_falls_back_to_text(self):
        key = _norm_dedup_key("Candidate", [], "hello there")
        assert "hello" in key

    def test_speaker_is_lowercased_in_key(self):
        w = _words_with_timing("hello", start=1.0)
        k1 = _norm_dedup_key("CANDIDATE", w, "hello")
        k2 = _norm_dedup_key("candidate", w, "hello")
        assert k1 == k2


# ── ISSUE 2: effective response latency after timing reductions ────────────────

class TestEffectiveWaitTime:
    """
    Verifies that the combined silence-timeout + thinking-pause for long answers
    is meaningfully shorter than before the fix, while short-answer behaviour
    is unchanged.

    Before fix: SILENCE_XLONG=5.0s + thinking_pause≈0.95-1.15s ≈ 6.0-6.2s
    After fix:  SILENCE_XLONG=3.5s + thinking_pause≈0.75-0.85s ≈ 4.25-4.35s
    """

    def setup_method(self):
        self.p = make_pipeline()

    def _effective_wait(self, text: str) -> float:
        return self.p._adaptive_timeout(text) + self.p._compute_thinking_pause(text)

    def test_short_answer_effective_wait_unchanged(self):
        # Short answers (≤5 words): silence timer + thinking pause should stay fast.
        text = "yes I agree"
        wait = self._effective_wait(text)
        assert wait < 4.0, f"Short answer effective wait {wait:.2f}s is too slow"

    def test_medium_answer_effective_wait_reasonable(self):
        # 10-word answer: SILENCE_MEDIUM + thinking_pause
        text = " ".join(["word"] * 10)
        wait = self._effective_wait(text)
        assert wait < 4.5, f"Medium answer effective wait {wait:.2f}s is too slow"

    def test_long_answer_effective_wait_under_5s(self):
        # 40-word answer: was ~5.95s, must now be under 5.0s
        text = " ".join(["word"] * 40)
        wait = self._effective_wait(text)
        assert wait < 5.0, f"Long answer effective wait {wait:.2f}s — target <5.0s"

    def test_very_long_answer_effective_wait_under_5s(self):
        # 100-word answer: was ~6.15s, must now be under 5.0s
        text = " ".join(["word"] * 100)
        wait = self._effective_wait(text)
        assert wait < 5.0, f"Very long answer effective wait {wait:.2f}s — target <5.0s"

    def test_thinking_pause_order_preserved(self):
        # Longer answers still have a longer thinking pause than shorter ones.
        short_p  = self.p._compute_thinking_pause(" ".join(["word"] * 3))
        medium_p = self.p._compute_thinking_pause(" ".join(["word"] * 15))
        long_p   = self.p._compute_thinking_pause(" ".join(["word"] * 50))
        xlong_p  = self.p._compute_thinking_pause(" ".join(["word"] * 100))
        assert short_p < medium_p < long_p < xlong_p

    def test_thinking_pause_reduced_for_long_answers(self):
        # Was 0.95 for 35-80 words, now 0.75 — verify the cap.
        pause_40  = self.p._compute_thinking_pause(" ".join(["word"] * 40))
        pause_100 = self.p._compute_thinking_pause(" ".join(["word"] * 100))
        assert pause_40  <= 0.80, f"Pause for 40 words = {pause_40:.2f}, expected ≤ 0.80"
        assert pause_100 <= 0.90, f"Pause for 100 words = {pause_100:.2f}, expected ≤ 0.90"
