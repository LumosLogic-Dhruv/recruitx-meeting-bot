"""
intelligence/ — four independent helper components that observe the interview
and maintain structured context. They are READ-ONLY and never affect the
conversation flow. All run in parallel. All fail silently.
"""
import asyncio
from openai import AsyncOpenAI

from .candidate_memory   import update_memory
from .evidence_extractor import extract_evidence
from .curiosity_detector import detect_curiosity
from .candidate_profile  import update_profile, DEFAULT_PROFILE


async def run_all(
    openai_client: AsyncOpenAI,
    model: str,
    answer: str,
    existing_memory: dict,
    existing_evidence: dict,
    existing_profile: dict,
) -> dict:
    """
    Run all four helpers in parallel via asyncio.gather.
    Returns a dict with keys: memory, evidence, curiosity, profile.
    Never raises — all failures are handled internally and returned as defaults.
    """
    try:
        results = await asyncio.gather(
            update_memory(openai_client, model, answer, existing_memory),
            extract_evidence(openai_client, model, answer, existing_evidence),
            detect_curiosity(openai_client, model, answer),
            update_profile(openai_client, model, answer, existing_profile),
            return_exceptions=True,
        )
        memory, evidence, curiosity, profile = results

        return {
            "memory":   memory   if not isinstance(memory,   Exception) else existing_memory,
            "evidence": evidence if not isinstance(evidence, Exception) else (existing_evidence or {}),
            "curiosity":curiosity if not isinstance(curiosity,Exception) else {"interesting": False},
            "profile":  profile  if not isinstance(profile,  Exception) else (existing_profile or DEFAULT_PROFILE.copy()),
        }
    except Exception as e:
        print(f"[Intelligence] run_all error (non-fatal): {e}")
        return {
            "memory":    existing_memory,
            "evidence":  existing_evidence or {},
            "curiosity": {"interesting": False},
            "profile":   existing_profile or DEFAULT_PROFILE.copy(),
        }
