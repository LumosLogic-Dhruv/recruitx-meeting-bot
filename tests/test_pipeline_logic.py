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
