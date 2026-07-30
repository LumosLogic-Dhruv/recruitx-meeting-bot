"""
question_guard.py - Main QuestionGuard service interface.

Filters generated interviewer sentences/questions before TTS synthesis starts.
If a duplicate question is detected:
1. Checks if candidate requested clarification (allows 1 repeat).
2. Otherwise rejects duplicate and replaces with a non-repetitive topic question or example prompt.
"""

from typing import List, Optional
from .question_memory import QuestionMemoryStore, QuestionMemory

# Keywords in candidate text indicating a request for clarification
_CLARIFICATION_KEYWORDS = {
    "didn't hear", "did not hear", "could you repeat", "can you repeat", "pardon",
    "say that again", "what did you say", "come again", "repeat the question",
    "sorry what", "didn't catch"
}


def _is_clarification_request(user_text: str) -> bool:
    """Checks if the candidate's last utterance was a request to repeat/clarify."""
    if not user_text:
        return False
    u_lower = user_text.lower()
    return any(kw in u_lower for kw in _CLARIFICATION_KEYWORDS)


class QuestionGuard:
    def __init__(self):
        self._memory_store = QuestionMemoryStore()

    def filter_question(
        self,
        bot_id: str,
        sentence: str,
        user_text: str = "",
        topics_remaining: Optional[List[str]] = None,
    ) -> str:
        """
        Inspects generated sentence/question before TTS starts.
        Returns original sentence if valid.
        Returns a sanitized replacement question if sentence is a duplicate.
        Guaranteed non-throwing (returns original sentence on any error).
        """
        try:
            if not sentence or len(sentence.strip()) < 8:
                return sentence

            mem: QuestionMemory = self._memory_store.get_or_create(bot_id)

            # Check if candidate asked for clarification
            if _is_clarification_request(user_text):
                if mem.can_repeat_for_clarification():
                    print(f"[QuestionGuard] Clarification repeat #1 allowed for bot {bot_id}")
                    return sentence
                print(f"[QuestionGuard] Clarification repeat #2 blocked for bot {bot_id} -> forcing topic switch")

            # Check duplicate against memory
            dup_match = mem.check_duplicate(sentence)
            if dup_match:
                print(f"[QuestionGuard] REJECTED duplicate question: '{sentence[:50]}' (matches prior: '{dup_match[:50]}')")
                
                # Recovery Strategy
                replacement = self._generate_recovery_question(topics_remaining)
                mem.add_question(replacement)
                return replacement

            # Valid new question — store in memory
            mem.add_question(sentence)
            return sentence

        except Exception as e:
            print(f"[QuestionGuard] Warning: check failed (falling back): {e}")
            return sentence

    def _generate_recovery_question(self, topics_remaining: Optional[List[str]] = None) -> str:
        """
        Generates a clean replacement question when a duplicate is caught.
        1. Selects next topic from topics_remaining if available.
        2. Else requests a practical real-world example.
        """
        if topics_remaining:
            for t in topics_remaining:
                if t and len(t.strip()) > 1:
                    return f"Let's move to a new area — could you tell me about your experience with {t.strip()}?"

        return "Could you walk me through a concrete real-world project or example from your recent work?"

    def clear_session(self, bot_id: str) -> None:
        """Clean up memory when interview ends."""
        self._memory_store.clear_session(bot_id)


# Module-level singleton instance
question_guard = QuestionGuard()
