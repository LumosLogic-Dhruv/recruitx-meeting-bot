# AI Interview Automation Ecosystem – Testing Guide

This document provides a comprehensive end-to-end testing checklist to verify all implemented flows for the Candidate, Recruiter, Admin, and the core AI Interview Engine. It maps to the ecosystem features defined in the overarching spec and the system's current Convex database schema and API structure.

## Overall System Flow

```
Recruiter
      │
      ▼
Recruiter Adds Candidate
      │
      ▼
Schedule Interview
      │
      ▼
Meeting Created
      │
      ▼
Candidate Receives Email
      │
      ▼
AI Meeting Bot Joins
      │
      ▼
Candidate Joins
      │
      ▼
Identity Verification
      │
      ▼
AI Interview Starts
      │
      ▼
Conversation Recording
      │
      ▼
AI Evaluation
      │
      ▼
Scorecard Generated
      │
      ▼
Database Storage
      │
      ├─────────────► Candidate Email
      │
      ├─────────────► Recruiter Email
      │
      ▼
Dashboard Updated
      │
      ▼
Weekly Rankings
      │
      ▼
Retry Available After 7 Days (One Time)
      │
      ▼
Second Interview
      │
      ▼
Final Score Generated
      │
      ▼
Final Dashboard + Reports
```

---

## 1. Recruiter Side Testing

### 1.1 Candidate Management
- [ ] **Add Candidate:** As a recruiter, navigate to the Candidate page and add a new candidate. Verify that they appear in the `candidates` table with `recruiterId` properly linked.
- [ ] **Upload JD/Resume:** Check if text extraction or parsing is fully functional and saved to `resumeText`, `skills`, or `notes`.
- [ ] **Candidate Timeline Flow:** Verify that adding a candidate automatically logs an event in the `timeline_events` table (e.g., "Candidate Added").

### 1.2 Scheduling Flow
- [ ] **Schedule Interview:** Use the recruiter dashboard to schedule an interview for a candidate. Select a date/time.
- [ ] **Database Validation:** Check the `scheduledInterviews` table. Ensure `status` is `pending`, `platform` is correct, and `attemptNumber` is logged accurately.
- [ ] **Email Triggers:** Confirm that scheduling generates an invite email (via logs or actual inbox testing) and marks `emailSent` as `true`.

### 1.3 Monitoring & Evaluation
- [ ] **Status Tracking:** Verify that the recruiter dashboard updates to "Meeting Started" and "Interview Completed" appropriately. 
- [ ] **Scorecard Retrieval:** After a completed interview, check the candidate profile to view the generated AI scorecard.
- [ ] **Recording Integration:** Verify that `recordingUrl` and `transcriptUrl` are accessible from the frontend once processing finishes.
- [ ] **Retry visibility:** If a candidate finishes attempt 1, confirm the dashboard accurately displays Attempt 1 results and tracks the 7-day cooldown before Attempt 2 unlocks.

---

## 2. Candidate Flow Testing

### 2.1 Pre-Meeting phase
- [ ] **Invitation & Refreshers:** Confirm receipt of invite email.
- [ ] **Missed Meeting Handling:** Ignore the meeting link. Verify that after the scheduled time + grace period, the `scheduledInterviews` status changes to `no_show` or cancelled, and recruiter gets notified.

### 2.2 Interview Experience
- [ ] **Joining the Interview:** Click the meeting link. Wait for the AI Bot to join.
- [ ] **AI Latency & Realism:** Ensure the latency improvements (streaming TTS, Deepgram endpointing reduction) are active, resulting in conversational turnarounds under 2 seconds.
- [ ] **Network Disconnects:** Drop your internet connection for 5 seconds. Reconnect. Validate that the AI pauses and resumes the context appropriately.
- [ ] **Speech and Silence:** Give a 30-second long answer, and immediately after give a short "Yes". The silence timers should adapt properly without cutting you off.

### 2.3 Post-Meeting
- [ ] **Scorecard Delivery:** After the bot leaves, check if a post-interview email with feedback, strengths, and weaknesses is sent. 
- [ ] **Retry Information:** Verify the post-email clearly states if a retry is available and specifies the 7-day cooldown date.
- [ ] **Second Attempt:** (Mock standard time passing via backend if possible) Wait for cooldown to end and schedule a second attempt. Verify new records do not overwrite Attempt 1. 

---

## 3. Admin Dashboard & Operations Testing

### 3.1 Analytics & Overviews
- [ ] **Global Stats:** Log in as an Admin. Verify the dashboard correctly aggregates today's interviews, completed interviews, missed, and average scores across *all* recruiters.
- [ ] **Leaderboards:** Check the sorting logic for top candidates and weekly performance metrics.

### 3.2 System Fallback & Error Handling
- [ ] **AI Bot Join Failure:** Trigger a false meeting link or restricted meeting room. Validate that the retry-scheduler fails gracefully and notifies the admin dashboard/logs instead of crashing.
- [ ] **LLM Timeout:** Throttle API calls to OpenAI on the backend. Ensure the `stt_fallback` or retry mechanisms trigger without instantly failing the interview.
- [ ] **Double Log-ins / Concurrent Sessions:** Attempt to log in from two separate tabs as the same candidate. Verify that duplicate instances are blocked or handled cleanly.

---

## 4. AI Engine & Backend Quality Assurance (Developer Level)

- [ ] **Connection Pooling:** Monitor logs to ensure `RecallClient` does not establish a new HTTP connection for every `speak()` command.
- [ ] **Topic Tracking Constraint:** Check debug logs (`_build_state_context`) to verify the bot tracks `topics_covered` and naturally progresses through Greeting -> Intro -> Technical -> Behavioral -> Wrap-up.
- [ ] **Memory Growth:** Test with a 30+ turn mock interview. Ensure `_maybe_compress_history()` engages, maintaining context limits while remembering earlier candidate facts.
- [ ] **Transcript Deduplication:** Inject duplicate `transcript.data` events artificially via webhook. Ensure the `_seen_segments` buffer drops them to prevent double responses. 

## End of Flow Verification
To sign off on a release, run a full lifecycle drill: "Recruiter generates JD -> Add Candidate -> Schedule -> Candidate Gets Mail -> Candidate Joins -> AI Conducts Interview -> Candidate Drops randomly and reconnects -> Completes -> Score Generated -> Email Sent to both -> Candidate starts a Re-attempt 7 days later."
