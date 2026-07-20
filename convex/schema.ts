import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    goal: v.optional(v.string()),
    persona: v.optional(v.string()),
    /** fitness only: "beginner" | "decent" — tailors training map + GPS milestones */
    movementLevel: v.optional(v.string()),
    difficultyLevel: v.optional(v.string()),
    rank: v.string(),
    totalDp: v.number(),
    currentStreak: v.number(),
    bestStreak: v.number(),
    lastActivityDate: v.optional(v.string()),
    freezesRemaining: v.number(),
    /** UTC refill period key: `week:YYYY-MM-DD` for weekly or `YYYY-MM` for monthly/yearly. */
    freezesMonthKey: v.optional(v.string()),
    minutesAvailable: v.number(),
    onboardingComplete: v.boolean(),
    /** Self-reported typical daily minutes on shielded / toxic apps (onboarding). */
    baselineToxicMinutesPerDay: v.optional(v.number()),
    /** Target % reduction (e.g. 20 = cut ~20% of baseline). */
    scrollReductionGoalPercent: v.optional(v.number()),
    /** "screen_time" if derived from real Screen Time / UsageStats data, "manual" if user-selected chip. */
    baselineSource: v.optional(v.string()),
    /** When baseline was last set (ms since epoch). */
    baselineCapturedAt: v.optional(v.number()),
    /** Coin balance for cosmetics and gifting. */
    coinBalance: v.optional(v.number()),
    /** Total unlock minutes ever credited (welcome bonus + activities). */
    lifetimeMinutesEarned: v.optional(v.number()),
    /** Idempotency marker for the one-time post-purchase welcome reward. */
    welcomeBonusClaimedAt: v.optional(v.number()),
    /** UTC day when the three-activity daily mission reward was last granted. */
    lastDailyQuestClaimDate: v.optional(v.string()),
    /** UTC day when each once-daily Store fuel boost was last purchased. */
    lastFuel5PurchaseDate: v.optional(v.string()),
    lastFuel10PurchaseDate: v.optional(v.string()),
    /** Total unlock minutes logged as spent (scroll budget used). */
    lifetimeMinutesSpent: v.optional(v.number()),
    /** Weekly league tier: "bronze" | "silver" | "gold" | "platinum" | "diamond" */
    league: v.optional(v.string()),
    /** ISO week string when user was last promoted/demoted. */
    leaguePromotedAt: v.optional(v.string()),
    /** Currently equipped mascot skin ID (e.g. "skin_flame"). */
    equippedSkin: v.optional(v.string()),
    /** Currently equipped shield theme ID. */
    equippedShieldTheme: v.optional(v.string()),
    /** Unique 6-char alphanumeric friend code for adding friends. */
    friendCode: v.optional(v.string()),
    /** Set once we have asked for an App Store / Play Store rating. */
    reviewPromptedAt: v.optional(v.number()),
    /** Set after the one-time two-sided referral spotlight is shown in Social. */
    socialReferralIntroSeenAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_totalDp", ["totalDp"])
    .index("by_friendCode", ["friendCode"]),

  activities: defineTable({
    userId: v.id("users"),
    type: v.string(),
    dpEarned: v.number(),
    minutesEarned: v.number(),
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
    verificationMethod: v.string(),
    verified: v.boolean(),
  }).index("by_userId", ["userId"]),

  activitySessions: defineTable({
    userId: v.id("users"),
    activityType: v.string(),
    activityName: v.string(),
    mode: v.string(),
    status: v.string(),
    turns: v.array(
      v.object({
        role: v.union(v.literal("assistant"), v.literal("user")),
        text: v.string(),
        at: v.number(),
      })
    ),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    note: v.optional(v.string()),
    trigger: v.optional(
      v.object({
        type: v.string(),
        minutesSpent: v.optional(v.number()),
        reason: v.optional(v.string()),
      })
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_activityType", ["userId", "activityType"]),

  blockedApps: defineTable({
    userId: v.id("users"),
    appName: v.string(),
    appIcon: v.string(),
    appColor: v.string(),
    isLocked: v.boolean(),
  }).index("by_userId", ["userId"]),

  mapProgress: defineTable({
    userId: v.id("users"),
    nodeId: v.number(),
    status: v.string(),
    completedAt: v.optional(v.number()),
    label: v.optional(v.string()),
    activityKeys: v.optional(v.array(v.string())),
    dp: v.optional(v.number()),
    nodeType: v.optional(v.string()),
    desc: v.optional(v.string()),
    section: v.optional(v.string()),
    completedActivityKeys: v.optional(v.array(v.string())),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_nodeId", ["userId", "nodeId"]),

  friends: defineTable({
    userId: v.id("users"),
    friendId: v.id("users"),
    status: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_friendId", ["userId", "friendId"])
    .index("by_friendId", ["friendId"]),

  /** Two-sided referral attribution. Rewards unlock after the invitee's first activity. */
  referrals: defineTable({
    inviterUserId: v.id("users"),
    invitedUserId: v.id("users"),
    friendCode: v.string(),
    status: v.union(v.literal("accepted"), v.literal("activated")),
    acceptedAt: v.number(),
    activatedAt: v.optional(v.number()),
    rewardCoins: v.number(),
    rewardFreezes: v.number(),
  })
    .index("by_invitedUserId", ["invitedUserId"])
    .index("by_invitedUserId_status", ["invitedUserId", "status"])
    .index("by_inviterUserId", ["inviterUserId"]),

  /** First-party product analytics for activation, retention, sharing, and revenue funnels. */
  growthEvents: defineTable({
    userId: v.id("users"),
    name: v.string(),
    occurredAt: v.number(),
    properties: v.optional(
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
    ),
  })
    .index("by_userId", ["userId"])
    .index("by_name_occurredAt", ["name", "occurredAt"])
    .index("by_userId_name", ["userId", "name"]),

  weeklyScores: defineTable({
    userId: v.id("users"),
    weekStart: v.string(),
    dp: v.number(),
    division: v.number(),
    league: v.optional(v.string()),
  })
    .index("by_week", ["weekStart"])
    .index("by_userId_week", ["userId", "weekStart"]),

  /** Per-user UTC-week aggregates for fuel economy tuning. */
  weeklyFuelRollups: defineTable({
    userId: v.id("users"),
    weekStart: v.string(),
    minutesEarned: v.number(),
    minutesSpent: v.number(),
    dpEarned: v.number(),
  })
    .index("by_userId_week", ["userId", "weekStart"])
    .index("by_userId", ["userId"]),

  storeItems: defineTable({
    itemId: v.string(),
    category: v.string(),
    name: v.string(),
    description: v.string(),
    price: v.number(),
    imageUrl: v.optional(v.string()),
    isGiftable: v.boolean(),
    isSelfPurchasable: v.boolean(),
  }).index("by_itemId", ["itemId"]),

  ownedItems: defineTable({
    userId: v.id("users"),
    itemId: v.string(),
    acquiredAt: v.number(),
    source: v.string(),
  }).index("by_userId", ["userId"]),

  gifts: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    itemId: v.string(),
    giftType: v.string(),
    coinCost: v.number(),
    message: v.optional(v.string()),
    sentAt: v.number(),
    claimed: v.boolean(),
  })
    .index("by_toUser", ["toUserId"])
    .index("by_toUser_claimed", ["toUserId", "claimed"])
    .index("by_fromUser_date", ["fromUserId", "sentAt"]),

  voiceQuotaWindows: defineTable({
    userId: v.id("users"),
    plan: v.union(v.literal("weekly"), v.literal("monthly")),
    periodKey: v.string(),
    periodStartAt: v.number(),
    periodEndAt: v.number(),
    allowanceMs: v.number(),
    usedMs: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_periodKey", ["userId", "periodKey"])
    .index("by_userId", ["userId"]),

  voiceRealtimeSessions: defineTable({
    userId: v.id("users"),
    quotaWindowId: v.id("voiceQuotaWindows"),
    activityType: v.string(),
    activityName: v.string(),
    mode: v.union(v.literal("reflective"), v.literal("movement")),
    status: v.union(
      v.literal("reserved"),
      v.literal("active"),
      v.literal("ended"),
      v.literal("cancelled"),
    ),
    authorizedDurationMs: v.number(),
    reservedAt: v.number(),
    startedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    billedDurationMs: v.optional(v.number()),
    endReason: v.optional(v.string()),
    providerCallId: v.optional(v.string()),
    model: v.optional(v.string()),
    voice: v.optional(v.string()),
    monitorStartedAt: v.optional(v.number()),
    monitorError: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_quotaWindowId", ["quotaWindowId"])
    .index("by_providerCallId", ["providerCallId"]),

  voiceRealtimeUsageEvents: defineTable({
    userId: v.id("users"),
    sessionId: v.id("voiceRealtimeSessions"),
    responseId: v.string(),
    eventKey: v.string(),
    source: v.union(v.literal("server"), v.literal("client")),
    recordedAt: v.number(),
    totalTokens: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    inputTextTokens: v.number(),
    inputAudioTokens: v.number(),
    inputImageTokens: v.number(),
    cachedTokens: v.number(),
    cachedTextTokens: v.number(),
    cachedAudioTokens: v.number(),
    cachedImageTokens: v.number(),
    outputTextTokens: v.number(),
    outputAudioTokens: v.number(),
    estimatedCostUsd: v.number(),
  })
    .index("by_session_eventKey", ["sessionId", "eventKey"])
    .index("by_userId", ["userId"]),
});
