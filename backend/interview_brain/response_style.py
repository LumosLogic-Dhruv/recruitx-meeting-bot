"""
Response Style — pure-Python recommender that suggests the appropriate
interviewer tone based on accumulated personality and confidence signals.
No LLM. No network. Observation-only.
"""

_STYLES = frozenset({
    "professional", "friendly", "challenging", "supportive", "encouraging",
})

DEFAULT: dict = {
    "recommended": "professional",
    "tone": "neutral",
    "rationale": "",
}


async def recommend(existing_state: dict) -> dict:
    """Recommend response style based on current personality/confidence signals. Never raises."""
    try:
        personality = existing_state.get("personality", {})
        confidence = existing_state.get("confidence", {})

        p_confidence = float(personality.get("confidence", 0.5))
        p_stress = float(personality.get("stress", 0.5))
        p_energy = float(personality.get("energy", 0.5))
        p_humility = float(personality.get("humility", 0.5))
        c_score = float(confidence.get("score", 0.5))
        c_specificity = confidence.get("specificity", "medium")
        c_hedging = confidence.get("hedging_level", "medium")

        # Rule-based style recommendation
        if p_stress > 0.7 or c_score < 0.3:
            style = "supportive"
            tone = "warm"
            rationale = "Candidate appears stressed or uncertain — supportive tone reduces pressure."
        elif c_score > 0.8 and c_specificity == "high" and p_confidence > 0.7:
            style = "challenging"
            tone = "assertive"
            rationale = "Candidate is confident and specific — raise the bar with harder probes."
        elif p_energy < 0.3 or c_hedging == "high":
            style = "encouraging"
            tone = "warm"
            rationale = "Low energy or heavy hedging — encouragement may unlock more detail."
        elif p_humility > 0.7 and p_confidence < 0.5:
            style = "friendly"
            tone = "collaborative"
            rationale = "Humble but uncertain — friendly approach keeps the candidate open."
        else:
            style = "professional"
            tone = "neutral"
            rationale = "Balanced signals — maintain steady professional tone."

        return {
            "recommended": style,
            "tone": tone,
            "rationale": rationale,
        }
    except Exception:
        return DEFAULT.copy()
