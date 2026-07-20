import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { bumpWeeklyFuelRollup } from "./fuelRollups";
import { ACTIVITY_RULES, computeActivityReward, dailyFuelBudget } from "../shared/gamification";
import { addWeeklyScore } from "./leaderboardUtils";

const RANK_THRESHOLDS: Record<string, number> = {
  starter: 0,
  disciplined: 500,
  warrior: 2000,
  elite: 5000,
  legend: 10000,
};

const RANK_ORDER = ["starter", "disciplined", "warrior", "elite", "legend"];
const DAY_MS = 86_400_000;
const MAX_REWARD_BASELINE_MINUTES = 180;

type ActivityMetadata = {
  distance?: number;
  reps?: number;
  duration?: number;
  note?: string;
  transcript?: string;
  summary?: string;
  voiceUri?: string;
  coachSessionId?: string;
  geminiSessionId?: string;
};

function computeRank(totalDp: number): string {
  let rank = "starter";
  for (const r of RANK_ORDER) {
    if (totalDp >= RANK_THRESHOLDS[r]) rank = r;
  }
  return rank;
}

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function utcDayStart(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00.000Z`);
}

function dayGap(previousDay: string | undefined, currentDay: string): number | null {
  if (!previousDay) return null;
  const previous = utcDayStart(previousDay);
  const current = utcDayStart(currentDay);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.round((current - previous) / DAY_MS);
}

function rewardBaselineMultiplier(baseline: number): number {
  const bounded = Math.min(
    MAX_REWARD_BASELINE_MINUTES,
    Math.max(1, Number.isFinite(baseline) ? baseline : 60),
  );
  return Math.max(0.5, bounded / 60);
}

function assertOptionalFiniteRange(
  label: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

function assertOptionalText(
  label: string,
  value: string | undefined,
  maxLength: number,
): void {
  if (value !== undefined && value.length > maxLength) {
    throw new Error(`${label} is too long`);
  }
}

function validateActivityMetadata(type: string, metadata: ActivityMetadata | undefined): void {
  if (!metadata) {
    if (type === "run" || type === "coin_run") {
      throw new Error("GPS activities require distance metadata");
    }
    return;
  }

  assertOptionalFiniteRange("Distance", metadata.distance, 0, 100_000);
  assertOptionalFiniteRange("Reps", metadata.reps, 0, 10_000);
  assertOptionalFiniteRange("Duration", metadata.duration, 0, 86_400);
  assertOptionalText("Note", metadata.note, 4_000);
  assertOptionalText("Transcript", metadata.transcript, 20_000);
  assertOptionalText("Summary", metadata.summary, 4_000);
  assertOptionalText("Voice URI", metadata.voiceUri, 2_048);
  assertOptionalText("Coach session ID", metadata.coachSessionId, 200);
  assertOptionalText("Session ID", metadata.geminiSessionId, 200);

  if (type === "run" && (metadata.distance ?? 0) < 100) {
    throw new Error("Walk or run at least 100 metres before completing");
  }
  if (type === "coin_run" && (metadata.distance ?? 0) < 250) {
    throw new Error("Reach the first 250 metre checkpoint before completing");
  }
  if (
    (type === "run" || type === "coin_run") &&
    metadata.duration !== undefined &&
    metadata.duration > 0 &&
    (metadata.distance ?? 0) / metadata.duration > 12
  ) {
    throw new Error("GPS activity speed is outside the supported range");
  }
}

export const getRecentActivities = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

export const getTodayDp = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return 0;

    const startOfDay = utcDayStart(utcDayKey());

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) =>
        q.eq("userId", userId).gte("_creationTime", startOfDay),
      )
      .collect();

    return activities.reduce((sum, a) => sum + a.dpEarned, 0);
  },
});

export const logActivity = mutation({
  args: {
    type: v.string(),
    // Keep the former client-supplied reward fields optional so already-installed
    // builds remain compatible. Rewards and verification are still derived here.
    dpEarned: v.optional(v.number()),
    minutesEarned: v.optional(v.number()),
    verificationMethod: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        distance: v.optional(v.number()),
        reps: v.optional(v.number()),
        duration: v.optional(v.number()),
        note: v.optional(v.string()),
        transcript: v.optional(v.string()),
        summary: v.optional(v.string()),
        voiceUri: v.optional(v.string()),
        coachSessionId: v.optional(v.string()),
        geminiSessionId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rule = ACTIVITY_RULES[args.type];
    if (!rule) throw new Error("Unknown activity");
    validateActivityMetadata(args.type, args.metadata);

    const todayStr = utcDayKey();
    const startOfDay = utcDayStart(todayStr);

    const todayActivities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) =>
        q.eq("userId", userId).gte("_creationTime", startOfDay),
      )
      .collect();
    const previousActivity = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const limit = rule.dailyLimit;
    if (limit !== undefined) {
      const count = todayActivities.filter((a) => a.type === args.type).length;
      if (count >= limit) {
        throw new Error(`Daily limit reached for ${args.type} (${limit}x per day)`);
      }
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");
    const pendingReferral = !previousActivity
      ? await ctx.db
          .query("referrals")
          .withIndex("by_invitedUserId_status", (q) =>
            q.eq("invitedUserId", userId).eq("status", "accepted"),
          )
          .first()
      : null;

    const difficulty = profile.difficultyLevel === "beast"
      ? "beast"
      : profile.difficultyLevel === "chill"
        ? "chill"
        : "balanced";
    const economyProfile = {
      baselineToxicMinutesPerDay: profile.baselineToxicMinutesPerDay ?? 60,
      scrollReductionGoalPercent: profile.scrollReductionGoalPercent ?? 20,
      difficulty,
    } as const;
    const reward = computeActivityReward(economyProfile, args.type, {
      distance: args.metadata?.distance,
    });
    const dailyCap = dailyFuelBudget(economyProfile);
    const todayMinutes = todayActivities.reduce(
      (sum, activity) => sum + activity.minutesEarned,
      0,
    );
    if (todayMinutes + reward.minutes > dailyCap) {
      throw new Error(`Daily fuel cap reached (${dailyCap} min). Come back tomorrow!`);
    }

    await ctx.db.insert("activities", {
      userId,
      type: args.type,
      dpEarned: reward.vp,
      minutesEarned: reward.minutes,
      metadata: args.metadata,
      verificationMethod: rule.verification,
      // Measurement currently originates on the client. Keep the record honest
      // until completion is backed by a server-issued session/attestation flow.
      verified: false,
    });

    let nodeDp = 0;
    let nodeCoins = 0;
    let completedNodeLabel: string | undefined;
    const mapNodes = await ctx.db
      .query("mapProgress")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const currentNode = mapNodes.find((node) => node.status === "current");
    const requiredKeys = currentNode?.activityKeys ?? [];
    if (currentNode && requiredKeys.includes(args.type)) {
      const completedKeys = Array.from(new Set([
        ...(currentNode.completedActivityKeys ?? []),
        args.type,
      ]));
      const nodeComplete = requiredKeys.every((key) => completedKeys.includes(key));
      await ctx.db.patch(currentNode._id, {
        completedActivityKeys: completedKeys,
        ...(nodeComplete ? { status: "completed", completedAt: Date.now() } : {}),
      });
      if (nodeComplete) {
        nodeDp = currentNode.dp ?? 0;
        completedNodeLabel = currentNode.label;
        const baselineMult = rewardBaselineMultiplier(
          economyProfile.baselineToxicMinutesPerDay,
        );
        nodeCoins = currentNode.nodeType === "boss" ? Math.round(25 * baselineMult) : 0;
        const nextNode = mapNodes.find((node) => node.nodeId === currentNode.nodeId + 1);
        if (nextNode) await ctx.db.patch(nextNode._id, { status: "current" });
      }
    }

    const missionCount = todayActivities.filter((activity) => activity.type !== "coin_run").length + (args.type === "coin_run" ? 0 : 1);
    const dailyQuestCompleted = missionCount >= 3 && profile.lastDailyQuestClaimDate !== todayStr;
    const dailyQuestCoins = dailyQuestCompleted ? 10 : 0;
    const gap = dayGap(profile.lastActivityDate, todayStr);
    const isNewDay = gap === null || gap > 0;
    const missedDays = gap !== null && gap > 1 ? gap - 1 : 0;
    const canBridgeMissedDays =
      missedDays > 0 && missedDays <= (profile.freezesRemaining ?? 0);
    const newStreak = !isNewDay
      ? profile.currentStreak
      : gap === 1 || canBridgeMissedDays
        ? profile.currentStreak + 1
        : 1;
    const newFreezesRemaining = canBridgeMissedDays
      ? Math.max(0, (profile.freezesRemaining ?? 0) - missedDays)
      : profile.freezesRemaining;
    const streakBase = isNewDay && newStreak === 7 ? 25 : isNewDay && newStreak === 14 ? 50 : isNewDay && newStreak === 30 ? 100 : 0;
    const streakCoins = Math.round(
      streakBase * rewardBaselineMultiplier(economyProfile.baselineToxicMinutesPerDay),
    );
    const totalDpEarned = reward.vp + nodeDp;
    const totalCoinsEarned = reward.coins + nodeCoins + dailyQuestCoins + streakCoins;
    const newTotalDp = profile.totalDp + totalDpEarned;

    await ctx.db.patch(profile._id, {
      totalDp: newTotalDp,
      minutesAvailable: profile.minutesAvailable + reward.minutes,
      currentStreak: newStreak,
      bestStreak: Math.max(newStreak, profile.bestStreak),
      freezesRemaining: newFreezesRemaining,
      lastActivityDate: todayStr,
      rank: computeRank(newTotalDp),
      lifetimeMinutesEarned: (profile.lifetimeMinutesEarned ?? 0) + reward.minutes,
      coinBalance: (profile.coinBalance ?? 0) + totalCoinsEarned,
      ...(dailyQuestCompleted ? { lastDailyQuestClaimDate: todayStr } : {}),
    });

    await bumpWeeklyFuelRollup(ctx, userId, {
      minutesEarned: reward.minutes,
      dpEarned: totalDpEarned,
    });
    await addWeeklyScore(ctx, userId, totalDpEarned, profile.league ?? "bronze");

    const now = Date.now();
    await ctx.db.insert("growthEvents", {
      userId,
      name: "activity_completed",
      occurredAt: now,
      properties: {
        activityType: args.type,
        currentStreak: newStreak,
        minutesEarned: reward.minutes,
      },
    });
    if (!previousActivity) {
      await ctx.db.insert("growthEvents", {
        userId,
        name: "first_activity_completed",
        occurredAt: now,
        properties: {
          activityType: args.type,
          currentStreak: newStreak,
          minutesEarned: reward.minutes,
        },
      });
    }

    let referralActivated = false;
    let referralBonusCoins = 0;
    let referralBonusFreezes = 0;
    if (pendingReferral) {
      const inviterProfile = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) =>
          q.eq("userId", pendingReferral.inviterUserId),
        )
        .unique();
      if (inviterProfile) {
        referralActivated = true;
        referralBonusCoins = pendingReferral.rewardCoins;
        referralBonusFreezes = pendingReferral.rewardFreezes;

        await ctx.db.patch(profile._id, {
          coinBalance:
            (profile.coinBalance ?? 0) +
            totalCoinsEarned +
            referralBonusCoins,
          freezesRemaining: Math.min(
            5,
            newFreezesRemaining + referralBonusFreezes,
          ),
        });
        await ctx.db.patch(inviterProfile._id, {
          coinBalance:
            (inviterProfile.coinBalance ?? 0) + referralBonusCoins,
          freezesRemaining: Math.min(
            5,
            inviterProfile.freezesRemaining + referralBonusFreezes,
          ),
        });
        await ctx.db.patch(pendingReferral._id, {
          status: "activated",
          activatedAt: now,
        });
        await ctx.db.insert("growthEvents", {
          userId,
          name: "referral_activated",
          occurredAt: now,
          properties: {
            activityType: args.type,
            value: referralBonusCoins,
          },
        });
        await ctx.db.insert("growthEvents", {
          userId: pendingReferral.inviterUserId,
          name: "referral_rewarded",
          occurredAt: now,
          properties: {
            value: referralBonusCoins,
          },
        });
      }
    }

    return {
      minutesEarned: reward.minutes,
      vpEarned: reward.vp,
      coinsEarned: totalCoinsEarned + referralBonusCoins,
      missionCount: Math.min(3, missionCount),
      dailyQuestCompleted,
      completedNodeLabel,
      nodeDp,
      currentStreak: newStreak,
      isFirstActivity: !previousActivity,
      referralActivated,
      referralBonusCoins,
      referralBonusFreezes,
    };
  },
});

export const getTodaySummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    const todayStr = utcDayKey();
    const startOfDay = utcDayStart(todayStr);
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) =>
        q.eq("userId", userId).gte("_creationTime", startOfDay),
      )
      .collect();
    const missionCount = activities.filter((activity) => activity.type !== "coin_run").length;
    return {
      missionCount: Math.min(3, missionCount),
      missionGoal: 3,
      questClaimed: profile.lastDailyQuestClaimDate === todayStr,
      minutesEarned: activities.reduce((sum, activity) => sum + activity.minutesEarned, 0),
      recentTypes: activities.slice(-5).map((activity) => activity.type),
    };
  },
});

export const getTodayCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return {};

    const startOfDay = utcDayStart(utcDayKey());

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) =>
        q.eq("userId", userId).gte("_creationTime", startOfDay),
      )
      .collect();

    const counts: Record<string, number> = {};
    for (const a of activities) {
      counts[a.type] = (counts[a.type] ?? 0) + 1;
    }
    return counts;
  },
});

/**
 * @deprecated Kept as an authenticated no-op for installed clients that still
 * call this after logging a Coin Run. logActivity now awards coins server-side,
 * so crediting here would double-pay and would restore a client-trust exploit.
 */
export const creditCoins = mutation({
  args: {
    amount: v.number(),
    source: v.string(),
  },
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return { credited: false, handledBy: "logActivity" };
  },
});

export const claimFuel = mutation({
  args: {
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");
    if (
      !Number.isFinite(args.minutes) ||
      !Number.isInteger(args.minutes) ||
      args.minutes <= 0 ||
      args.minutes > 1_440
    ) {
      throw new Error("Minutes must be an integer between 1 and 1440");
    }
    if (profile.minutesAvailable < args.minutes)
      throw new Error("Not enough minutes");

    const nextLifeSpent =
      (profile.lifetimeMinutesSpent ?? 0) + args.minutes;

    await ctx.db.patch(profile._id, {
      minutesAvailable: profile.minutesAvailable - args.minutes,
      lifetimeMinutesSpent: nextLifeSpent,
    });

    await bumpWeeklyFuelRollup(ctx, userId, { minutesSpent: args.minutes });
  },
});
