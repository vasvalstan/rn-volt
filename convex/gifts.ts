import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { STORE_CATALOG } from "./store";

const MAX_GIFTS_PER_DAY = 3;
const MAX_COIN_PER_GIFT = 50;
const COOLDOWN_SAME_PERSON_MS = 24 * 60 * 60 * 1000;
const EXEMPT_FROM_CAP = new Set(["lazy_pass"]);

function findCatalogItem(itemId: string) {
  return STORE_CATALOG.find((i) => i.itemId === itemId);
}

export const sendGift = mutation({
  args: {
    toUserId: v.id("users"),
    itemId: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (userId === args.toUserId) throw new Error("Cannot gift to yourself");

    const item = findCatalogItem(args.itemId);
    if (!item) throw new Error("Item not found");
    if (!item.isGiftable) throw new Error("This item is not giftable");

    if (!EXEMPT_FROM_CAP.has(args.itemId) && item.price > MAX_COIN_PER_GIFT) {
      throw new Error(`Gift cost exceeds the ${MAX_COIN_PER_GIFT} coin cap`);
    }

    const senderProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!senderProfile) throw new Error("Profile not found");

    if ((senderProfile.coinBalance ?? 0) < item.price)
      throw new Error("Not enough coins");

    const recipientProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.toUserId))
      .unique();
    if (!recipientProfile) throw new Error("Recipient not found");

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const recentGifts = await ctx.db
      .query("gifts")
      .withIndex("by_fromUser_date", (q) => q.eq("fromUserId", userId))
      .collect()
      .then((g) => g.filter((gift) => gift.sentAt >= todayStart.getTime()));

    if (recentGifts.length >= MAX_GIFTS_PER_DAY)
      throw new Error(`You can only send ${MAX_GIFTS_PER_DAY} gifts per day`);

    const lastToSamePerson = recentGifts
      .filter((g) => g.toUserId === args.toUserId)
      .sort((a, b) => b.sentAt - a.sentAt)[0];

    if (lastToSamePerson && now - lastToSamePerson.sentAt < COOLDOWN_SAME_PERSON_MS)
      throw new Error("Wait 24h before gifting this person again");

    await ctx.db.patch(senderProfile._id, {
      coinBalance: (senderProfile.coinBalance ?? 0) - item.price,
    });

    let giftType = "store_item";
    if (item.category === "freeze") {
      giftType = "lazy_pass";
      await ctx.db.patch(recipientProfile._id, {
        freezesRemaining: recipientProfile.freezesRemaining + 1,
      });
    } else if (item.category === "vp") {
      giftType = "vp";
      await ctx.db.patch(recipientProfile._id, {
        totalDp: recipientProfile.totalDp + 50,
      });
    } else if (item.category === "skin" || item.category === "shield_theme") {
      await ctx.db.insert("ownedItems", {
        userId: args.toUserId,
        itemId: args.itemId,
        acquiredAt: now,
        source: "gift",
      });
    }

    await ctx.db.insert("gifts", {
      fromUserId: userId,
      toUserId: args.toUserId,
      itemId: args.itemId,
      giftType,
      coinCost: item.price,
      message: args.message,
      sentAt: now,
      claimed: false,
    });

    return { success: true };
  },
});

export const getReceivedGifts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const gifts = await ctx.db
      .query("gifts")
      .withIndex("by_toUser", (q) => q.eq("toUserId", userId))
      .collect();

    const unclaimed = gifts.filter((g) => !g.claimed);

    return await Promise.all(
      unclaimed.map(async (gift) => {
        const senderProfile = await ctx.db
          .query("profiles")
          .withIndex("by_userId", (q) => q.eq("userId", gift.fromUserId))
          .unique();

        const item = findCatalogItem(gift.itemId);

        return {
          _id: gift._id,
          fromName: senderProfile?.displayName ?? "A Voltling",
          fromAvatarUrl: senderProfile?.avatarUrl,
          itemName: item?.name ?? gift.itemId,
          giftType: gift.giftType,
          message: gift.message,
          sentAt: gift.sentAt,
        };
      })
    );
  },
});

export const claimGift = mutation({
  args: { giftId: v.id("gifts") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const gift = await ctx.db.get(args.giftId);
    if (!gift || gift.toUserId !== userId) throw new Error("Gift not found");

    await ctx.db.patch(args.giftId, { claimed: true });
    return { success: true };
  },
});

export const getSentGiftsToday = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return 0;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const gifts = await ctx.db
      .query("gifts")
      .withIndex("by_fromUser_date", (q) => q.eq("fromUserId", userId))
      .collect()
      .then((g) => g.filter((gift) => gift.sentAt >= todayStart.getTime()));

    return gifts.length;
  },
});
