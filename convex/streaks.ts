import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

const LAZY_PASS_WEEKLY_CAP = 1;
const LAZY_PASS_MONTHLY_CAP = 3;

function utcMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcWeekKey(d: Date): string {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return `week:${monday.toISOString().slice(0, 10)}`;
}

export const getStreak = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) return null;

    return {
      currentStreak: profile.currentStreak,
      bestStreak: profile.bestStreak,
      freezesRemaining: profile.freezesRemaining,
      lastActivityDate: profile.lastActivityDate,
    };
  },
});

export const useFreeze = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");
    if (profile.freezesRemaining <= 0) throw new Error("No freezes remaining");

    await ctx.db.patch(profile._id, {
      freezesRemaining: profile.freezesRemaining - 1,
      lastActivityDate: new Date().toISOString().split("T")[0],
    });
  },
});

/**
 * Call when CustomerInfo updates. Weekly refills 1 pass per UTC week;
 * monthly/yearly refill up to 3 per UTC calendar month.
 */
export const syncStreakFreezeAllowance = mutation({
  args: {
    billingPeriod: v.union(
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("yearly")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");

    const now = new Date();
    const periodKey =
      args.billingPeriod === "weekly" ? utcWeekKey(now) : utcMonthKey(now);
    const allowance =
      args.billingPeriod === "weekly"
        ? LAZY_PASS_WEEKLY_CAP
        : LAZY_PASS_MONTHLY_CAP;
    const needsRefill = profile.freezesMonthKey !== periodKey;

    if (needsRefill) {
      await ctx.db.patch(profile._id, {
        freezesRemaining: allowance,
        freezesMonthKey: periodKey,
      });
    }
  },
});

export const checkAndResetStreak = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile || !profile.lastActivityDate) return;

    const today = new Date();
    const lastActivity = new Date(profile.lastActivityDate);
    const diffDays = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays > 1) {
      if ((profile.freezesRemaining ?? 0) > 0) {
        const yesterday = new Date(today);
        yesterday.setUTCDate(today.getUTCDate() - 1);
        await ctx.db.patch(profile._id, {
          freezesRemaining: Math.max(0, (profile.freezesRemaining ?? 0) - 1),
          lastActivityDate: yesterday.toISOString().split("T")[0],
        });
      } else {
        await ctx.db.patch(profile._id, { currentStreak: 0 });
      }
    }
  },
});
