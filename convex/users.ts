import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { bumpWeeklyFuelRollup } from "./fuelRollups";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    const user = await ctx.db.get(userId);
    return { ...profile, email: user?.email };
  },
});

export const ensureProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    goal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (existing) return existing._id;

    const user = await ctx.db.get(userId);
    const name = args.displayName || user?.name || "Volt User";

    const profileId = await ctx.db.insert("profiles", {
      userId,
      displayName: name,
      goal: args.goal,
      rank: "starter",
      totalDp: 0,
      currentStreak: 0,
      bestStreak: 0,
      freezesRemaining: 0,
      minutesAvailable: 0,
      onboardingComplete: false,
      baselineSource: "manual",
      coinBalance: 0,
      league: "bronze",
    });

    const defaultApps = [
      { appName: "Instagram", appIcon: "photo-camera", appColor: "#AB70DB", isLocked: false },
      { appName: "TikTok", appIcon: "music-note", appColor: "#FADB69", isLocked: false },
      { appName: "YouTube", appIcon: "play-arrow", appColor: "#EE4343", isLocked: false },
      { appName: "Facebook", appIcon: "groups", appColor: "#4B9EFD", isLocked: false },
      { appName: "Threads", appIcon: "forum", appColor: "#D2F6FE", isLocked: false },
      { appName: "X", appIcon: "close", appColor: "#97F9A7", isLocked: false },
    ];
    for (const app of defaultApps) {
      await ctx.db.insert("blockedApps", { userId, ...app });
    }

    for (let i = 1; i <= 10; i++) {
      await ctx.db.insert("mapProgress", {
        userId,
        nodeId: i,
        status: i === 1 ? "completed" : i === 2 ? "current" : "locked",
        section: "foundation",
      });
    }

    return profileId;
  },
});

export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    onboardingComplete: v.optional(v.boolean()),
    persona: v.optional(v.string()),
    movementLevel: v.optional(v.string()),
    difficultyLevel: v.optional(v.string()),
    goal: v.optional(v.string()),
    baselineToxicMinutesPerDay: v.optional(v.number()),
    scrollReductionGoalPercent: v.optional(v.number()),
    baselineSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    const updates: Record<string, unknown> = {};
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.avatarUrl !== undefined) updates.avatarUrl = args.avatarUrl;
    if (args.onboardingComplete !== undefined)
      updates.onboardingComplete = args.onboardingComplete;
    if (args.persona !== undefined) updates.persona = args.persona;
    if (args.movementLevel !== undefined) updates.movementLevel = args.movementLevel;
    if (args.difficultyLevel !== undefined)
      updates.difficultyLevel = args.difficultyLevel;
    if (args.goal !== undefined) updates.goal = args.goal;
    if (args.baselineSource !== undefined)
      updates.baselineSource = args.baselineSource;
    if (args.baselineToxicMinutesPerDay !== undefined) {
      updates.baselineToxicMinutesPerDay = args.baselineToxicMinutesPerDay;
      updates.baselineCapturedAt = Date.now();
    }
    if (args.scrollReductionGoalPercent !== undefined) {
      updates.scrollReductionGoalPercent = args.scrollReductionGoalPercent;
      if (updates.baselineCapturedAt === undefined) {
        updates.baselineCapturedAt = Date.now();
      }
    }

    await ctx.db.patch(profile._id, updates);
  },
});

export const claimWelcomeBonus = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");
    if (profile.totalDp > 0) return;

    const nextLifeEarned = (profile.lifetimeMinutesEarned ?? 0) + 10;

    await ctx.db.patch(profile._id, {
      totalDp: 50,
      minutesAvailable: 10,
      lifetimeMinutesEarned: nextLifeEarned,
    });

    await bumpWeeklyFuelRollup(ctx, userId, {
      minutesEarned: 10,
      dpEarned: 50,
    });
  },
});

export const updateOnboardingData = mutation({
  args: {
    displayName: v.optional(v.string()),
    goal: v.optional(v.string()),
    persona: v.optional(v.string()),
    movementLevel: v.optional(v.string()),
    difficultyLevel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");

    const updates: Record<string, unknown> = {};
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.goal !== undefined) updates.goal = args.goal;
    if (args.persona !== undefined) updates.persona = args.persona;
    if (args.movementLevel !== undefined) updates.movementLevel = args.movementLevel;
    if (args.difficultyLevel !== undefined) updates.difficultyLevel = args.difficultyLevel;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(profile._id, updates);
    }
  },
});

export const getBlockedApps = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("blockedApps")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const syncBlockedApps = mutation({
  args: {
    apps: v.array(
      v.object({
        appName: v.string(),
        appIcon: v.string(),
        appColor: v.string(),
        isLocked: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingApps = await ctx.db
      .query("blockedApps")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    for (const app of existingApps) {
      await ctx.db.delete(app._id);
    }

    for (const app of args.apps) {
      await ctx.db.insert("blockedApps", {
        userId,
        appName: app.appName,
        appIcon: app.appIcon,
        appColor: app.appColor,
        isLocked: app.isLocked,
      });
    }
  },
});

export const toggleAppLock = mutation({
  args: { appId: v.id("blockedApps") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const app = await ctx.db.get(args.appId);
    if (!app || app.userId !== userId) throw new Error("App not found");

    await ctx.db.patch(args.appId, { isLocked: !app.isLocked });
  },
});
