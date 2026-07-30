"""
question_memory.py - In-memory question history store for interview sessions.

Maintains:
1. List of previously asked interviewer questions for the current session.
2. Clarification request counters for candidate repeats.
Automatically cleared per session upon interview completion.
"""

from typing import List, Dict, Optional
from .similarity import is_duplicate_question


class QuestionMemory:
    def __init__(self):
        # List of raw questions asked in this interview
        self._asked_questions: List[str] = []
        # Count of clarification repeats granted
        self._clarification_count: int = 0

    def add_question(self, question: str) -> None:
        """Store a newly asked question in memory."""
        if question and len(question.strip()) > 5:
            self._asked_questions.append(question.strip())

    def check_duplicate(self, candidate_question: str, threshold: float = 0.80) -> Optional[str]:
        """
        Check candidate_question against stored questions.
        Returns matching existing question string if duplicate detected, else None.
        """
        if not candidate_question or len(candidate_question.strip()) < 5:
            return None

        for existing_q in self._asked_questions:
            if is_duplicate_question(candidate_question, existing_q, threshold=threshold):
                return existing_q
        return None

    def can_repeat_for_clarification(self) -> bool:
        """
        Checks if a clarification repeat is allowed.
        Allows repetition ONCE per interview. Second repetition is blocked.
        """
        if self._clarification_count < 1:
            self._clarification_count += 1
            return True
        return False

    def clear(self) -> None:
        """Clear memory for this session."""
        self._asked_questions.clear()
        self._clarification_count = 0


class QuestionMemoryStore:
    def __init__(self):
        # bot_id -> QuestionMemory
        self._sessions: Dict[str, QuestionMemory] = {}

    def get_or_create(self, bot_id: str) -> QuestionMemory:
        if not bot_id:
            bot_id = "default_session"
        if bot_id not in self._sessions:
            self._sessions[bot_id] = QuestionMemory()
        return self._sessions[bot_id]

    def clear_session(self, bot_id: str) -> None:
        if bot_id and bot_id in self._sessions:
            self._sessions.pop(bot_id, None)
