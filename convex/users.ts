import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { bumpWeeklyFuelRollup } from "./fuelRollups";
import { addWeeklyScore } from "./leaderboardUtils";

const personaValidator = v.union(
  v.literal("focus"),
  v.literal("fitness"),
  v.literal("discipline"),
  v.literal("calm"),
);
const movementLevelValidator = v.union(
  v.literal("beginner"),
  v.literal("decent"),
);
const difficultyValidator = v.union(
  v.literal("chill"),
  v.literal("balanced"),
  v.literal("beast"),
);
const baselineSourceValidator = v.union(
  v.literal("manual"),
  v.literal("screen_time"),
);

function assertOptionalText(
  label: string,
  value: string | undefined,
  maxLength: number,
): void {
  if (value !== undefined && (value.trim().length === 0 || value.length > maxLength)) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters`);
  }
}

function assertOptionalIntegerRange(
  label: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max)
  ) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
}

function validateProfileInput(args: {
  displayName?: string;
  avatarUrl?: string;
  goal?: string;
  baselineToxicMinutesPerDay?: number;
  scrollReductionGoalPercent?: number;
}): void {
  assertOptionalText("Display name", args.displayName, 80);
  assertOptionalText("Avatar URL", args.avatarUrl, 2_048);
  assertOptionalText("Goal", args.goal, 120);
  assertOptionalIntegerRange(
    "Daily screen-time baseline",
    args.baselineToxicMinutesPerDay,
    1,
    1_440,
  );
  assertOptionalIntegerRange(
    "Scroll reduction goal",
    args.scrollReductionGoalPercent,
    0,
    90,
  );
}

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
    persona: v.optional(personaValidator),
    movementLevel: v.optional(movementLevelValidator),
    difficultyLevel: v.optional(difficultyValidator),
    baselineToxicMinutesPerDay: v.optional(v.number()),
    scrollReductionGoalPercent: v.optional(v.number()),
    baselineSource: v.optional(baselineSourceValidator),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    validateProfileInput(args);

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
      persona: args.persona,
      movementLevel: args.movementLevel,
      difficultyLevel: args.difficultyLevel,
      rank: "starter",
      totalDp: 0,
      currentStreak: 0,
      bestStreak: 0,
      freezesRemaining: 0,
      minutesAvailable: 0,
      onboardingComplete: false,
      baselineToxicMinutesPerDay: args.baselineToxicMinutesPerDay,
      scrollReductionGoalPercent: args.scrollReductionGoalPercent,
      baselineSource: args.baselineSource ?? "manual",
      baselineCapturedAt:
        args.baselineToxicMinutesPerDay !== undefined ||
        args.scrollReductionGoalPercent !== undefined
          ? Date.now()
          : undefined,
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
    persona: v.optional(personaValidator),
    movementLevel: v.optional(movementLevelValidator),
    difficultyLevel: v.optional(difficultyValidator),
    goal: v.optional(v.string()),
    baselineToxicMinutesPerDay: v.optional(v.number()),
    scrollReductionGoalPercent: v.optional(v.number()),
    baselineSource: v.optional(baselineSourceValidator),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    validateProfileInput(args);

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
    if (profile.welcomeBonusClaimedAt) return { claimed: false };

    // Profiles credited by the previous implementation had no explicit marker.
    const previouslyCredited =
      profile.totalDp >= 50 && (profile.lifetimeMinutesEarned ?? 0) >= 10;
    const today = new Date().toISOString().split("T")[0];

    await ctx.db.patch(profile._id, {
      totalDp: profile.totalDp + (previouslyCredited ? 0 : 50),
      minutesAvailable: profile.minutesAvailable + (previouslyCredited ? 0 : 10),
      lifetimeMinutesEarned:
        (profile.lifetimeMinutesEarned ?? 0) + (previouslyCredited ? 0 : 10),
      currentStreak: Math.max(1, profile.currentStreak),
      bestStreak: Math.max(1, profile.bestStreak),
      lastActivityDate: profile.lastActivityDate ?? today,
      welcomeBonusClaimedAt: Date.now(),
    });

    if (!previouslyCredited) {
      await bumpWeeklyFuelRollup(ctx, userId, {
        minutesEarned: 10,
        dpEarned: 50,
      });
      await addWeeklyScore(ctx, userId, 50, profile.league ?? "bronze");
    }

    return { claimed: !previouslyCredited };
  },
});

export const updateOnboardingData = mutation({
  args: {
    displayName: v.optional(v.string()),
    goal: v.optional(v.string()),
    persona: v.optional(personaValidator),
    movementLevel: v.optional(movementLevelValidator),
    difficultyLevel: v.optional(difficultyValidator),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    validateProfileInput(args);

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
    if (args.apps.length > 50) {
      throw new Error("A maximum of 50 shielded apps is supported");
    }
    for (const app of args.apps) {
      assertOptionalText("App name", app.appName, 120);
      assertOptionalText("App icon", app.appIcon, 80);
      assertOptionalText("App color", app.appColor, 16);
    }

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
