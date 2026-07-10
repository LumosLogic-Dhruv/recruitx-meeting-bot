import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) {
      throw new Error("Email already registered");
    }
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      passwordHash: args.passwordHash,
      role: args.role ?? "recruiter",
    });
    return userId;
  },
});

export const setRole = mutation({
  args: { id: v.string(), role: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id as any, { role: args.role });
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id as any);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").order("desc").collect();
  },
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const setResetToken = mutation({
  args: { id: v.string(), resetToken: v.string(), resetTokenExpiry: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id as any, {
      resetToken: args.resetToken,
      resetTokenExpiry: args.resetTokenExpiry,
    });
  },
});

export const getByResetToken = query({
  args: { resetToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_reset_token", (q) => q.eq("resetToken", args.resetToken))
      .first();
  },
});

export const updatePassword = mutation({
  args: { id: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id as any, {
      passwordHash: args.passwordHash,
      resetToken: undefined,
      resetTokenExpiry: undefined,
    });
  },
});
