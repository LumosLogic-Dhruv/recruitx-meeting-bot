import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Canonical event types — keep in sync with main.py EVENT_TYPES constant
export const EVENT_TYPES = {
  CANDIDATE_ADDED:      "candidate_added",
  RESUME_UPLOADED:      "resume_uploaded",
  INTERVIEW_SCHEDULED:  "interview_scheduled",
  EMAIL_INVITE_SENT:    "email_invite_sent",
  EMAIL_REMINDER_24H:   "email_reminder_24h",
  EMAIL_REMINDER_1H:    "email_reminder_1h",
  BOT_JOINED:           "bot_joined",
  BOT_JOIN_FAILED:      "bot_join_failed",
  CANDIDATE_JOINED:     "candidate_joined",
  CANDIDATE_LEFT:       "candidate_left",
  CANDIDATE_REJOINED:   "candidate_rejoined",
  INTERVIEW_STARTED:    "interview_started",
  INTERVIEW_ENDED:      "interview_ended",
  NO_SHOW:              "no_show",
  SCORE_GENERATED:      "score_generated",
  SCORECARD_EMAIL_SENT: "scorecard_email_sent",
  RECRUITER_EMAIL_SENT: "recruiter_email_sent",
  COOLDOWN_STARTED:     "cooldown_started",
  RETRY_ENABLED:        "retry_enabled",
  RETRY_SCHEDULED:      "retry_scheduled",
  FINAL_RESULT:         "final_result",
  INTERVIEW_CANCELLED:  "interview_cancelled",
} as const;

export const log = mutation({
  args: {
    candidateId: v.string(),
    eventType: v.string(),
    actor: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("timeline_events", {
      candidateId: args.candidateId,
      eventType: args.eventType,
      timestamp: Date.now(),
      actor: args.actor,
      metadata: args.metadata,
    });
  },
});

export const listByCandidate = query({
  args: { candidateId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("timeline_events")
      .withIndex("by_candidate_time", (q) => q.eq("candidateId", args.candidateId))
      .order("asc")
      .collect();
  },
});

export const listByCandidateDesc = query({
  args: { candidateId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("timeline_events")
      .withIndex("by_candidate", (q) => q.eq("candidateId", args.candidateId))
      .order("desc")
      .collect();
  },
});
