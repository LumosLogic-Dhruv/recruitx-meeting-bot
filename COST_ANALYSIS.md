# RecruitX AI — Cost Analysis (Per-Hour Basis)

> **Last Updated:** August 2026  
> **Scope:** One fully active 60-minute AI interview session + always-on infrastructure overhead  
> **Pricing Source:** Official pricing pages fetched August 7, 2026

---

## Full Stack Inventory

| Layer | Service | What It Does |
|-------|---------|-------------|
| Meeting Bot | Recall.ai | Deploys AI bot into Google Meet, captures audio/video |
| Speech-to-Text | Deepgram Nova-3 Multilingual (via Recall.ai) | Real-time candidate speech transcription |
| LLM — Real-time | OpenAI GPT-4o-mini | Planner + Director (generates interview questions) |
| LLM — Evaluation | OpenAI GPT-4o | Per-turn answer quality assessment |
| LLM — Analysis | OpenAI GPT-4o | Scorecard generation + prompt enrichment from JD/CV |
| Text-to-Speech | ElevenLabs Flash V2.5 | Bot voice output (candidate hears AI interviewer) |
| Database | Convex | Real-time DB — candidates, meetings, transcripts, scorecards |
| Video Storage | Cloudinary | Permanent recording storage + CDN delivery to recruiters |
| Calendar | Google Calendar API v3 + Meet API v2 | Create interview slots, send invites, generate Meet links |
| Email | Gmail SMTP (App Password) | Invite, reminders, scorecard email, recruiter summary |
| Infrastructure | Hostinger VPS (KVM 2) | Hosts FastAPI backend + Next.js frontend + Nginx (Docker) |

---

## Official Pricing Reference

| Service | Verified Price (Aug 2026) | Source |
|---------|--------------------------|--------|
| OpenAI GPT-4o | $2.50 / 1M input tokens · $10.00 / 1M output tokens | openai.com/api/pricing |
| OpenAI GPT-4o-mini | $0.15 / 1M input tokens · $0.60 / 1M output tokens | openai.com/api/pricing |
| Recall.ai — Recording | $0.50 / hr (prorated to the second) | recall.ai/pricing |
| Recall.ai — Transcription (built-in) | $0.15 / hr (Deepgram Nova-3 via Recall.ai) | recall.ai/pricing |
| Deepgram Nova-3 Multilingual (direct) | $0.0058 / min streaming = $0.348 / hr | deepgram.com/pricing |
| ElevenLabs Flash V2.5 | 0.5 credits / char · $22 / 121K credits = **$0.09 / 1K chars** | elevenlabs.io/pricing |
| Convex | Free: 1M calls + 0.5GB / month · Overage: $2.20 / 1M calls | convex.dev/pricing |
| Cloudinary | Free: 25 credits / month · Plus: $99 / month (225 credits) · 1 credit = 1 GB storage **or** 1 GB bandwidth | cloudinary.com/pricing |
| Hostinger VPS KVM 2 | $8.79 / mo (2-yr promo) · ~$15.99 / mo (regular) · 2 vCPU, 8 GB RAM, 100 GB NVMe | hostinger.com/vps-hosting |
| Google Calendar / Meet API | Free (within quota) | cloud.google.com/apis |
| Gmail SMTP | Free (App Password) | — |

> **Deepgram note:** No direct Deepgram API calls exist in the codebase. Transcription is handled entirely through Recall.ai's built-in integration, billed at $0.15/hr — cheaper than using a direct Deepgram account ($0.348/hr).

---

## Assumptions for One 60-Minute Interview

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| Interview duration | 60 min | Maximum configured in codebase (`max_duration_hours: 1`) |
| Q&A turns | 15 | Typical: 12-15 question-answer exchanges per session |
| LLM calls per turn | 3 | Planner (gpt-4o-mini) + Director (gpt-4o-mini) + Evaluator (gpt-4o) |
| System prompt size | ~4,000 tokens | Generated interview plan: JD + CV + role-specific instructions |
| Conversation context (avg) | ~1,500 tokens | Grows turn-by-turn; midpoint average used |
| LLM input per turn (mini) | ~5,500 tokens | System prompt + context per turn |
| LLM output per turn (mini) | ~200 tokens | Generated question text |
| LLM input per eval (gpt-4o) | ~3,000 tokens | Candidate answer + rubric + prior turns |
| LLM output per eval (gpt-4o) | ~400 tokens | Evaluation JSON with score, reasoning |
| Bot speech per turn | ~300 chars | Question + acknowledgment + transition |
| Total bot speech | ~4,500 chars | 15 turns × 300 + greeting (~400) + farewell (~150) |
| Video file size | ~150 MB | 60-min MP4 mixed video |
| DB function calls | ~100 | Create/update meeting, candidate, timeline events, scorecard |

---

## Per-Interview Cost Breakdown (60-Minute Session)

### Recall.ai — Meeting Bot + Transcription

| Item | Rate | Duration | Cost |
|------|------|----------|------|
| Bot recording (video + audio capture) | $0.50 / hr | 60 min | **$0.50** |
| Built-in transcription (Deepgram Nova-3 Multilingual) | $0.15 / hr | 60 min | **$0.15** |
| **Recall.ai Subtotal** | | | **$0.65** |

### OpenAI — LLM Calls

| Call Type | Model | Input Tokens | Output Tokens | Cost |
|-----------|-------|-------------|--------------|------|
| Planner + Director (15 turns) | GPT-4o-mini | 82,500 | 3,000 | $0.012 + $0.002 = **$0.014** |
| Per-Turn Evaluator (15 turns) | GPT-4o | 45,000 | 6,000 | $0.113 + $0.060 = **$0.173** |
| Final Scorecard (1×) | GPT-4o | 9,000 | 2,500 | $0.023 + $0.025 = **$0.048** |
| Prompt Enrichment from JD+CV (1×) | GPT-4o | 4,000 | 2,000 | $0.010 + $0.020 = **$0.030** |
| **OpenAI Subtotal** | | 140,500 total | 13,500 total | **$0.265** |

### ElevenLabs — Text-to-Speech

| Item | Characters | Rate | Cost |
|------|-----------|------|------|
| Flash V2.5 bot voice output | ~4,500 chars | $0.09 / 1K chars | **$0.405** |
| **ElevenLabs Subtotal** | | | **$0.41** |

### Cloudinary — Video Storage & CDN

| Item | Size | Credits Used | Cost (Plus Plan) |
|------|------|-------------|-----------------|
| Video upload + managed storage | ~0.15 GB | 0.15 credits | $0.066 |
| CDN bandwidth (recruiter playback) | ~0.15 GB | 0.15 credits | $0.066 |
| **Cloudinary Subtotal** | | 0.30 credits | **$0.13** |

> Free tier (25 credits/month) covers ~83 interviews before any charge kicks in.  
> If within free tier: **$0.00 per interview**.

### Convex, Google APIs, Gmail

| Service | Cost | Reason |
|---------|------|--------|
| Convex DB | $0.00 | ~100 calls/interview; free tier covers 1M calls/month (~10,000+ interviews) |
| Google Calendar API | $0.00 | Well within Google's free quota |
| Google Meet API | $0.00 | Free to create meeting spaces |
| Gmail SMTP | $0.00 | Gmail App Password — no charge |
| **Subtotal** | **$0.00** | |

---

## Per-Interview Cost Summary

| Component | Cost | % of Total |
|-----------|------|-----------|
| Recall.ai (bot + transcription) | $0.65 | 44% |
| ElevenLabs (TTS) | $0.41 | 28% |
| OpenAI (GPT-4o + GPT-4o-mini) | $0.27 | 18% |
| Cloudinary (video, Plus plan) | $0.13 | 9% |
| Convex + Google APIs + Gmail | $0.00 | 0% |
| **Total — 60-min interview** | **$1.46** | 100% |

### By Session Length

| Duration | Recall.ai | ElevenLabs | OpenAI | Cloudinary | **Total** |
|----------|-----------|------------|--------|------------|-----------|
| 30 min | $0.33 | $0.21 | $0.15 | $0.13 | **$0.82** |
| 45 min | $0.49 | $0.31 | $0.21 | $0.13 | **$1.14** |
| 60 min | $0.65 | $0.41 | $0.27 | $0.13 | **$1.46** |

> Recall.ai bills prorated to the second. ElevenLabs scales with how much the bot speaks. OpenAI scales with turns.

---

## Infrastructure Cost — Always-On (Per Hour)

| Component | Spec | Monthly | **Per Hour** |
|-----------|------|---------|-------------|
| Hostinger VPS KVM 2 | 2 vCPU · 8 GB RAM · 100 GB NVMe | $8.79 (promo) / $15.99 (regular) | **$0.012 – $0.022** |

The VPS runs continuously to serve the FastAPI backend, Next.js frontend, Nginx reverse proxy, and APScheduler background jobs (reminders, bot joins, no-show checks).

---

## Blended Cost Per Hour at Different Loads

| Interviews Running Simultaneously | Variable | Fixed Infra | **Total / Hour** |
|----------------------------------|----------|-------------|-----------------|
| 0 — idle system | $0.00 | $0.012 | **$0.01** |
| 1 interview | $1.46 | $0.012 | **$1.47** |
| 2 interviews (concurrent) | $2.92 | $0.012 | **$2.93** |
| 3 interviews (concurrent) | $4.38 | $0.012 | **$4.39** |
| 5 interviews (concurrent) | $7.30 | $0.012 | **$7.31** |

---

## Monthly Cost Projection

### Scenario A — Light Usage (40 interviews / month)
| Component | Cost |
|-----------|------|
| Recall.ai (40 × $0.65) | $26.00 |
| OpenAI (40 × $0.27) | $10.80 |
| ElevenLabs (40 × $0.41) | $16.40 |
| Cloudinary (within 25-credit free tier) | $0.00 |
| Hostinger VPS | $8.79 |
| **Monthly Total** | **~$62** |
| **Per Interview** | **~$1.55** |

### Scenario B — Standard Usage (176 interviews / month, 8/day × 22 days)
| Component | Cost |
|-----------|------|
| Recall.ai (176 × $0.65) | $114.40 |
| OpenAI (176 × $0.27) | $47.52 |
| ElevenLabs (176 × $0.41) | $72.16 |
| Cloudinary Plus plan (flat) | $99.00 |
| Hostinger VPS | $8.79 |
| **Monthly Total** | **~$342** |
| **Per Interview** | **~$1.94** |

### Scenario C — High Usage (500 interviews / month)
| Component | Cost |
|-----------|------|
| Recall.ai (500 × $0.65) | $325.00 |
| OpenAI (500 × $0.27) | $135.00 |
| ElevenLabs (500 × $0.41) | $205.00 |
| Cloudinary Plus plan | $99.00 |
| Hostinger VPS | $8.79 |
| **Monthly Total** | **~$773** |
| **Per Interview** | **~$1.55** |

---

## Cost Optimization Opportunities

| Opportunity | Potential Saving | Tradeoff |
|-------------|-----------------|----------|
| Switch per-turn evaluator to GPT-4o-mini | ~$0.16 / interview (60% of OpenAI cost) | Slightly lower evaluation quality |
| Enable OpenAI prompt caching (system prompt is constant) | ~$0.05 / interview | Minimal implementation effort |
| Cap interview at 45 min by default | ~$0.32 / interview | Slightly shorter sessions |
| Use Recall.ai's built-in transcription (already doing this) | $0.198 / interview saved vs. direct Deepgram | Already optimized |
| Upgrade Cloudinary plan only when >83 interviews/month | Avoids $99/mo until needed | Already noted above |
| Negotiate Recall.ai volume discount (via sales) | 20–40% on recording cost | Requires contract |

---

## Bottom Line

| Metric | Value |
|--------|-------|
| **Cost per 60-min interview** | **$1.46** |
| **Cost per 30-min interview** | **$0.82** |
| **Infrastructure (idle, per hour)** | **$0.012** |
| **System running 1 interview, per hour** | **$1.47** |
| **Monthly (176 interviews, std usage)** | **~$342** |
| **Dominant cost driver** | Recall.ai 44% → ElevenLabs 28% → OpenAI 18% |
| **Effectively free services** | Convex · Google Calendar/Meet · Gmail SMTP |
