import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
  }).index("by_email", ["email"]),

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
  }).index("by_email", ["email"]),

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
  }).index("by_status", ["status"]).index("by_candidate", ["candidateId"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),
});
