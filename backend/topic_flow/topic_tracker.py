"""
topic_tracker.py - Tracks topic progress, depth counts, and remaining topic queues per interview.

Maintains:
- Current topic & previous topic
- Consecutive follow-up turn count
- Visited & completed topic sets
- Priority queues for remaining topics (Resume -> JD -> Spoken -> Behavioral)
"""

import re
from typing import List, Set, Tuple

_BEHAVIORAL_TOPICS: List[str] = [
    "teamwork & collaboration",
    "handling technical trade-offs & challenges",
    "project ownership & accountability",
    "conflict resolution & feedback",
    "adapting to changing requirements"
]


def _normalize(topic: str) -> str:
    if not topic:
        return ""
    return re.sub(r"\s+", " ", topic.lower().strip())


class TopicSessionState:
    def __init__(self):
        self.current_topic: str = ""
        self.previous_topic: str = ""
        self.consecutive_followups: int = 0
        self.visited_topics: List[str] = []
        self.completed_topics: Set[str] = set()
        
        self.resume_topics: List[str] = []
        self.jd_topics: List[str] = []
        self.candidate_spoken_topics: List[str] = []
        self.behavioral_topics: List[str] = list(_BEHAVIORAL_TOPICS)

    def record_turn(self, target_skill: str, action: str) -> None:
        """Updates topic tracking state for the current turn."""
        norm_target = _normalize(target_skill)
        if not norm_target:
            return

        if self.current_topic and norm_target == _normalize(self.current_topic):
            # Same topic turn
            if action in ("follow_up", "move_deeper", "verify_experience", "challenge_assumption"):
                self.consecutive_followups += 1
        else:
            # Topic changed
            if self.current_topic:
                self.completed_topics.add(_normalize(self.current_topic))
                self.previous_topic = self.current_topic

            self.current_topic = target_skill.strip()
            self.consecutive_followups = 1
            if target_skill.strip() not in self.visited_topics:
                self.visited_topics.append(target_skill.strip())

    def get_next_available_topic(self) -> Tuple[str, bool]:
        """
        Selects next unvisited topic adhering to strict priority rules:
        1. Resume topics
        2. JD topics
        3. Candidate-introduced technologies
        4. Behavioral topics
        Returns (topic_name, is_behavioral_flag).
        """
        # 1. Resume topics
        for t in self.resume_topics:
            if _normalize(t) not in self.completed_topics and _normalize(t) != _normalize(self.current_topic):
                return t, False

        # 2. JD topics
        for t in self.jd_topics:
            if _normalize(t) not in self.completed_topics and _normalize(t) != _normalize(self.current_topic):
                return t, False

        # 3. Candidate-introduced topics
        for t in self.candidate_spoken_topics:
            if _normalize(t) not in self.completed_topics and _normalize(t) != _normalize(self.current_topic):
                return t, False

        # 4. Behavioral topics fallback
        for t in self.behavioral_topics:
            if _normalize(t) not in self.completed_topics and _normalize(t) != _normalize(self.current_topic):
                return t, True

        return "teamwork & project challenges", True


class TopicTrackerStore:
    def __init__(self):
        self._sessions: dict[str, TopicSessionState] = {}

    def get_or_create(self, bot_id: str) -> TopicSessionState:
        if not bot_id:
            bot_id = "default_session"
        if bot_id not in self._sessions:
            self._sessions[bot_id] = TopicSessionState()
        return self._sessions[bot_id]

    def clear_session(self, bot_id: str) -> None:
        if bot_id and bot_id in self._sessions:
            self._sessions.pop(bot_id, None)
