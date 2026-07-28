"""
Timing Manager — pure-Python observer that analyzes elapsed time, topic
coverage, and interview phase to suggest pacing. No LLM. No network.
Observation-only. Never controls the scheduler or planner.
"""

_TOTAL_INTERVIEW_MINUTES = 45.0

DEFAULT: dict = {
    "elapsed_minutes": 0.0,
    "remaining_minutes": _TOTAL_INTERVIEW_MINUTES,
    "phase": "unknown",
    "topics_covered": 0,
    "topics_remaining": 0,
    "pace": "normal",
    "suggestion": "",
}


async def analyze(interview_state: dict) -> dict:
    """Analyze interview timing and suggest pace. Never raises."""
    try:
        elapsed = float(interview_state.get("elapsed_minutes", 0.0))
        remaining = max(0.0, _TOTAL_INTERVIEW_MINUTES - elapsed)
        topics_remaining = len(interview_state.get("topics_remaining", []))
        topics_covered = len(interview_state.get("topics_covered", []))
        phase = interview_state.get("phase", "unknown")

        # Determine pacing suggestion
        if phase == "wrap_up" or elapsed > 42:
            pace = "wrap_up"
            suggestion = "Begin closing the interview."
        elif topics_remaining > 0 and remaining < topics_remaining * 4:
            pace = "accelerate"
            suggestion = f"Only {round(remaining, 0)} min left with {topics_remaining} topics — move faster."
        elif elapsed < 5 and phase in ("greeting", "intro"):
            pace = "normal"
            suggestion = "Early stage — let the candidate settle."
        elif remaining > 20 and topics_remaining <= 1:
            pace = "slow_down"
            suggestion = "Ample time remaining — probe deeper before moving on."
        else:
            pace = "normal"
            suggestion = ""

        return {
            "elapsed_minutes": round(elapsed, 1),
            "remaining_minutes": round(remaining, 1),
            "phase": phase,
            "topics_covered": topics_covered,
            "topics_remaining": topics_remaining,
            "pace": pace,
            "suggestion": suggestion,
        }
    except Exception:
        return DEFAULT.copy()
