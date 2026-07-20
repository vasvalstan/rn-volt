import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { auth } from "./auth";

const clientEventNames = new Set([
  "referral_share_started",
  "referral_share_completed",
  "achievement_share_started",
  "achievement_share_completed",
  "paywall_viewed",
  "purchase_started",
  "purchase_completed",
  "purchase_failed",
]);

const propertiesValidator = v.optional(
  v.object({
    activityType: v.optional(v.string()),
    screen: v.optional(v.string()),
    milestone: v.optional(v.string()),
    shareType: v.optional(v.string()),
    currentStreak: v.optional(v.number()),
    minutesEarned: v.optional(v.number()),
    value: v.optional(v.number()),
    success: v.optional(v.boolean()),
  }),
);

export const trackClientEvent = mutation({
  args: {
    name: v.string(),
    properties: propertiesValidator,
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (!clientEventNames.has(args.name)) {
      throw new Error("Unsupported growth event");
    }

    await ctx.db.insert("growthEvents", {
      userId,
      name: args.name,
      occurredAt: Date.now(),
      properties: args.properties,
    });
  },
});

export const markReviewPrompted = mutation({
  args: {
    milestone: v.string(),
    currentStreak: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    if (profile.reviewPromptedAt) return false;

    const now = Date.now();
    await ctx.db.patch(profile._id, { reviewPromptedAt: now });
    await ctx.db.insert("growthEvents", {
      userId,
      name: "review_prompted",
      occurredAt: now,
      properties: {
        milestone: args.milestone.slice(0, 80),
        currentStreak: args.currentStreak,
      },
    });
    return true;
  },
});

export const markSocialReferralIntroSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    if (profile.socialReferralIntroSeenAt) return false;

    const now = Date.now();
    await ctx.db.patch(profile._id, { socialReferralIntroSeenAt: now });
    await ctx.db.insert("growthEvents", {
      userId,
      name: "social_referral_spotlight_viewed",
      occurredAt: now,
      properties: {
        screen: "social",
        value: 100,
      },
    });
    return true;
  },
});
