import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

const LAZY_PASS_MONTHLY_CAP = 3;

function utcMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
 * Call when CustomerInfo updates. Weekly → 0 freezes; monthly/yearly → up to 3 per UTC calendar month.
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

    if (args.billingPeriod === "weekly") {
      await ctx.db.patch(profile._id, { freezesRemaining: 0 });
      return;
    }

    const monthKey = utcMonthKey(new Date());
    const needsRefill = profile.freezesMonthKey !== monthKey;

    if (needsRefill) {
      await ctx.db.patch(profile._id, {
        freezesRemaining: LAZY_PASS_MONTHLY_CAP,
        freezesMonthKey: monthKey,
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
      await ctx.db.patch(profile._id, {
        currentStreak: 0,
      });
    }
  },
});
