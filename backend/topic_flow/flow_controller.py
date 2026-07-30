"""
flow_controller.py - Intelligent Topic Flow Controller logic.

Evaluates turn depth and forces topic transitions when maximum depth is exceeded.
"""

from typing import Tuple, List, Optional
from .topic_tracker import TopicTrackerStore, TopicSessionState
from .transition_manager import build_transition_directive

_DEFAULT_MAX_DEPTH = 2
_EXTENDED_MAX_DEPTH = 3


def _has_significant_new_info(user_text: str) -> bool:
    """Detects if candidate introduced significant new information in their answer."""
    if not user_text:
        return False
    words = user_text.strip().split()
    if len(words) > 35:
        return True
    lower = user_text.lower()
    return any(kw in lower for kw in ("for example", "specifically", "built", "implemented", "architecture", "instead", "whereas", "however"))


class TopicFlowController:
    def __init__(self):
        self._store = TopicTrackerStore()

    def evaluate_turn(
        self,
        bot_id: str,
        plan: dict,
        user_text: str = "",
        state_topics_remaining: Optional[List[str]] = None,
        state_topics_covered: Optional[List[str]] = None,
        system_prompt: str = "",
    ) -> Tuple[bool, str]:
        """
        Evaluates current turn for topic depth limit.
        Returns (should_transition: bool, transition_directive: str).
        Guaranteed non-throwing.
        """
        try:
            target_skill = (plan.get("target_skill") if plan else "") or ""
            action = (plan.get("next_action") if plan else "") or ""

            if not target_skill or not target_skill.strip():
                return False, ""

            session: TopicSessionState = self._store.get_or_create(bot_id)

            # Sync topics remaining from pipeline state if provided
            if state_topics_remaining and not session.resume_topics:
                session.resume_topics = [t for t in state_topics_remaining if t]

            # Record this turn's target skill & action
            session.record_turn(target_skill, action)

            # Check max depth threshold
            is_new_info = _has_significant_new_info(user_text)
            is_challenge = action in ("challenge_assumption", "verify_experience")

            max_allowed_depth = _EXTENDED_MAX_DEPTH if (is_new_info or is_challenge) else _DEFAULT_MAX_DEPTH

            if session.consecutive_followups > max_allowed_depth:
                # Force Topic Transition
                next_topic, is_behavioral = session.get_next_available_topic()
                directive = build_transition_directive(
                    prev_topic=session.current_topic,
                    next_topic=next_topic,
                    is_behavioral=is_behavioral
                )
                print(f"[TopicFlowController] Depth limit exceeded ({session.consecutive_followups} turns on '{session.current_topic}') -> pivoting to '{next_topic}'")
                return True, directive

            return False, ""

        except Exception as e:
            print(f"[TopicFlowController] Warning: evaluation failed (falling back): {e}")
            return False, ""

    def clear_session(self, bot_id: str) -> None:
        self._store.clear_session(bot_id)


# Module-level singleton instance
topic_flow_controller = TopicFlowController()
