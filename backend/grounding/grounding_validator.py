"""
grounding_validator.py - Validates and sanitizes Planner and Director output.

If Planner attempts to focus on an ungrounded topic (e.g., MERN when MERN is not in Resume/JD/Spoken),
this validator:
1. Replaces the ungrounded target_skill with the nearest allowed topic from Resume/JD/Spoken.
2. Sanitizes next_action if needed (e.g., follow_up -> switch_topic).
3. Appends a strict Grounding Directive to enforce zero-hallucination downstream.
"""

from typing import Tuple, Dict
from .allowed_topics import AllowedTopicStore


def validate_and_sanitize_plan(
    plan: Dict,
    direction: Dict,
    store: AllowedTopicStore
) -> Tuple[Dict, Dict, str]:
    """
    Inspects plan and direction. If ungrounded topics are detected, sanitizes them
    in-place and returns (sanitized_plan, sanitized_direction, grounding_directive_text).
    """
    sanitized_plan = dict(plan) if plan else {}
    sanitized_dir = dict(direction) if direction else {}

    target_skill = sanitized_plan.get("target_skill", "").strip()
    is_target_invalid = bool(target_skill and not store.is_allowed(target_skill))

    if is_target_invalid:
        fallback_topic = store.get_fallback_topic()
        print(f"[Grounding] Rejected ungrounded Planner target_skill '{target_skill}' -> replaced with '{fallback_topic}'")
        
        sanitized_plan["target_skill"] = fallback_topic
        
        # If action was follow_up or move_deeper on hallucinated topic, switch to valid topic
        current_action = sanitized_plan.get("next_action", "")
        if current_action in ("follow_up", "move_deeper", "verify_experience"):
            sanitized_plan["next_action"] = "switch_topic"
            sanitized_plan["reason"] = f"Moving to verified topic: {fallback_topic}"

        # Clean ungrounded interesting points
        if "interesting_points" in sanitized_plan:
            pts = sanitized_plan["interesting_points"]
            if isinstance(pts, list):
                sanitized_plan["interesting_points"] = [
                    p for p in pts if store.is_allowed(str(p))
                ]

    # Validate Director recommendation
    dir_topic = sanitized_dir.get("topic_to_explore", "").strip()
    if dir_topic and not store.is_allowed(dir_topic):
        fallback_topic = store.get_fallback_topic()
        print(f"[Grounding] Rejected ungrounded Director topic '{dir_topic}' -> replaced with '{fallback_topic}'")
        sanitized_dir["topic_to_explore"] = fallback_topic

    dir_focus = sanitized_dir.get("recommended_focus", "").strip()
    if dir_focus and not store.is_allowed(dir_focus):
        sanitized_dir["recommended_focus"] = store.get_fallback_topic()

    # Build strict grounding directive for downstream prompt context
    allowed_summary = store.get_allowed_summary()
    grounding_directive = (
        f"\n\n--- STRICT GROUNDING DIRECTIVE (ZERO HALLUCINATION REQUIREMENT) ---\n"
        f"You MUST ONLY ask about technologies, skills, and projects that originate from the Candidate's Resume, "
        f"Job Description, or Spoken Answers.\n"
        f"VERIFIED ALLOWED TOPICS: {allowed_summary}.\n"
        f"NEVER invent or ask about unmentioned frameworks, stacks (e.g. MERN), or unverified skills.\n"
        f"--- END GROUNDING DIRECTIVE ---"
    )

    return sanitized_plan, sanitized_dir, grounding_directive
