"""
interview_flow/ — topic repetition guard for the RecruitX AI interviewer.

Public API:
    evaluate_topic_flow(state, plan) -> {"force_topic_change": bool, "directive": str}

Rollback: delete this directory and remove the evaluate_topic_flow call from
pipeline.py._process_turn(). No other changes required.
"""
from .topic_flow import evaluate_topic_flow

__all__ = ["evaluate_topic_flow"]
