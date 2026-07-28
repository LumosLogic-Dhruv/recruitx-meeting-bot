"""
Orchestrator — runs all Interview Brain modules in parallel and assembles
the InterviewBrainState. If any module fails its result is replaced with
the module's DEFAULT. If the orchestrator itself fails, DEFAULT_BRAIN_STATE
is returned. Never raises. Never blocks.
"""
import asyncio
from openai import AsyncOpenAI

from .listener            import extract          as _listen
from .semantic_tracker    import track            as _track_semantic,   DEFAULT as _SEM_DEFAULT
from .memory_tracker      import track            as _track_memory,     DEFAULT as _MEM_DEFAULT
from .contradiction_detector import detect        as _detect_contradiction, DEFAULT as _CON_DEFAULT
from .curiosity_engine    import detect           as _detect_curiosity, DEFAULT as _CUR_DEFAULT
from .personality_estimator import estimate       as _estimate_personality, DEFAULT as _PER_DEFAULT
from .confidence_estimator  import estimate       as _estimate_confidence, DEFAULT as _CONF_DEFAULT
from .interview_strategy  import recommend        as _recommend_strategy, DEFAULT as _STR_DEFAULT
from .timing_manager      import analyze          as _analyze_timing,   DEFAULT as _TIM_DEFAULT
from .next_question_predictor import predict      as _predict_next,     DEFAULT as _PRE_DEFAULT
from .response_style      import recommend        as _recommend_style,  DEFAULT as _RST_DEFAULT

DEFAULT_BRAIN_STATE: dict = {
    "semantic_state":  _SEM_DEFAULT.copy(),
    "memory":          _MEM_DEFAULT.copy(),
    "contradictions":  [],
    "curiosity":       [],
    "personality":     _PER_DEFAULT.copy(),
    "confidence":      _CONF_DEFAULT.copy(),
    "strategy":        _STR_DEFAULT.copy(),
    "timing":          _TIM_DEFAULT.copy(),
    "prediction":      _PRE_DEFAULT.copy(),
    "response_style":  _RST_DEFAULT.copy(),
    "listener":        {},
}


async def run(
    openai_client: AsyncOpenAI,
    model: str,
    turn_text: str,
    existing_state: dict,
    interview_state: dict,
) -> dict:
    """
    Run all 11 brain modules in parallel. Returns updated InterviewBrainState.
    Falls back to DEFAULT_BRAIN_STATE on total failure. Never raises.
    """
    try:
        results = await asyncio.gather(
            _listen(turn_text),
            _track_semantic(openai_client, model, turn_text, existing_state),
            _track_memory(openai_client, model, turn_text, existing_state),
            _detect_contradiction(openai_client, model, turn_text, existing_state),
            _detect_curiosity(openai_client, model, turn_text),
            _estimate_personality(openai_client, model, turn_text, existing_state),
            _estimate_confidence(openai_client, model, turn_text),
            _recommend_strategy(openai_client, model, turn_text, existing_state, interview_state),
            _analyze_timing(interview_state),
            _predict_next(openai_client, model, turn_text, existing_state),
            _recommend_style(existing_state),
            return_exceptions=True,
        )

        (
            listener_result,
            semantic_result,
            memory_result,
            contradiction_result,
            curiosity_result,
            personality_result,
            confidence_result,
            strategy_result,
            timing_result,
            prediction_result,
            style_result,
        ) = results

        def _safe(val, default):
            return val if not isinstance(val, Exception) else default

        semantic  = _safe(semantic_result,       existing_state.get("semantic_state", _SEM_DEFAULT.copy()))
        memory    = _safe(memory_result,         existing_state.get("memory",         _MEM_DEFAULT.copy()))
        contra    = _safe(contradiction_result,  _CON_DEFAULT.copy())
        curiosity = _safe(curiosity_result,      _CUR_DEFAULT.copy())
        personal  = _safe(personality_result,    existing_state.get("personality",    _PER_DEFAULT.copy()))
        conf      = _safe(confidence_result,     existing_state.get("confidence",     _CONF_DEFAULT.copy()))
        strategy  = _safe(strategy_result,       _STR_DEFAULT.copy())
        timing    = _safe(timing_result,         _TIM_DEFAULT.copy())
        prediction = _safe(prediction_result,    _PRE_DEFAULT.copy())
        style     = _safe(style_result,          _RST_DEFAULT.copy())
        listener_out = _safe(listener_result,    {})

        # Accumulate contradictions list (append only when detected)
        prev_contradictions = list(existing_state.get("contradictions", []))
        if isinstance(contra, dict) and contra.get("detected"):
            prev_contradictions.append(contra)

        # Accumulate curiosity log (append only when interesting)
        prev_curiosity = list(existing_state.get("curiosity", []))
        if isinstance(curiosity, dict) and curiosity.get("interesting"):
            prev_curiosity.append(curiosity)

        return {
            "semantic_state":  semantic,
            "memory":          memory,
            "contradictions":  prev_contradictions,
            "curiosity":       prev_curiosity,
            "personality":     personal,
            "confidence":      conf,
            "strategy":        strategy,
            "timing":          timing,
            "prediction":      prediction,
            "response_style":  style,
            "listener":        listener_out,
        }

    except Exception as e:
        print(f"[Brain] Orchestrator error (non-fatal): {e}")
        return dict(existing_state) if existing_state else DEFAULT_BRAIN_STATE.copy()
