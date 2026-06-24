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
    scorecard: v.any(), // contains overall_score, recommendation, summary, etc.
    createdAt: v.number(),
  }),

  rolePrompts: defineTable({
    roleName: v.string(),
    promptText: v.string(),
    createdAt: v.number(),
  }).index("by_role", ["roleName"]),
});
