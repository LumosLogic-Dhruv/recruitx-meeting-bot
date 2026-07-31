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
    generatedPrompt: v.optional(v.string()),
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
    // Accept null in addition to number so Python callers can pass None to clear the field.
    // The cooldown query uses `?? Infinity` which correctly treats both null and undefined
    // as "no cooldown", so storing null is functionally equivalent to removing the field.
    cooldownUntil: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    // Skip undefined keys. null is passed through intentionally to clear cooldownUntil.
    const clean: Record<string, any> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) clean[k] = val;
    }
    await ctx.db.patch(id as any, clean);
  },
});

// ---------------------------------------------------------------------------
// Candidate profile sharing
// ---------------------------------------------------------------------------

export const enableSharing = mutation({
  args: { candidateId: v.id("candidates") },
  handler: async (ctx, args): Promise<string> => {
    const candidateId = args.candidateId;
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) throw new Error("Candidate not found");

    if ((candidate as any).candidateShareEnabled && (candidate as any).candidateShareToken) {
      return (candidate as any).candidateShareToken;
    }
    const token = (candidate as any).candidateShareToken ?? crypto.randomUUID();
    await ctx.db.patch(candidateId, {
      candidateShareEnabled: true,
      candidateShareToken: token,
    });
    return token;
  },
});

export const disableSharing = mutation({
  args: { candidateId: v.id("candidates") },
  handler: async (ctx, args): Promise<void> => {
    const candidateId = args.candidateId;
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) throw new Error("Candidate not found");
    await ctx.db.patch(candidateId, { candidateShareEnabled: false });
  },
});

// Public — no auth required. Returns candidate profile + linked call scorecards.
export const getByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const candidate = await ctx.db
      .query("candidates")
      .withIndex("by_share_token", (q) =>
        q.eq("candidateShareToken", args.token)
      )
      .unique();
    if (!candidate || !(candidate as any).candidateShareEnabled) return null;

    // Fetch linked calls (meetings in bot-server matching recruiterId and candidateName)
    const calls = candidate.recruiterId ? await ctx.db
      .query("meetings")
      .filter((q) => q.and(
        q.eq(q.field("recruiterId"), candidate.recruiterId),
        q.eq(q.field("candidateName"), candidate.name)
      ))
      .order("desc")
      .take(20) : [];

    const publicCalls = calls.map((c) => ({
      _id: c._id,
      createdAt: c.createdAt,
      duration: c.wordCount ? Math.floor(c.wordCount / 2.5) : 0, // Approximate duration if none exists
      status: c.interviewStatus,
      scorecard: c.scorecard ?? null,
      transcript: c.transcriptText ?? null,
      recordingUrl: c.candidateAudioUrl ?? c.recordingUrl ?? null,
      useCase: c.roleName ?? null,
    }));

    return {
      _id: candidate._id,
      name: candidate.name,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      location: candidate.location ?? null,
      currentCompany: candidate.currentCompany ?? null,
      currentTitle: candidate.currentRole ?? null,
      experienceYears: candidate.experienceYears ?? null,
      currentCtc: candidate.currentCtc ?? null,
      expectedCtc: candidate.expectedCtc ?? null,
      skills: candidate.skills ?? [],
      linkedin: candidate.linkedinUrl ?? null,
      github: candidate.githubUrl ?? null,
      roleApplyingFor: candidate.roleName ?? null,
      resumeUrl: candidate.resumeFileName ?? null, // Will need a separate bucket/storage fetch for real urls
      calls: publicCalls,
    };
  },
});
