"""
Test script — inserts a dummy completed interview + scorecard into Convex
and sends both candidate and recruiter emails so you can verify the full flow.

Usage (from backend/ directory):
    python test_scorecard.py

Optionally override email targets:
    python test_scorecard.py --candidate-email jane@example.com --recruiter-email dhruv@lumoslogic.com
"""

import asyncio
import argparse
import os
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from convex import ConvexClient
import google_auth as gauth
import email_templates as et

# ── Config ────────────────────────────────────────────────────────────────────

CONVEX_URL = os.getenv("CONVEX_URL", "")
if not CONVEX_URL:
    sys.exit("ERROR: CONVEX_URL not set in .env")

convex = ConvexClient(CONVEX_URL)

# ── Dummy Data ────────────────────────────────────────────────────────────────

DUMMY_SCORECARD = {
    "overall_score": 7,
    "recommendation": "HIRE",
    "candidate_name": "Priya Sharma",
    "summary": (
        "Priya demonstrated strong full-stack development skills with practical experience "
        "in React and Node.js. She communicated clearly and showed good problem-solving ability. "
        "A confident candidate who would be a solid addition to the engineering team."
    ),
    "dimensions": [
        {"name": "Technical Skills",    "score": 8, "comment": "Solid knowledge of MERN stack; explained architecture decisions well."},
        {"name": "Communication",       "score": 7, "comment": "Clear and structured. Occasionally verbose but always on-topic."},
        {"name": "Problem Solving",     "score": 7, "comment": "Walked through debugging approach logically. Good use of examples."},
        {"name": "Domain Knowledge",    "score": 6, "comment": "Strong frontend knowledge; backend awareness is developing."},
        {"name": "Confidence",          "score": 8, "comment": "Answered questions without hesitation; comfortable with follow-ups."},
        {"name": "Soft Skills",         "score": 7, "comment": "Collaborative mindset; mentioned team contribution frequently."},
    ],
    "green_flags": [
        "Strong hands-on React experience with real production projects",
        "Proactively mentioned performance optimisation without being asked",
        "Demonstrated clear ownership of past projects",
    ],
    "red_flags": [
        "Limited experience with system design at scale",
        "No exposure to containerisation / Docker",
    ],
    "skill_breakdown": [
        {"name": "React / Next.js",  "score": 9, "description": "Built and deployed multiple production-grade React apps."},
        {"name": "Node.js / Express","score": 7, "description": "Built REST APIs; less experience with microservices."},
        {"name": "MongoDB",          "score": 7, "description": "Used Mongoose in projects; understands indexing basics."},
        {"name": "TypeScript",       "score": 6, "description": "Familiar but not deeply practiced — mostly JavaScript."},
        {"name": "System Design",    "score": 5, "description": "Could articulate basic patterns but struggled with scale."},
        {"name": "Testing",          "score": 6, "description": "Uses Jest; limited E2E testing experience."},
    ],
    "top_strengths": [
        {"name": "React / Next.js",  "score": 9},
        {"name": "Confidence",       "score": 8},
        {"name": "Technical Skills", "score": 8},
    ],
    "top_gaps": [
        {"name": "System Design",    "score": 5},
        {"name": "TypeScript",       "score": 6},
        {"name": "Testing",          "score": 6},
    ],
    "areas_for_improvement": [
        "Invest time in system design fundamentals (CAP theorem, sharding, caching strategies)",
        "Learn Docker / Kubernetes basics for deployment awareness",
        "Deepen TypeScript knowledge — strict mode, generics, utility types",
    ],
}

DUMMY_TRANSCRIPT = [
    {"speaker": "RecruitX AI", "text": "Hey, thanks for joining! I'm RecruitX AI. So just to kick things off — tell me a bit about yourself and what you've been working on lately."},
    {"speaker": "Priya Sharma", "text": "Hi! I'm Priya, a full-stack developer with about 3 years of experience. I've mostly been working on React and Node.js projects — recently I built a dashboard for a logistics company where I handled everything from the frontend design to the API layer."},
    {"speaker": "RecruitX AI", "text": "That makes sense. What kind of scale were you dealing with on that dashboard — how many users or data points?"},
    {"speaker": "Priya Sharma", "text": "Around 500 daily active users and we were ingesting about 50,000 rows of shipment data per day. We used MongoDB with some indexing on the status and date fields to keep queries fast."},
    {"speaker": "RecruitX AI", "text": "Got it. And how did you handle state management on the frontend for something that real-time?"},
    {"speaker": "Priya Sharma", "text": "We used React Query for server state and Zustand for local UI state. We had WebSocket updates coming in for live shipment tracking and React Query's refetch intervals handled the rest."},
    {"speaker": "RecruitX AI", "text": "Interesting. What's your experience with TypeScript — did you use it on that project?"},
    {"speaker": "Priya Sharma", "text": "We started with JavaScript and added TypeScript partway through. I'm comfortable with basic types and interfaces but I haven't gone deep into generics or utility types yet — that's something I'm actively learning."},
    {"speaker": "RecruitX AI", "text": "Sure, okay. Tell me about a technical challenge you had to debug in production — what was it and how did you approach it?"},
    {"speaker": "Priya Sharma", "text": "We had a memory leak in our Node.js server — the heap kept growing. I used Node's built-in profiler and found that we were creating new event listeners inside a loop without removing them. Once I identified it, the fix was straightforward but finding it took about a day."},
    {"speaker": "RecruitX AI", "text": "Right, good approach. Last question — how do you typically work within a team when you disagree with a technical decision?"},
    {"speaker": "Priya Sharma", "text": "I'd raise my concern with data or a specific example, listen to the other side, and if the team decides to go a different way I support that decision fully. I think healthy debate is good as long as you commit to the outcome together."},
    {"speaker": "RecruitX AI", "text": "Makes sense. Thanks Priya — that's everything from my end. Our team will be in touch with next steps. Good luck!"},
    {"speaker": "Priya Sharma", "text": "Thank you so much! It was a pleasure."},
]

# ── Main ──────────────────────────────────────────────────────────────────────

async def run(candidate_email: str, recruiter_email: str):
    company = os.getenv("COMPANY_NAME", "LumosLogic")

    print(f"\n{'='*60}")
    print(f"  RecruitX — Test Scorecard Script")
    print(f"  Candidate email : {candidate_email}")
    print(f"  Recruiter email : {recruiter_email}")
    print(f"  Convex          : {CONVEX_URL}")
    print(f"{'='*60}\n")

    # 1 ── Insert dummy meeting into Convex ────────────────────────────────────
    print("Step 1: Inserting dummy meeting into Convex...")
    try:
        meeting_id = convex.mutation("meetings:create", {
            "meetingUrl": "https://meet.google.com/test-dummy-abc",
            "candidateName": "Priya Sharma",
            "botName": "RecruitX AI",
            "transcript": DUMMY_TRANSCRIPT,
            "scorecard": DUMMY_SCORECARD,
            "botId": "dummy-bot-id-001",
            "interviewStatus": "completed",
            "recruiterId": "",
            "roleName": "Full Stack Developer",
            "attemptNumber": 1,
        })
        print(f"  ✓ Meeting created  → ID: {meeting_id}")
    except Exception as e:
        print(f"  ✗ Failed to insert meeting: {e}")
        return

    # 2 ── Load SMTP config ────────────────────────────────────────────────────
    print("\nStep 2: Loading SMTP config from Convex + env fallback...")
    smtp_config = {}
    try:
        smtp_config = convex.query("settings:get", {"key": "smtp_config"}) or {}
    except Exception:
        pass

    # Fallback to env vars
    if not smtp_config.get("user"):
        smtp_config["user"]     = os.getenv("SMTP_USER", "")
        smtp_config["password"] = os.getenv("SMTP_PASS", "")
        smtp_config["host"]     = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_config["port"]     = int(os.getenv("SMTP_PORT", "587"))

    if not smtp_config.get("user") or not smtp_config.get("password"):
        print("  ✗ No SMTP credentials found. Set SMTP_USER / SMTP_PASS in .env")
        print("    Skipping email sends — but Convex record was created.")
        return

    print(f"  ✓ SMTP: {smtp_config.get('user')} via {smtp_config.get('host', 'smtp.gmail.com')}")

    # 3 ── Send candidate scorecard email ─────────────────────────────────────
    print(f"\nStep 3: Sending scorecard email to candidate ({candidate_email})...")
    try:
        html_cand = et.build_scorecard_email(
            candidate_name="Priya Sharma",
            scorecard=DUMMY_SCORECARD,
            role_name="Full Stack Developer",
            attempt_number=1,
            retry_in_days=7,
        )
        await gauth.send_email_smtp_generic(
            to_email=candidate_email,
            to_name="Priya Sharma",
            subject=f"Your Interview Scorecard — Full Stack Developer at {company}",
            html_body=html_cand,
            smtp_config=smtp_config,
        )
        print(f"  ✓ Candidate scorecard email sent to {candidate_email}")
    except Exception as e:
        print(f"  ✗ Candidate email failed: {e}")

    # 4 ── Send recruiter summary email ───────────────────────────────────────
    print(f"\nStep 4: Sending recruiter summary email to recruiter ({recruiter_email})...")
    frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    dashboard_url = f"{frontend_url}/admin" if frontend_url else ""
    try:
        html_rec = et.build_recruiter_summary_email(
            recruiter_name="Recruiter",
            candidate_name="Priya Sharma",
            role_name="Full Stack Developer",
            attempt_number=1,
            scorecard=DUMMY_SCORECARD,
            interview_status="completed",
            recording_url="",
            dashboard_url=dashboard_url,
        )
        await gauth.send_email_smtp_generic(
            to_email=recruiter_email,
            to_name="Recruiter",
            subject=f"[{company}] Interview Result — Priya Sharma (Full Stack Developer)",
            html_body=html_rec,
            smtp_config=smtp_config,
        )
        print(f"  ✓ Recruiter summary email sent to {recruiter_email}")
    except Exception as e:
        print(f"  ✗ Recruiter email failed: {e}")

    # 5 ── Summary ─────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  Done!")
    print(f"  Convex meeting ID : {meeting_id}")
    print(f"  Admin dashboard   : {dashboard_url or 'set FRONTEND_URL in .env'}")
    print()
    print("  What to check:")
    print("  1. Admin panel → Weekly Top  (score: 7, HIRE)")
    print("  2. Admin panel → All Candidates → 'Priya Sharma'")
    print("  3. Admin panel → Analytics → load stats")
    print("  4. Candidate inbox → scorecard email with dimensions + retry note")
    print("  5. Recruiter inbox → summary email with score + dashboard link")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-email", default=os.getenv("SMTP_USER", "test@example.com"),
                        help="Email address to receive candidate scorecard")
    parser.add_argument("--recruiter-email", default=os.getenv("SMTP_USER", "test@example.com"),
                        help="Email address to receive recruiter summary")
    args = parser.parse_args()

    asyncio.run(run(
        candidate_email=args.candidate_email,
        recruiter_email=args.recruiter_email,
    ))
