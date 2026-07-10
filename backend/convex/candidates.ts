import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    recruiterId: v.optional(v.string()),
    roleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("candidates", {
      ...args,
      interviewStatus: "never_invited",
      attemptCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("candidates").order("desc").collect();
  },
});

export const listByRecruiter = query({
  args: { recruiterId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("candidates")
      .withIndex("by_recruiter", (q) => q.eq("recruiterId", args.recruiterId))
      .order("desc")
      .collect();
  },
});

export const listCooldownReady = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db
      .query("candidates")
      .filter((q) => q.eq(q.field("interviewStatus"), "cooldown"))
      .collect();
    return all.filter((c) => (c.cooldownUntil ?? Infinity) <= now);
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id as any);
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id as any);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    roleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id as any, patch);
  },
});

export const updateResume = mutation({
  args: {
    id: v.string(),
    resumeText: v.string(),
    resumeFileName: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id as any, patch);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.string(),
    interviewStatus: v.optional(v.string()),
    attemptCount: v.optional(v.number()),
    cooldownUntil: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    // Remove undefined keys so we don't accidentally null out fields
    const clean: Record<string, any> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) clean[k] = val;
    }
    await ctx.db.patch(id as any, clean);
  },
});
