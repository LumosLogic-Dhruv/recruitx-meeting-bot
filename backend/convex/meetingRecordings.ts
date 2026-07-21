import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Mutations ──────────────────────────────────────────────────────────────────

export const upsert = mutation({
  args: {
    meetingId:              v.optional(v.string()),
    botId:                  v.string(),
    recordingId:            v.optional(v.string()),
    recordingUrl:           v.optional(v.string()),
    transcriptUrl:          v.optional(v.string()),
    thumbnailUrl:           v.optional(v.string()),
    durationSeconds:        v.optional(v.number()),
    status:                 v.string(),
    startedAt:              v.optional(v.string()),
    endedAt:                v.optional(v.string()),
    botIncludedInRecording: v.optional(v.boolean()),
    diarizationEnabled:     v.optional(v.boolean()),
    createdAt:              v.number(),
    updatedAt:              v.number(),
  },
  handler: async (ctx, args) => {
    // Check if a record already exists for this bot
    const existing = await ctx.db
      .query("meetingRecordings")
      .withIndex("by_bot", (q) => q.eq("botId", args.botId))
      .first();

    if (existing) {
      // Update — preserve createdAt, update everything else
      await ctx.db.patch(existing._id, {
        ...args,
        createdAt: existing.createdAt,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("meetingRecordings", args);
  },
});

export const updateStatus = mutation({
  args: {
    botId:  v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const rec = await ctx.db
      .query("meetingRecordings")
      .withIndex("by_bot", (q) => q.eq("botId", args.botId))
      .first();
    if (!rec) return null;
    const now = Date.now();
    await ctx.db.patch(rec._id, { status: args.status, updatedAt: now });
    return rec._id;
  },
});

export const deleteRecording = mutation({
  args: { id: v.id("meetingRecordings") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ── Queries ────────────────────────────────────────────────────────────────────

export const getByMeetingId = query({
  args: { meetingId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("meetingRecordings")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .first();
  },
});

export const getByBotId = query({
  args: { botId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("meetingRecordings")
      .withIndex("by_bot", (q) => q.eq("botId", args.botId))
      .first();
  },
});

export const list = query({
  args: { recruiterId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // meetingRecordings doesn't store recruiterId directly.
    // Return all records sorted by createdAt desc (most recent first).
    const all = await ctx.db.query("meetingRecordings").order("desc").collect();
    return all;
  },
});
