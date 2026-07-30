"""
allowed_topics.py - Manages the allowed topic set for interview grounding.

A topic is allowed if it originates from:
1. Candidate Resume
2. Job Description (JD)
3. Candidate's own spoken answers during the interview
4. General interview meta-concepts (e.g. background, architecture, debugging)

All lookup operations are pure Python O(1) set operations with string normalization.
"""

import re
from typing import Set, Dict, Iterable

# Universal interview meta-concepts that are always valid interview topics
# (e.g. asking candidate about their "background", "workflow", "challenges")
_META_CONCEPTS: Set[str] = {
    "background", "experience", "work history", "recent project", "projects",
    "role", "responsibilities", "architecture", "system design", "debugging",
    "testing", "problem solving", "challenges", "workflow", "collaboration",
    "teamwork", "leadership", "performance", "optimization", "communication",
    "scaling", "code quality", "best practices", "trade-offs", "accomplishments",
    "technical decision", "daily work", "intro", "introduction", "overview"
}

# Known technical term aliases
_TECH_ALIASES: Dict[str, str] = {
    "react.js": "react",
    "reactjs": "react",
    "node.js": "node",
    "nodejs": "node",
    "express.js": "express",
    "expressjs": "express",
    "vue.js": "vue",
    "vuejs": "vue",
    "next.js": "nextjs",
    "next": "nextjs",
    "nest.js": "nestjs",
    "nestjs": "nestjs",
    "postgres": "postgresql",
    "postgres sql": "postgresql",
    "mongo": "mongodb",
    "aws cloud": "aws",
    "amazon web services": "aws",
    "gcp": "google cloud",
    "google cloud platform": "google cloud",
    "rest api": "rest",
    "restful": "rest",
    "rest apis": "rest",
    "restful apis": "rest",
    "graphql api": "graphql",
    "js": "javascript",
    "ts": "typescript",
    "py": "python",
    "k8s": "kubernetes",
    "docker containers": "docker",
    "docker container": "docker",
}


def normalize_topic(text: str) -> str:
    """Normalize string for fuzzy matching (lowercase, strip punctuation/spaces, map aliases)."""
    if not text:
        return ""
    cleaned = text.lower().strip()
    cleaned = re.sub(r"[^\w\s\-\+\#\.]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return _TECH_ALIASES.get(cleaned, cleaned)


class AllowedTopicStore:
    def __init__(self):
        # Raw original topics added from Resume/JD/Spoken
        self._raw_topics: Set[str] = set()
        # Normalized topic strings for fast O(1) set lookup
        self._normalized_topics: Set[str] = set()
        # Ordered list of primary resume/JD skills for fallback selection
        self._primary_fallback_topics: list[str] = []

    def add_topic(self, topic: str, is_primary: bool = False) -> None:
        """Add a single topic to the allowed set."""
        if not topic or len(topic.strip()) < 2:
            return
        t_clean = topic.strip()
        norm = normalize_topic(t_clean)
        if norm:
            self._raw_topics.add(t_clean)
            self._normalized_topics.add(norm)
            # Also add individual significant words for multi-word skills (e.g. "React Frontend" -> "React")
            for word in t_clean.split():
                norm_w = normalize_topic(word)
                if len(norm_w) >= 3 and norm_w not in {"and", "for", "with", "the", "developer", "engineer"}:
                    self._normalized_topics.add(norm_w)

            if is_primary and t_clean not in self._primary_fallback_topics:
                self._primary_fallback_topics.append(t_clean)

    def add_topics(self, topics: Iterable[str], is_primary: bool = False) -> None:
        """Add multiple topics to the allowed set."""
        for t in topics:
            self.add_topic(t, is_primary=is_primary)

    def is_allowed(self, target_topic: str) -> bool:
        """
        Check if target_topic is grounded in the allowed set.
        Returns True if allowed, False if ungrounded hallucination.
        """
        if not target_topic or not target_topic.strip():
            return True

        norm_target = normalize_topic(target_topic)
        if not norm_target:
            return True

        # Check meta-concepts
        if norm_target in _META_CONCEPTS:
            return True

        # Exact normalized match
        if norm_target in self._normalized_topics:
            return True

        # Substring / Superstring match (e.g., "React.js developer" vs "React")
        for norm_allowed in self._normalized_topics:
            if len(norm_allowed) >= 3:
                if norm_allowed in norm_target or norm_target in norm_allowed:
                    return True

        # Check meta concepts substring
        for meta in _META_CONCEPTS:
            if meta in norm_target or norm_target in meta:
                return True

        return False

    def get_fallback_topic(self) -> str:
        """Return the best available grounded topic from Resume/JD/Spoken topics."""
        if self._primary_fallback_topics:
            return self._primary_fallback_topics[0]
        if self._raw_topics:
            return next(iter(self._raw_topics))
        return "your recent technical projects"

    def get_allowed_summary(self, max_items: int = 12) -> str:
        """Return a clean comma-separated list of allowed topics for LLM context injection."""
        items = self._primary_fallback_topics[:max_items]
        if not items:
            items = list(self._raw_topics)[:max_items]
        return ", ".join(items) if items else "Candidate Resume & Spoken Experience"
