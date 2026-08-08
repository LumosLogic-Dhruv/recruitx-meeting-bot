"""
scorecard.py — Post-interview LLM analysis.

Called once at session end. Takes the full transcript and returns a structured
scorecard dict. No live interview state required.
"""
from __future__ import annotations

import json


def _strip_code_fence(text: str) -> str:
    if "```" not in text:
        return text
    parts = text.split("```")
    inner = parts[1] if len(parts) >= 2 else text
    if inner.startswith("json"):
        inner = inner[4:]
    return inner.strip()


async def generate_scorecard(
    transcript: str,
    candidate_name: str,
    openai_client,
    scorecard_model: str = "gpt-4o",
    noise_segments_filtered: int = 0,
    topics_covered: list[str] | None = None,
    questions_asked: int = 0,
    elapsed_minutes: float = 0.0,
) -> dict:
    """Generate a structured scorecard from a completed interview transcript.

    Args:
        transcript:              Full "Speaker: text" transcript string.
        candidate_name:          Display name for the candidate.
        openai_client:           AsyncOpenAI instance (caller provides).
        scorecard_model:         Model to use for generation (default gpt-4o).
        noise_segments_filtered: How many STT noise segments were filtered live.
        topics_covered:          List of topic labels covered during the interview.
        questions_asked:         Total questions the bot asked.
        elapsed_minutes:         Interview duration in minutes.
    """
    if not transcript:
        return {"error": "No transcript available"}

    topics_covered = topics_covered or []
    profile_summary = (
        f"Topics covered: {', '.join(topics_covered) or 'none tracked'}\n"
        f"Questions answered: {questions_asked} | "
        f"Duration: {elapsed_minutes:.0f} minutes\n"
    )

    # Summarise long transcripts to keep token count manageable.
    eval_text = transcript
    if len(transcript.split()) > 2000:
        try:
            sum_resp = await openai_client.chat.completions.create(
                model=scorecard_model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Summarize this interview transcript. Focus on the candidate's "
                        "specific answers, technical knowledge shown, communication style, "
                        "and any standout moments:\n\n"
                        f"{transcript}"
                    ),
                }],
                max_tokens=700,
                temperature=0.1,
            )
            eval_text = sum_resp.choices[0].message.content or transcript
        except Exception:
            pass

    noise_notice = ""
    if noise_segments_filtered >= 5:
        noise_notice = (
            f"\n⚠️  NOISY ENVIRONMENT ALERT: {noise_segments_filtered} background-noise "
            f"segments were automatically filtered before reaching this transcript. "
            f"The candidate's audio environment had significant noise (fan, traffic, AC, etc.). "
            f"This means some answers may be shorter than usual (noise masked speech) or "
            f"contain extra garbled words. Weight the candidate's technical knowledge and "
            f"depth of answers more heavily than fluency or sentence completeness.\n"
        )

    scorecard_prompt = f"""You are an expert recruiter evaluating a voice interview conducted by an AI bot.

IMPORTANT — ASR TRANSCRIPT NOTICE:
This transcript was produced by real-time speech-to-text (Deepgram) on a live voice call. It WILL contain garbled technical terms, sentence fragments, filler words, and disfluencies — these are STT artefacts, NOT the candidate's fault. Rules for scoring:
1. Read every answer charitably — infer the most plausible technical meaning from context.
2. Do NOT penalise for garbled words, broken sentences, or repeated phrases from STT errors.
3. If a tech term looks wrong (e.g. "next sales" = Next.js, "dog her" = Docker), use the correct term.
4. Only penalise for genuine lack of knowledge — not for STT noise.{noise_notice}

Candidate: {candidate_name}

Real-Time Profile (collected turn-by-turn):
{profile_summary}

Interview Transcript:
{eval_text}

Generate a comprehensive JSON scorecard. Return ONLY valid JSON, no extra text:
{{
  "candidate_name": "{candidate_name}",
  "overall_score": <1-10 integer>,
  "recommendation": "STRONG HIRE | HIRE | MAYBE | NO HIRE",
  "summary": "<2-3 sentence balanced assessment of the candidate>",
  "dimensions": [
    {{"name": "Communication", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Technical Depth", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Problem Solving", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Cultural Fit", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Enthusiasm", "score": <1-10>, "comment": "<brief evidence-backed comment>"}},
    {{"name": "Experience Relevance", "score": <1-10>, "comment": "<brief evidence-backed comment>"}}
  ],
  "top_strengths": [
    {{"name": "<strongest area>", "score": <1-10>}},
    {{"name": "<second strongest>", "score": <1-10>}}
  ],
  "top_gaps": [
    {{"name": "<main gap>", "score": <1-10>}},
    {{"name": "<second gap>", "score": <1-10>}}
  ],
  "green_flags": [
    "<specific positive observation backed by transcript evidence>",
    "<specific positive observation>",
    "<specific positive observation>"
  ],
  "red_flags": [
    "<specific concern backed by transcript evidence>",
    "<specific concern>"
  ],
  "skill_breakdown": [
    {{"name": "<skill actually discussed>", "score": <1-10>, "description": "<what the candidate specifically said or demonstrated about this skill>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}},
    {{"name": "<skill>", "score": <1-10>, "description": "<evidence>"}}
  ],
  "areas_for_improvement": [
    "<specific actionable improvement with clear rationale>",
    "<specific actionable improvement>",
    "<specific actionable improvement>"
  ],
  "ai_report": {{
    "position_applied": "<role mentioned in conversation or 'Not disclosed'>",
    "years_of_experience": "<estimate from transcript or 'Not specified'>",
    "why_interested": "<candidate's stated reason or 'Not explicitly stated in the transcript'>",
    "past_experience": [
      {{
        "title": "<project or role title>",
        "objectives": ["<key objective or responsibility>"],
        "achievements": ["<specific achievement or result>"]
      }}
    ],
    "technical_skills": [
      {{"name": "<technical skill>", "description": "<evidence from transcript showing this skill>", "verified": true}},
      {{"name": "<technical skill>", "description": "<evidence>", "verified": false}}
    ],
    "soft_skills": [
      {{"name": "<soft skill e.g. Communication>", "description": "<specific behavioral evidence from transcript>", "verified": true}},
      {{"name": "<soft skill>", "description": "<evidence>", "verified": true}}
    ],
    "next_steps": [
      {{"action": "<concrete recommended next step>", "owner": "<who — e.g. Hiring Manager, Recruiter>", "timeline": "<e.g. Within 1 week>"}},
      {{"action": "<next step>", "owner": "<owner>", "timeline": "<timeline>"}}
    ]
  }}
}}

Guidelines:
- "dimensions" must have exactly 6 items (used for radar chart)
- "skill_breakdown" should cover 4-6 skills actually discussed in the interview
- "green_flags" should have 3-5 entries with specific transcript evidence
- "red_flags" should have 2-4 entries with specific transcript evidence
- "areas_for_improvement" should have 3-4 actionable suggestions
- "past_experience" should cover 2-4 projects/roles the candidate mentioned
- Use the real-time profile data to inform scores — it was collected live during the interview"""

    response = await openai_client.chat.completions.create(
        model=scorecard_model,
        messages=[{"role": "user", "content": scorecard_prompt}],
        temperature=0.3,
        max_tokens=2500,
    )

    try:
        content = _strip_code_fence(
            (response.choices[0].message.content or "{}").strip()
        )
        return json.loads(content)
    except Exception as e:
        return {
            "error": f"Failed to parse scorecard: {e}",
            "raw": response.choices[0].message.content,
        }
