import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    roleName: v.string(),
    promptText: v.string(),
  },
  handler: async (ctx, args) => {
    // Normalize role name
    const roleNameNormalized = args.roleName.trim();
    // Check if prompt for role already exists
    const existing = await ctx.db
      .query("rolePrompts")
      .withIndex("by_role", (q) => q.eq("roleName", roleNameNormalized))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        promptText: args.promptText,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    const promptId = await ctx.db.insert("rolePrompts", {
      roleName: roleNameNormalized,
      promptText: args.promptText,
      createdAt: Date.now(),
    });
    return promptId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("rolePrompts").order("desc").collect();
  },
});

export const getByRole = query({
  args: { roleName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rolePrompts")
      .withIndex("by_role", (q) => q.eq("roleName", args.roleName))
      .first();
  },
});
