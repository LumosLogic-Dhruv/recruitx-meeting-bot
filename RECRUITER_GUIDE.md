# RecruitX AI Interviewer — Quick Start Guide

---

## What Is RecruitX?

RecruitX is an AI-powered interview bot that joins your video meeting (Google Meet, Zoom, etc.), conducts a live spoken interview with your candidate, and delivers a transcript + scorecard when the session ends — no human interviewer required.

---

## Step 1 — Sign Up & Log In

1. Open the RecruitX web app in your browser.
2. Click **Sign Up**, enter your name, email, and password, then submit.
3. On future visits, click **Log In** with the same credentials.

---

## Step 2 — Prepare an Interview Prompt

The **system prompt** tells the AI how to behave as an interviewer. You have two options:

**Option A — Generate by Role Name**
1. Go to **Dashboard → Prompts → Generate Prompt**.
2. Type the job role (e.g., `Senior Backend Engineer`).
3. Click **Generate** — the AI creates a tailored interviewer prompt and saves it automatically.

**Option B — Generate from CV / Job Description**
1. Go to **Dashboard → Prompts → Generate from Docs**.
2. Upload the candidate's CV and/or the job description (PDF or text).
3. Optionally enter a role name, then click **Generate**.
   The AI reads both documents and builds a prompt that asks about the candidate's actual background.

> **Tip:** Review the generated prompt before starting. You can copy-paste it and edit freely.

---

## Step 3 — Start an Interview

1. Create a video meeting in Google Meet / Zoom and copy the **meeting link**.
2. On the Dashboard, click **Start Interview**.
3. Fill in:
   - **Meeting URL** — paste the meeting link
   - **System Prompt** — paste or type the interviewer prompt from Step 2
   - **Bot Name** *(optional)* — defaults to `RecruitX AI Interviewer`
4. Click **Start**. The bot joins the meeting within 30–60 seconds.

**What happens next:**
- The bot introduces itself and begins the interview.
- It listens to the candidate, asks one question at a time, and adapts based on their answers.
- The interview flows through: **Introduction → Technical Questions → Soft Skills → Wrap-Up**.

> **Note:** You can remain in the meeting to monitor or stay off-call entirely.

---

## Step 4 — End the Interview

1. On the Dashboard, click **End Interview** next to the active session.
2. Enter the **candidate's name** when prompted (used in the scorecard).
3. Click **End**. The bot leaves the meeting and the system:
   - Saves the full transcript
   - Generates a performance scorecard
   - Starts processing the recording (ready in 2–5 minutes)

---

## Step 5 — Review Results

Go to **Dashboard → Past Meetings** and click any completed interview to see:

| Section | What You Get |
|---|---|
| **Transcript** | Full conversation, speaker-labelled |
| **Scorecard** | AI scores across Technical, Communication, and Depth |
| **Recording** | Full video + separate audio tracks (bot / candidate) |

> Recording URLs appear within 2–5 minutes after the interview ends. Refresh the page if not yet available.

---

## Tips for Best Results

- **Short answers:** The bot waits ~0.8 seconds after the candidate stops speaking before responding — this feels natural. Do not cut the call early.
- **Noisy environments:** Ask the candidate to use headphones to reduce echo and improve transcription accuracy.
- **One interview per meeting link:** Starting a second bot on the same URL before ending the first will be blocked. Always end the current session first.
- **Prompt quality matters:** A specific prompt (e.g., "This is for a Python backend role, cover Django, PostgreSQL, and system design") produces sharper, more relevant questions than a generic one.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Bot does not join within 2 minutes | Check the meeting URL is correct and the meeting is live |
| No greeting audio | Ensure the meeting is not muted at the platform level |
| Recording shows "not ready" | Wait 5 minutes and refresh — Recall.ai processes after the call ends |
| "Interview already active" error | End the existing session for that URL before starting a new one |

---

*RecruitX AI Interviewer — Powered by Lumos Logic*
