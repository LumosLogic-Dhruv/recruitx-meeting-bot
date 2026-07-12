# RecruitX — Progress & Remaining Work

## Session: 2026-07-12 (Part 2 — Full Recruiter Workflow)

---

## ✅ What Was Done

### Complete Recruiter Workflow Redesign

The recruiter flow is now a clean linear pipeline:

```
Add Candidate (+ resume)
     ↓
Candidate Profile (review / edit / manage)
     ↓
Schedule Interview (AI prompt auto-generated)
     ↓
Scorecard (auto-appears after interview)
```

---

### 1. Add Candidate Page (`/recruiter/add`) — Major Redesign
- Form now has **all 15+ profile fields** in sections:
  - Basic Info: Name*, Email*, Phone, Location
  - Professional: Role, Current Company, Current Role, Experience, Current CTC, Expected CTC, Education
  - Online Presence: LinkedIn, GitHub
  - Skills: tag-based input
  - Recruiter Notes
  - **Resume Upload** (NEW): select PDF/DOC/DOCX right on the add form
- Two-step submit: create candidate → upload resume → redirect to profile page
- Candidate list shows company, experience, expected CTC
- Actions: **Profile**, **Schedule**, Delete (no more inline modal editing)
- Sidebar label changed from "Add Candidate" → "Candidates"

### 2. Candidate Profile Page (`/recruiter/candidates/[id]`) — Workflow Guide
- New header card shows **workflow status chips**: Profile ✓ → Resume ✓/✗ → AI Prompt ✓/✗ → Schedule Interview
- Resume upload is inline in the header (no separate card)
- "Candidate Profile" and "Interview Timeline" tabs remain
- "View Scorecards →" link added to tab bar
- "Schedule Interview →" button prominent at top-right
- AI Prompt section: shows "Saved to Profile" badge if prompt exists, button becomes "Regenerate Prompt"

### 3. Schedule Interview Page (`/recruiter/schedule`) — Smart Auto-Flow
- **Step indicators** (1 Select Candidate → 2 Interview Details → 3 Review & Send)
- When candidate is selected:
  - If they have a **saved AI prompt** → auto-loads it (badge: "From saved profile")
  - If they have **no saved prompt** → **auto-generates it from resume + profile** (no manual click needed)
  - Shows "Generating AI interview prompt..." loading state
- Recruiter only needs to fill: Date & Time, Duration, Role (auto-filled), then submit
- Candidate snapshot card shows: name, role, company, experience, resume status, AI prompt status
- Dropdown shows all candidates with their status labels
- Submit button disabled while prompt is generating

### 4. Convex + Backend
- `schema.ts` → added `generatedPrompt: v.optional(v.string())` to candidates table
- `candidates.ts` → added `generatedPrompt` to update mutation
- `main.py` → `generate-prompt` endpoint now **saves the prompt back to the candidate** automatically

---

## ⚠️ Pending Deployment Steps

1. **Convex deploy** (MUST DO — schema changed):
   ```
   cd backend
   npx convex deploy
   ```
2. **Frontend** — rebuild + redeploy on Render (auto on git push)
3. **Backend Python** — redeploy on Render (auto on git push)

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
| `frontend/app/recruiter/add/page.tsx` | Candidates list + comprehensive add form (with resume) |
| `frontend/app/recruiter/candidates/[id]/page.tsx` | Candidate profile — edit, resume, AI prompt, timeline |
| `frontend/app/recruiter/schedule/page.tsx` | Schedule — auto-generates AI prompt from candidate |
| `frontend/app/recruiter/scorecards/page.tsx` | Scorecard dashboard |
| `frontend/components/RecruiterSidebar.tsx` | Recruiter nav sidebar |

---

## 🏗️ Current App Flow (As-Is)

```
Recruiter Login
    │
    ├── Candidates (/recruiter/add)
    │       ├── Add form: all profile fields + resume upload
    │       ├── Submits → creates candidate → uploads resume → opens profile page
    │       └── List: Profile | Schedule | Delete
    │
    ├── Candidate Profile (/recruiter/candidates/[id])
    │       ├── Workflow status: Profile ✓ → Resume ✓ → AI Prompt ✓ → Schedule
    │       ├── [Tab] Profile (all fields editable + save)
    │       ├── [Tab] Timeline (interview history)
    │       ├── Generate AI Prompt (saved to candidate, auto-used when scheduling)
    │       └── "Schedule Interview →" button
    │
    ├── Schedule Interview (/recruiter/schedule)
    │       ├── Select candidate (shows profile card + status)
    │       ├── AI prompt auto-loads from saved OR auto-generates from resume
    │       ├── Fill: Date/Time, Duration (role auto-filled)
    │       └── Submit → Google Meet + email invite + schedules bot
    │
    └── Scorecards (/recruiter/scorecards)
            ├── Stats: total, done, avg score, hire decisions
            └── Table: per candidate with best score, recommendation, View button
```

---

## 🐛 Known Issues

- `interviewStatus` for some old candidates still shows `attempt_1_0_scheduled` — needs status cleanup
- Admin analytics shows recruiter as raw ID — recruiter name lookup may need fixing
