import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { bumpWeeklyFuelRollup } from "./fuelRollups";

const COIN_REWARDS = {
  dailyLogin: 5,
  streak7: 25,
  streak14: 50,
  streak30: 100,
} as const;

function coinMultiplierFromBaseline(baseline: number | undefined): number {
  return Math.max(0.5, (baseline ?? DEFAULT_BASELINE) / 60);
}

function scaledCoin(base: number, baseline: number | undefined): number {
  return Math.max(1, Math.round(base * coinMultiplierFromBaseline(baseline)));
}

function coinRewardForStreak(streak: number, baseline: number | undefined): number {
  let base = 0;
  if (streak === 30) base = COIN_REWARDS.streak30;
  else if (streak === 14) base = COIN_REWARDS.streak14;
  else if (streak === 7) base = COIN_REWARDS.streak7;
  return base > 0 ? scaledCoin(base, baseline) : 0;
}

function cutbackBountyCoins(baseline: number | undefined, reduction: number | undefined): number {
  const pct = reduction ?? DEFAULT_REDUCTION;
  if (pct >= 50) return scaledCoin(15, baseline);
  if (pct >= 30) return scaledCoin(8, baseline);
  return 0;
}

const ACTIVITY_COIN_BASE: Record<string, number> = {
  physical: 3,
  mindful: 2,
  micro: 1,
  "anti-scroll": 2,
};

const ACTIVITY_CATEGORY: Record<string, string> = {
  run: "physical", pushups: "physical", squats: "physical",
  jumpingjacks: "physical", plank: "physical", wallsit: "physical",
  situps: "physical", stretch: "physical",
  breathe: "mindful", gratitude: "mindful", focusdot: "mindful",
  bodyscan: "mindful", mindfulwalk: "mindful",
  water: "micro", kindact: "micro", planday: "micro",
  phonebed: "micro", clean: "micro", instrument: "micro",
  study: "micro", read: "micro", cookmeal: "micro",
  eyesclosed: "anti-scroll", leaveroom: "anti-scroll", grayscale: "anti-scroll",
};

const EXPECTED_ACTIVITIES_PER_DAY = 4;
const DEFAULT_BASELINE = 60;
const DEFAULT_REDUCTION = 20;

function computeDailyFuelBudget(
  baseline: number | undefined,
  reduction: number | undefined,
): number {
  const b = baseline ?? DEFAULT_BASELINE;
  const r = reduction ?? DEFAULT_REDUCTION;
  return Math.round(b * (1 - r / 100));
}

const RANK_THRESHOLDS: Record<string, number> = {
  starter: 0,
  disciplined: 500,
  warrior: 2000,
  elite: 5000,
  legend: 10000,
};

const RANK_ORDER = ["starter", "disciplined", "warrior", "elite", "legend"];

function computeRank(totalDp: number): string {
  let rank = "starter";
  for (const r of RANK_ORDER) {
    if (totalDp >= RANK_THRESHOLDS[r]) rank = r;
  }
  return rank;
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.getTime();

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return activities
      .filter((a) => a._creationTime >= startOfDay)
      .reduce((sum, a) => sum + a.dpEarned, 0);
  },
});

const DAILY_LIMITS: Record<string, number> = {
  breathe: 2,
  gratitude: 1,
  water: 4,
  kindact: 2,
  eyesclosed: 3,
  planday: 1,
  bodyscan: 2,
  mindfulwalk: 2,
  phonebed: 1,
  clean: 2,
  instrument: 2,
  study: 2,
  read: 2,
  cookmeal: 1,
  grayscale: 1,
};

export const logActivity = mutation({
  args: {
    type: v.string(),
    dpEarned: v.number(),
    minutesEarned: v.number(),
    metadata: v.optional(
      v.object({
        distance: v.optional(v.number()),
        reps: v.optional(v.number()),
        duration: v.optional(v.number()),
      })
    ),
    verificationMethod: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.getTime();

    const todayActivities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect()
      .then((all) => all.filter((a) => a._creationTime >= startOfDay));

    const limit = DAILY_LIMITS[args.type];
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

    if (profile) {
      const dailyCap = computeDailyFuelBudget(
        profile.baselineToxicMinutesPerDay,
        profile.scrollReductionGoalPercent,
      );
      const todayMinutes = todayActivities.reduce(
        (sum, a) => sum + a.minutesEarned,
        0,
      );
      if (todayMinutes + args.minutesEarned > dailyCap) {
        throw new Error(
          `Daily fuel cap reached (${dailyCap} min). Come back tomorrow!`,
        );
      }
    }

    await ctx.db.insert("activities", {
      userId,
      type: args.type,
      dpEarned: args.dpEarned,
      minutesEarned: args.minutesEarned,
      metadata: args.metadata,
      verificationMethod: args.verificationMethod,
      verified: true,
    });

    if (profile) {
      const newTotalDp = profile.totalDp + args.dpEarned;
      const newMinutes = profile.minutesAvailable + args.minutesEarned;
      const todayStr = new Date().toISOString().split("T")[0];
      const isNewDay = profile.lastActivityDate !== todayStr;
      const newStreak = isNewDay ? profile.currentStreak + 1 : profile.currentStreak;
      const newBestStreak = Math.max(newStreak, profile.bestStreak);

      const nextLifeEarned =
        (profile.lifetimeMinutesEarned ?? 0) + args.minutesEarned;

      let coinBonus = 0;
      const actCat = ACTIVITY_CATEGORY[args.type];
      const actCoinBase = actCat ? (ACTIVITY_COIN_BASE[actCat] ?? 1) : 1;
      coinBonus += scaledCoin(actCoinBase, profile.baselineToxicMinutesPerDay);
      if (isNewDay) {
        coinBonus += scaledCoin(COIN_REWARDS.dailyLogin, profile.baselineToxicMinutesPerDay);
        coinBonus += coinRewardForStreak(newStreak, profile.baselineToxicMinutesPerDay);
        coinBonus += cutbackBountyCoins(
          profile.baselineToxicMinutesPerDay,
          profile.scrollReductionGoalPercent,
        );
      }

      await ctx.db.patch(profile._id, {
        totalDp: newTotalDp,
        minutesAvailable: newMinutes,
        currentStreak: newStreak,
        bestStreak: newBestStreak,
        lastActivityDate: todayStr,
        rank: computeRank(newTotalDp),
        lifetimeMinutesEarned: nextLifeEarned,
        coinBalance: (profile.coinBalance ?? 0) + coinBonus,
      });

      await bumpWeeklyFuelRollup(ctx, userId, {
        minutesEarned: args.minutesEarned,
        dpEarned: args.dpEarned,
      });
    }
  },
});

export const getTodayCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.getTime();

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const counts: Record<string, number> = {};
    for (const a of activities) {
      if (a._creationTime >= startOfDay) {
        counts[a.type] = (counts[a.type] ?? 0) + 1;
      }
    }
    return counts;
  },
});

export const creditCoins = mutation({
  args: {
    amount: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (args.amount <= 0) return;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    await ctx.db.patch(profile._id, {
      coinBalance: (profile.coinBalance ?? 0) + args.amount,
    });
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
