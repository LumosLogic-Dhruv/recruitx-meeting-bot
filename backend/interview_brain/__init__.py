"""
interview_brain/ — passive observation layer for the RecruitX AI interviewer.

Architecture:
  - Read-only. Never controls the interview.
  - Runs via asyncio.create_task() — fire-and-forget.
  - If anything here fails, the interview continues unchanged.
  - The only public API is run() → InterviewBrainState (dict).

Public exports:
  run                 — async entry point called by pipeline._run_brain()
  DEFAULT_BRAIN_STATE — safe fallback returned on total failure
"""
from .orchestrator import run, DEFAULT_BRAIN_STATE

__all__ = ["run", "DEFAULT_BRAIN_STATE"]
