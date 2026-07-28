"""
topic_flow.py — lightweight topic-repetition guard for the RecruitX interviewer.

Tracks how many consecutive follow-up turns the interviewer has spent on a
single skill/topic. When the limit is exceeded, signals the pipeline to append
a topic-change directive to the existing Planner context.

Constraints (enforced):
  - Pure Python only
  - No imports from Planner, Director, Brain, or Intelligence packages
  - No OpenAI or any other network calls
  - No async, no database, no external dependencies
  - Every code path returns {"force_topic_change": False, "directive": ""} on failure
"""

_MAX_FOLLOWUPS = 2

_DIRECTIVE = (
    "\n\n------------------------------\n"
    "TOPIC FLOW DIRECTIVE\n\n"
    "The current competency has already been explored sufficiently.\n\n"
    "Do not ask another follow-up on this topic.\n\n"
    "Transition naturally to another relevant competency while maintaining interview flow.\n\n"
    "------------------------------"
)

_SAFE_RETURN = {"force_topic_change": False, "directive": ""}


def evaluate_topic_flow(state: dict, plan: dict) -> dict:
    """
    Evaluate whether the interviewer has spent too many consecutive turns on
    one topic and should be directed to move on.

    Args:
        state: mutable dict stored on the pipeline instance (self._topic_flow).
               Modified in-place. Shape: {"topic": str, "count": int}
        plan:  Planner output dict. Only "next_action" and "target_skill" are read.

    Returns:
        {"force_topic_change": bool, "directive": str}
        directive is non-empty only when force_topic_change is True.
    """
    try:
        next_action  = (plan.get("next_action") or "").strip()
        target_skill = (plan.get("target_skill") or "").strip().lower()

        # Planner chose something other than follow_up — reset and do nothing.
        if next_action != "follow_up":
            state["topic"] = target_skill
            state["count"] = 0
            return _SAFE_RETURN

        current_topic = (state.get("topic") or "").strip().lower()

        if target_skill != current_topic:
            # Topic changed — reset counter, no directive needed.
            state["topic"] = target_skill
            state["count"] = 1
            return _SAFE_RETURN

        # Same topic, follow_up action — increment.
        state["count"] = state.get("count", 0) + 1

        if state["count"] > _MAX_FOLLOWUPS:
            return {"force_topic_change": True, "directive": _DIRECTIVE}

        return _SAFE_RETURN

    except Exception:
        return _SAFE_RETURN
