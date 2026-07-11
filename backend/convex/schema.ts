import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    role: v.optional(v.string()),            // "admin" | "recruiter"
    resetToken: v.optional(v.string()),      // hashed password-reset token
    resetTokenExpiry: v.optional(v.number()), // UTC epoch ms — token expires after 1h
  }).index("by_email", ["email"]).index("by_reset_token", ["resetToken"]),

  meetings: defineTable({
    meetingUrl: v.string(),
    candidateName: v.string(),
    botName: v.string(),
    transcript: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
      })
    ),
    scorecard: v.any(),
    createdAt: v.number(),
    botId: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    botAudioUrl: v.optional(v.string()),
    candidateAudioUrl: v.optional(v.string()),
    interviewStatus: v.optional(v.string()),  // "completed" | "partial" | "no_show"
    recruiterId: v.optional(v.string()),
    roleName: v.optional(v.string()),
    attemptNumber: v.optional(v.number()),
  }),

  rolePrompts: defineTable({
    roleName: v.string(),
    promptText: v.string(),
    createdAt: v.number(),
  }).index("by_role", ["roleName"]),

  candidates: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    recruiterId: v.optional(v.string()),           // user._id of the recruiter who added them
    interviewStatus: v.optional(v.string()),        // "never_invited"|"cooldown"|"locked"|...
    attemptCount: v.optional(v.number()),           // 0, 1, or 2
    cooldownUntil: v.optional(v.number()),          // UTC epoch ms — null when not in cooldown
    roleName: v.optional(v.string()),               // role they are being interviewed for
    resumeText: v.optional(v.string()),             // extracted text from uploaded CV
    resumeFileName: v.optional(v.string()),         // original filename
    // Extended profile fields
    experienceYears: v.optional(v.string()),
    currentCompany: v.optional(v.string()),
    currentRole: v.optional(v.string()),
    currentCtc: v.optional(v.string()),
    expectedCtc: v.optional(v.string()),
    location: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    education: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
  }).index("by_email", ["email"]).index("by_recruiter", ["recruiterId"]),

  scheduledInterviews: defineTable({
    candidateId: v.string(),
    candidateName: v.string(),
    candidateEmail: v.string(),
    platform: v.string(),        // "google_meet" | "zoom" | "teams"
    meetingUrl: v.string(),
    scheduledAt: v.number(),     // UTC milliseconds
    durationMinutes: v.number(),
    roleName: v.string(),
    systemPrompt: v.string(),
    botName: v.string(),
    status: v.string(),          // "pending" | "active" | "completed" | "cancelled"
    emailSent: v.boolean(),
    calendarEventId: v.optional(v.string()),
    meetingId: v.optional(v.string()),  // Convex meetings table ID after completion
    createdAt: v.number(),
    recruiterId: v.optional(v.string()),   // user._id of recruiter who scheduled
    attemptNumber: v.optional(v.number()), // 1 or 2
  }).index("by_status", ["status"]).index("by_candidate", ["candidateId"])
    .index("by_recruiter", ["recruiterId"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  // Immutable event log — one row per lifecycle event per candidate
  timeline_events: defineTable({
    candidateId: v.string(),               // candidates table _id
    eventType: v.string(),                 // see EVENT_TYPES in timeline.ts
    timestamp: v.number(),                 // UTC epoch ms
    actor: v.optional(v.string()),         // userId or "system"
    metadata: v.optional(v.any()),         // extra context (score, meetUrl, …)
  }).index("by_candidate", ["candidateId"])
    .index("by_candidate_time", ["candidateId", "timestamp"]),
});
