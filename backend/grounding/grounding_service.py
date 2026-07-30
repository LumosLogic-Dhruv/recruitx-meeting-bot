"""
grounding_service.py - High-level service managing session stores and turn grounding.

Provides a robust, exception-safe single entry point for pipeline.py integration.
"""

from typing import Dict, Tuple, Optional
from .allowed_topics import AllowedTopicStore
from .memory_updater import initialize_memory_from_prompt, update_memory_from_candidate
from .grounding_validator import validate_and_sanitize_plan


class GroundingService:
    def __init__(self):
        # bot_id -> AllowedTopicStore
        self._stores: Dict[str, AllowedTopicStore] = {}

    def get_or_create_store(self, bot_id: str) -> AllowedTopicStore:
        """Get or initialize AllowedTopicStore for a bot_id."""
        if not bot_id:
            bot_id = "default_session"
        if bot_id not in self._stores:
            self._stores[bot_id] = AllowedTopicStore()
        return self._stores[bot_id]

    def ground_turn(
        self,
        bot_id: str,
        system_prompt: str,
        profile_skills: list,
        profile_tech: list,
        topics_remaining: list,
        topics_covered: list,
        user_text: str,
        plan: dict,
        direction: dict,
    ) -> Tuple[dict, dict, str]:
        """
        Main entry point called by pipeline.py.
        Grounds Planner and Director decisions against Resume, JD, and Spoken history.
        Guaranteed to never raise an exception — returns ungrounded input on any failure.
        """
        try:
            store = self.get_or_create_store(bot_id)

            # Seeding on initial calls
            if len(store._raw_topics) == 0:
                initialize_memory_from_prompt(
                    store,
                    system_prompt=system_prompt,
                    topics_remaining=topics_remaining,
                    topics_covered=topics_covered,
                )

            # Update from candidate's latest spoken answer & profile
            update_memory_from_candidate(
                store,
                user_text=user_text,
                profile_skills=profile_skills,
                profile_tech=profile_tech,
            )

            # Validate and sanitize Planner & Director decisions
            sanitized_plan, sanitized_dir, directive = validate_and_sanitize_plan(
                plan=plan,
                direction=direction,
                store=store,
            )

            return sanitized_plan, sanitized_dir, directive

        except Exception as e:
            print(f"[GroundingService] Warning: grounding check encountered an error (falling back): {e}")
            return plan, direction, ""

    def clear_session(self, bot_id: str) -> None:
        """Clean up store when session ends."""
        if bot_id:
            self._stores.pop(bot_id, None)


# Module-level singleton instance
grounding_service = GroundingService()
