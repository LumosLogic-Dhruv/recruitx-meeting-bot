import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    candidateId: v.string(),
    candidateName: v.string(),
    candidateEmail: v.string(),
    platform: v.string(),
    meetingUrl: v.string(),
    scheduledAt: v.number(),
    durationMinutes: v.number(),
    roleName: v.string(),
    systemPrompt: v.string(),
    botName: v.string(),
    emailSent: v.boolean(),
    calendarEventId: v.optional(v.string()),
    recruiterId: v.optional(v.string()),
    attemptNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scheduledInterviews", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scheduledInterviews").order("desc").collect();
  },
});

export const listByRecruiter = query({
  args: { recruiterId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduledInterviews")
      .withIndex("by_recruiter", (q) => q.eq("recruiterId", args.recruiterId))
      .order("desc")
      .collect();
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("scheduledInterviews")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id as any);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.string(),
    status: v.string(),
    meetingId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id as any, patch);
  },
});
