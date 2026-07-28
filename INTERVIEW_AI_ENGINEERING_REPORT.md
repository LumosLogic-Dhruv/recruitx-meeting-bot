# RecruitX AI — Engineering Review

**Date:** 2026-07-28 | **Scope:** `pipeline.py`, `main.py`, `interview_brain/`, `intelligence/`

---

## Strengths (Do Not Touch)

- Adaptive silence timing (SILENCE_SHORT → XLONG)
- Parallel Planner + Director — combined ~0.8s latency
- ASR cleaning during silence window — zero latency cost
- Sentence-level TTS streaming — N+1 synthesizes while N plays
- ElevenLabs: eleven_flash_v2_5, streaming, latency=4
- 11 brain modules running in parallel, fire-and-forget
- STT noise filtering, deduplication, correction detection

---

## Why It Still Feels Robotic

### 1. Brain Observes Everything, Controls Nothing *(Critical)*
11 brain modules run every turn — confidence, stress, response style, contradictions, next question prediction, curiosity signals. All results land in `self._brain_state` (`pipeline.py:1725`) and are **never read again**. The interviewer always behaves identically regardless of what the brain detected.

### 2. Uniform Thinking Pause
`THINKING_PAUSE = 0.6` fires on every turn — a two-word answer and a 90-second architecture explanation both get 0.6s. Humans pause proportionally to what they just heard. This is one of the strongest detectable robot tells.

### 3. Rigid Response Structure
Every response follows `[reference] + [question]`. After 3–4 turns the pattern is predictable: "You mentioned X — how did Y?" Real interviewers vary their openers, sometimes leading with the question, sometimes bridging with a transition.

### 4. Phase Transitions Are Invisible
When the phase advances (technical → behavioral), the bot starts asking behavioral questions with zero bridge. Human interviewers signal the shift: "Let me move to how you work with people..."

### 5. Contradiction Detector Is Silent
`orchestrator.py:95` appends contradictions to `_brain_state["contradictions"]`. Nothing reads this list. The bot never probes a contradiction even though the brain already caught it.

### 6. Closing Is Scripted and Generic
The closing ignores all accumulated session data — `_state.strengths`, `_profile.skills_detected`, `_state.topics_covered`. The goodbye sounds like a form, not the end of a real conversation.

### 7. Keepalive Nudge Is Jarring
Single fixed string after 35s: *"Are you still there? Please go ahead whenever you're ready."* — reads like a session timeout alert.

### 8. Curiosity / Evidence / Next-Q Prediction — All Discarded
`_intel_curiosity_log`, `_intel_evidence`, `_brain_state["prediction"]` accumulate across every turn and are never surfaced to the Planner or Director.

---

## Latency Audit

| Stage | Typical | Worst |
|---|---|---|
| Deepgram endpointing | 300ms | 300ms |
| Recall.ai → webhook | ~100ms | ~400ms |
| Adaptive silence timer | 2.0–5.5s | 5.5s |
| THINKING_PAUSE (fixed) | 600ms | 600ms |
| Planner + Director (parallel) | ~400–600ms | ~1.5s |
| LLM TTFT (gpt-4o-mini stream) | ~350–500ms | ~800ms |
| ElevenLabs TTFA | ~100ms | ~300ms |
| Recall.ai speak() + Meet buffer | ~200ms | ~600ms |
| **Total (silence fires → first audio)** | **~1.2–1.8s** | **~3.5–5s** |

**Target:** < 1.0s average, < 2.5s p99
**Achievable with Phase 1:** ~0.9–1.3s average

---

## Roadmap

### Phase 1 — Quick Wins (No flags, < 30 lines each, immediate rollback)

| # | Change | File | Effort | Impact |
|---|---|---|---|---|
| P1-A | Feed `_brain_state` (stress, style) into `_build_state_context()` | `pipeline.py:1103` | 2–3h | High |
| P1-B | Variable thinking pause: 0.3s / 0.6s / 0.9s / 1.2s by word count | `pipeline.py:1195` | 30m | High |
| P1-C | Phase transition bridge injected into state context on phase change | `pipeline.py:1060` | 30m | Medium |
| P1-D | Keepalive nudge rotation (4 strings instead of 1) | `pipeline.py:488` | 15m | Low |
| P1-E | Inject latest contradiction into Planner context | `pipeline.py:968` | 1h | High |
| P1-F | Improve `move_deeper` guide: ask WHY/HOW not WHAT | `pipeline.py:978` | 20m | Medium |
| P1-G | Add response structure variation rule to `_RULES_PREFIX` (3 rotating patterns) | `pipeline.py:96` | 1h | Medium |

**Week 1 total: ~7–8 hours**

---

### Phase 2 — Medium (Feature flags, isolated)

| # | Change | Flag | Effort | Impact | Risk |
|---|---|---|---|---|---|
| P2-A | Brain snapshot → Director context | `BRAIN_DIRECTOR_FEEDBACK` | 3–4h | High | Low |
| P2-B | `_brain_state["prediction"]` as optional Planner hint | `BRAIN_PREDICTION_HINTS` | 2h | Medium | Low |
| P2-C | `_intel_curiosity_log` surfaced to Planner | `CURIOSITY_FOLLOWUPS` | 3–4h | High | Medium |
| P2-D | Adaptive ElevenLabs stability (0.52 / 0.65 / 0.72) by brain style | `ADAPTIVE_VOICE` | 2–3h | Medium | Low |
| P2-E | Personalized closing using `_state.strengths` + `_profile.skills_detected` | `PERSONALIZED_CLOSE` | 2h | Medium | Low |

> Validate P2-C on 5 real transcripts before enabling — false positives from curiosity detector can derail the interview.

---

### Phase 3 — Advanced (Only after Phase 1+2 data)

| # | Change | Risk | Notes |
|---|---|---|---|
| P3-A | Backchannel prefix ("Right.") as part of main response, not separate speak() | Low | Staging test first |
| P3-B | Graduated silence recovery (8s wait → 15s nudge → 25s rephrase → 35s pivot) | Low | Replaces single keepalive |
| P3-C | SSML prosodic markers in ElevenLabs payload | Medium | Confirm eleven_flash_v2_5 support |
| P3-D | Semantic silence: extend timer when brain detects mid-reasoning | Medium | Needs semantic_tracker enhancement |

---

## Summary

| Metric | Now | Target | With P1 |
|---|---|---|---|
| Avg response latency | 1.2–1.8s | < 1.0s | ~0.9–1.3s |
| Brain signals utilized | 0 / 11 | 6+ | 4–6 |
| Thinking pause variation | Fixed 0.6s | 0.3–1.2s | Full range |
| Response structure patterns | 1 | 3 rotating | 3 |
| Contradiction surfacing | 0% | > 80% | ~100% |
| Personalized closing | 0% | 100% | 100% (P2-E) |

---

## The Single Most Important Finding

The brain already runs 11 modules per turn at zero latency cost. Their output is computed, stored, and ignored. **Closing the loop between brain state and the interviewer (P1-A + P2-A) requires no new API calls, no new latency, and no architecture change — and will produce the largest single improvement in perceived naturalness.**

Everything else is incremental. This one is structural.
