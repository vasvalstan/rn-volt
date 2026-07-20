import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const FRIEND_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const REFERRAL_REWARD_COINS = 100;
const REFERRAL_REWARD_FREEZES = 1;

// ─── FRIEND CODE ─────────────────────────────────────

export const getMyFriendCode = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    return profile?.friendCode ?? null;
  },
});

export const generateFriendCode = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile not found");

    if (profile.friendCode) return profile.friendCode;

    let code: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode();
      const existing = await ctx.db
        .query("profiles")
        .withIndex("by_friendCode", (q) => q.eq("friendCode", candidate))
        .unique();
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Could not generate a unique friend code");

    await ctx.db.patch(profile._id, { friendCode: code });
    return code;
  },
});

export const addFriendByCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const normalized = args.code.trim().toUpperCase();
    if (!FRIEND_CODE_PATTERN.test(normalized)) {
      throw new Error("Invalid friend code");
    }

    const friendProfile = await ctx.db
      .query("profiles")
      .withIndex("by_friendCode", (q) => q.eq("friendCode", normalized))
      .first();
    if (!friendProfile) throw new Error("No user found with that code");
    if (friendProfile.userId === userId)
      throw new Error("That's your own code!");

    const existing = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", userId).eq("friendId", friendProfile.userId),
      )
      .first();

    if (existing) {
      throw new Error("You're already friends!");
    }
    const reverseExisting = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", friendProfile.userId).eq("friendId", userId),
      )
      .first();
    if (reverseExisting) {
      throw new Error("A friend request already exists");
    }

    await ctx.db.insert("friends", {
      userId,
      friendId: friendProfile.userId,
      status: "accepted",
    });
    await ctx.db.insert("friends", {
      userId: friendProfile.userId,
      friendId: userId,
      status: "accepted",
    });

    const [priorActivity, existingReferral] = await Promise.all([
      ctx.db
        .query("activities")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first(),
      ctx.db
        .query("referrals")
        .withIndex("by_invitedUserId", (q) => q.eq("invitedUserId", userId))
        .first(),
    ]);
    const referralEligible = !priorActivity && !existingReferral;
    const now = Date.now();

    await ctx.db.insert("growthEvents", {
      userId,
      name: "friend_added",
      occurredAt: now,
      properties: {
        screen: "social",
      },
    });

    if (referralEligible) {
      await ctx.db.insert("referrals", {
        inviterUserId: friendProfile.userId,
        invitedUserId: userId,
        friendCode: normalized,
        status: "accepted",
        acceptedAt: now,
        rewardCoins: REFERRAL_REWARD_COINS,
        rewardFreezes: REFERRAL_REWARD_FREEZES,
      });
      await ctx.db.insert("growthEvents", {
        userId,
        name: "referral_accepted",
        occurredAt: now,
        properties: {
          screen: "social",
          value: REFERRAL_REWARD_COINS,
        },
      });
      await ctx.db.insert("growthEvents", {
        userId: friendProfile.userId,
        name: "referral_invite_accepted",
        occurredAt: now,
        properties: {
          value: REFERRAL_REWARD_COINS,
        },
      });
    }

    return {
      friendName: friendProfile.displayName,
      referralEligible,
      rewardCoins: referralEligible ? REFERRAL_REWARD_COINS : 0,
      rewardFreezes: referralEligible ? REFERRAL_REWARD_FREEZES : 0,
    };
  },
});

// ─── FRIENDS LIST ────────────────────────────────────

export const getFriends = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const friendships = await ctx.db
      .query("friends")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      friendships.map(async (f) => {
        const friendProfile = await ctx.db
          .query("profiles")
          .withIndex("by_userId", (q) => q.eq("userId", f.friendId))
          .unique();
        return {
          _id: f._id,
          friendId: f.friendId,
          status: f.status,
          displayName: friendProfile?.displayName ?? "Unknown",
          avatarUrl: friendProfile?.avatarUrl,
          totalDp: friendProfile?.totalDp ?? 0,
        };
      })
    );
  },
});

export const getFriendRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const requests = await ctx.db
      .query("friends")
      .withIndex("by_friendId", (q) => q.eq("friendId", userId))
      .collect();

    const pending = requests.filter((r) => r.status === "pending");

    return await Promise.all(
      pending.map(async (r) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_userId", (q) => q.eq("userId", r.userId))
          .unique();
        return {
          _id: r._id,
          fromUserId: r.userId,
          displayName: profile?.displayName ?? "Unknown",
          avatarUrl: profile?.avatarUrl,
        };
      })
    );
  },
});

// ─── FRIEND MANAGEMENT ───────────────────────────────

export const sendFriendRequest = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (userId === args.friendId) throw new Error("Cannot friend yourself");

    const existing = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", userId).eq("friendId", args.friendId),
      )
      .first();

    if (existing) {
      throw new Error("Friend request already exists");
    }
    const reverseExisting = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", args.friendId).eq("friendId", userId),
      )
      .first();
    if (reverseExisting) {
      throw new Error("This user has already sent you a friend request");
    }

    await ctx.db.insert("friends", {
      userId,
      friendId: args.friendId,
      status: "pending",
    });
  },
});

export const acceptFriend = mutation({
  args: { requestId: v.id("friends") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const request = await ctx.db.get(args.requestId);
    if (!request || request.friendId !== userId)
      throw new Error("Request not found");

    await ctx.db.patch(args.requestId, { status: "accepted" });

    const reverse = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", userId).eq("friendId", request.userId),
      )
      .first();
    if (reverse) {
      await ctx.db.patch(reverse._id, { status: "accepted" });
    } else {
      await ctx.db.insert("friends", {
        userId,
        friendId: request.userId,
        status: "accepted",
      });
    }
  },
});

export const rejectFriend = mutation({
  args: { requestId: v.id("friends") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const request = await ctx.db.get(args.requestId);
    if (!request || request.friendId !== userId)
      throw new Error("Request not found");

    await ctx.db.delete(args.requestId);
  },
});

export const removeFriend = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const myRow = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", userId).eq("friendId", args.friendId),
      )
      .first();
    if (myRow) await ctx.db.delete(myRow._id);

    const theirRow = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", args.friendId).eq("friendId", userId),
      )
      .first();
    if (theirRow) await ctx.db.delete(theirRow._id);
  },
});

export const checkFriendship = query({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return "none";

    const match = await ctx.db
      .query("friends")
      .withIndex("by_userId_friendId", (q) =>
        q.eq("userId", userId).eq("friendId", args.otherUserId),
      )
      .first();

    if (!match) return "none";
    return match.status as "accepted" | "pending";
  },
});

// ─── ACTIVITY FEED ───────────────────────────────────

export const getFriendActivity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const friendships = await ctx.db
      .query("friends")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const acceptedFriends = friendships.filter((f) => f.status === "accepted");
    if (acceptedFriends.length === 0) return [];

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const feed: {
      type: string;
      userId: string;
      name: string;
      avatarUrl?: string;
      text: string;
      timestamp: number;
    }[] = [];

    for (const f of acceptedFriends.slice(0, 20)) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", f.friendId))
        .unique();
      if (!profile) continue;

      const activities = await ctx.db
        .query("activities")
        .withIndex("by_userId", (q) => q.eq("userId", f.friendId))
        .order("desc")
        .take(5);

      for (const a of activities) {
        if (a._creationTime < oneDayAgo) continue;
        feed.push({
          type: "activity",
          userId: f.friendId as string,
          name: profile.displayName,
          avatarUrl: profile.avatarUrl,
          text: `completed ${a.type} (+${a.dpEarned} VP)`,
          timestamp: a._creationTime,
        });
      }

      if (profile.currentStreak >= 7 && profile.currentStreak % 7 === 0) {
        feed.push({
          type: "streak",
          userId: f.friendId as string,
          name: profile.displayName,
          avatarUrl: profile.avatarUrl,
          text: `reached Day ${profile.currentStreak} streak!`,
          timestamp: Date.now(),
        });
      }
    }

    const recentGifts = await ctx.db
      .query("gifts")
      .withIndex("by_fromUser_date", (q) =>
        q.eq("fromUserId", userId).gte("sentAt", oneDayAgo),
      )
      .collect();

    for (const gift of recentGifts.slice(0, 5)) {
      const recipientProfile = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", gift.toUserId))
        .unique();
      feed.push({
        type: "gift_sent",
        userId: gift.toUserId as string,
        name: "You",
        avatarUrl: undefined,
        text: `sent a gift to ${recipientProfile?.displayName ?? "a friend"}`,
        timestamp: gift.sentAt,
      });
    }

    feed.sort((a, b) => b.timestamp - a.timestamp);
    return feed.slice(0, 10);
  },
});
