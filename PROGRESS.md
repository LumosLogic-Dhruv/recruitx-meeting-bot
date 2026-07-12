# RecruitX — Progress & Remaining Work

## Session: 2026-07-12

---

## ✅ What Was Done Today

### Bug Fix 1 — Bot Not Joining Meeting
- **Root cause:** `participant.join` and `participant.leave` were in `realtime_endpoints.events` — Recall.ai rejects these (they are not valid realtime event values, only top-level webhook events)
- **Fix:** Removed them from `recall_client.py` → only `transcript.data` + `transcript.partial_data` remain
- **Secondary bug:** `_scheduled_create_session` in `main.py` was catching the create_bot exception and doing `return` instead of `raise` → scheduler always printed "Bot join succeeded" even when the bot never joined
- **Fix:** Changed `return` → `raise` so the scheduler properly retries and logs failure

### Feature — Candidate Profile Fields (Backend + Convex)
Added 10 new fields to the candidate data model:
- `experienceYears`, `currentCompany`, `currentRole`, `currentCtc`, `expectedCtc`
- `location`, `skills` (array), `education`, `linkedinUrl`, `githubUrl`

**Files changed:**
- `backend/main.py` → `CandidateCreateRequest` + `CandidateUpdateRequest` models updated
- `backend/convex/schema.ts` → `candidates` table updated with new fields
- `backend/convex/candidates.ts` → `create` + `update` mutations updated

**New backend endpoints:**
- `GET /api/candidates/{id}` — fetch single candidate
- `POST /api/candidates/{id}/generate-prompt` — generate tailored AI interview prompt from resume + profile using OpenAI

### Feature — Candidate Data → AI Bot
- `_build_candidate_context()` helper in `main.py` builds a structured block from all profile fields + resume text
- Schedule endpoint (`POST /api/interviews/schedule`) now **automatically prepends** candidate profile + resume to the system prompt before saving to Convex
- AI bot now always has full candidate context at interview time

### Frontend Changes (Partial — needs redesign, see below)
- `frontend/app/recruiter/candidates/[id]/page.tsx` — redesigned with Profile tab + Timeline tab + Generate Prompt panel
- `frontend/app/recruiter/schedule/page.tsx` — added "Generate from Resume" button, candidate snapshot, auto-fill role

---

## ⚠️ Pending Deployment Steps

1. **Convex deploy** (MUST DO before profile saving works):
   ```
   cd backend
   npx convex deploy
   ```
2. **Frontend** — rebuild + redeploy on Render (auto on git push)
3. **Backend Python** — redeploy on Render (auto on git push)

---

## ❌ What's NOT Done Yet — Needs Proper Flow Design

### The Main Remaining Task
The candidate profile + flow needs a **complete redesign**. The current implementation puts profile editing inside the Timeline page (tabbed). User said this is **not the right structure** and wants a **proper flow**.

**User will describe the expected flow tomorrow.**

Key questions to answer:
- When recruiter clicks "Add Candidate" → what happens? (basic quick-add OR full profile form?)
- After adding a candidate → where do they go next?
- Where does the recruiter fill in: experience, education, projects, skills, CTC, resume?
- What does the candidate list/card look like?
- What does the candidate detail/profile page look like?
- How does "Schedule Interview" connect from the candidate profile?
- Is there a separate "Candidate Profile" page vs "Interview History" page?

---

## 📁 Key Files Reference

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI backend — all API endpoints |
| `backend/recall_client.py` | Recall.ai bot creation + webhook events |
| `backend/scheduler.py` | APScheduler — bot join jobs, no-show checks, reminders |
| `backend/pipeline.py` | AI conversation engine (OpenAI + ElevenLabs) |
| `backend/convex/schema.ts` | Convex database schema |
| `backend/convex/candidates.ts` | Candidate CRUD mutations/queries |
| `backend/convex/scheduledInterviews.ts` | Scheduled interview mutations/queries |
| `backend/convex/timeline.ts` | Candidate event timeline |
| `frontend/app/recruiter/add/page.tsx` | Add Candidate + candidate list |
| `frontend/app/recruiter/candidates/[id]/page.tsx` | Candidate detail (profile + timeline) |
| `frontend/app/recruiter/schedule/page.tsx` | Schedule interview form |
| `frontend/app/recruiter/scorecards/page.tsx` | Scorecard dashboard |
| `frontend/app/recruiter/prompts/page.tsx` | Generate + manage AI prompts |
| `frontend/app/admin/page.tsx` | Admin panel (all candidates, analytics, settings) |

---

## 🏗️ Current App Flow (As-Is)

```
Recruiter Login
    │
    ├── Add Candidate (name, email, phone, role, notes)
    │       └── Candidate List → Timeline / Edit / Delete
    │               └── Candidate Detail Page
    │                       ├── [Tab] Profile (editable profile fields)
    │                       ├── [Tab] Timeline (interview history)
    │                       ├── Resume Upload
    │                       └── Generate AI Prompt → copy to Schedule
    │
    ├── Schedule Interview
    │       ├── Select Candidate
    │       ├── Pick Date/Time/Duration
    │       ├── Enter Role
    │       ├── Select/Generate System Prompt
    │       └── → Creates Google Meet + sends email invite + schedules bot
    │
    ├── Scorecards (results after interview)
    │
    └── Generate Prompt (save reusable prompts)
```

---

## 🐛 Known Issues / Observations

- `interviewStatus` for Nehal and Priyanshu still shows `attempt_1_0_scheduled` (the dot-in-status bug from before) — needs status cleanup
- Scorecard shows "0 INTERVIEWS DONE" because the bot was not actually joining (now fixed with Recall event fix)
- "Cooldown (7d)" for Dhruv Shere — was a no-show, cooldown will expire in 7 days
- Admin analytics shows recruiter as "8a8se8" (raw ID) — recruiter name lookup may be broken
