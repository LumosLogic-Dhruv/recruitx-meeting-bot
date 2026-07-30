"""
transition_manager.py - Generates natural transition directives for topic switches.

Prevents abrupt topic jumps by crafting smooth bridge instructions injected into plan context.
Zero prompt file modifications, pure Python templates.
"""

from typing import List

_TRANSITION_TEMPLATES: List[str] = [
    "Thanks for explaining that. Let's move to another area — focus on {next_topic}.",
    "Got it. I'd like to understand another part of your experience now, specifically regarding {next_topic}.",
    "That makes sense. Switching gears a bit, let me ask you about {next_topic}.",
    "Appreciate those details. Now, let's discuss your experience with {next_topic}.",
    "Let's transition to the next topic: {next_topic}."
]

_BEHAVIORAL_TEMPLATES: List[str] = [
    "All technical competencies have been covered. Let's discuss a behavioral or teamwork scenario, specifically around {next_topic}.",
    "Thanks for walking through your technical work. Now, I'd like to ask a situational question about {next_topic}.",
    "Let's move to a behavioral topic regarding {next_topic}."
]


def build_transition_directive(prev_topic: str, next_topic: str, is_behavioral: bool = False) -> str:
    """Builds a natural transition directive string for downstream LLM context."""
    t_clean = next_topic.strip() if next_topic else "the next domain"
    
    if is_behavioral:
        template = _BEHAVIORAL_TEMPLATES[hash(t_clean) % len(_BEHAVIORAL_TEMPLATES)]
    else:
        template = _TRANSITION_TEMPLATES[hash(t_clean) % len(_TRANSITION_TEMPLATES)]

    msg = template.format(prev_topic=prev_topic or "the previous topic", next_topic=t_clean)

    return (
        f"\n\n--- INTELLIGENT TOPIC FLOW DIRECTIVE ---\n"
        f"TOPIC DEPTH EXCEEDED on '{prev_topic or 'current topic'}'.\n"
        f"MUST SWITCH TOPIC NOW.\n"
        f"NATURAL TRANSITION BRIDGE: \"{msg}\"\n"
        f"Do not ask any more follow-up questions about '{prev_topic}'. Focus entirely on '{t_clean}'.\n"
        f"--- END TOPIC FLOW DIRECTIVE ---"
    )
