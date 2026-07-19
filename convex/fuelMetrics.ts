import { v } from "convex/values";
import { query } from "./_generated/server";
import { auth } from "./auth";
import { utcWeekStartString } from "./fuelRollups";

export const getFuelEconomySummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;

    const weekStart = utcWeekStartString();
    const weekRow = await ctx.db
      .query("weeklyFuelRollups")
      .withIndex("by_userId_week", (q) => q.eq("userId", userId).eq("weekStart", weekStart))
      .unique();

    const lifeEarned = profile.lifetimeMinutesEarned ?? 0;
    const lifeSpent = profile.lifetimeMinutesSpent ?? 0;
    const scrollYield = lifeEarned > 0 ? lifeSpent / lifeEarned : 0;

    const baseline = profile.baselineToxicMinutesPerDay;
    const goalPct = profile.scrollReductionGoalPercent;
    const targetDailyToxic =
      baseline != null && goalPct != null
        ? Math.round(baseline * (1 - goalPct / 100))
        : null;

    return {
      minutesAvailable: profile.minutesAvailable,
      lifetimeMinutesEarned: lifeEarned,
      lifetimeMinutesSpent: lifeSpent,
      scrollYield,
      baselineToxicMinutesPerDay: profile.baselineToxicMinutesPerDay ?? null,
      scrollReductionGoalPercent: profile.scrollReductionGoalPercent ?? null,
      targetToxicMinutesPerDay: targetDailyToxic,
      baselineCapturedAt: profile.baselineCapturedAt ?? null,
      weekStart,
      weekMinutesEarned: weekRow?.minutesEarned ?? 0,
      weekMinutesSpent: weekRow?.minutesSpent ?? 0,
      weekDpEarned: weekRow?.dpEarned ?? 0,
    };
  },
});

export const getWeeklyFuelHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const cap = Math.min(52, Math.max(1, args.limit ?? 8));
    const rows = await ctx.db
      .query("weeklyFuelRollups")
      .withIndex("by_userId_week", (q) => q.eq("userId", userId))
      .order("desc")
      .take(cap);

    return rows.map((r) => ({
      weekStart: r.weekStart,
      minutesEarned: r.minutesEarned,
      minutesSpent: r.minutesSpent,
      dpEarned: r.dpEarned,
    }));
  },
});
