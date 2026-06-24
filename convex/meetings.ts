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
  },
  handler: async (ctx, args) => {
    const meetingId = await ctx.db.insert("meetings", {
      meetingUrl: args.meetingUrl,
      candidateName: args.candidateName,
      botName: args.botName,
      transcript: args.transcript,
      scorecard: args.scorecard,
      createdAt: Date.now(),
    });
    return meetingId;
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
