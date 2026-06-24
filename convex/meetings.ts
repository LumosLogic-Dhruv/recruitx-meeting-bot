import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
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
    botId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meetingId = await ctx.db.insert("meetings", {
      meetingUrl: args.meetingUrl,
      candidateName: args.candidateName,
      botName: args.botName,
      transcript: args.transcript,
      scorecard: args.scorecard,
      createdAt: Date.now(),
      botId: args.botId,
    });
    return meetingId;
  },
});

export const updateRecording = mutation({
  args: {
    id: v.id("meetings"),
    recordingUrl: v.optional(v.string()),
    botAudioUrl: v.optional(v.string()),
    candidateAudioUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("meetings").order("desc").collect();
  },
});

export const get = query({
  args: { id: v.id("meetings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
