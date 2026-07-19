import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { auth } from "./auth";

export const LEAGUES = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type LeagueKey = (typeof LEAGUES)[number];

const LEAGUE_LABELS: Record<LeagueKey, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

const PROMOTION_COIN_BONUS = 50;

function currentWeekStart(): string {
  const now = new Date();
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

function previousWeekStart(): string {
  const previous = new Date();
  previous.setUTCDate(previous.getUTCDate() - previous.getUTCDay() - 7);
  previous.setUTCHours(0, 0, 0, 0);
  return previous.toISOString().split("T")[0];
}

function nextSundayMidnightUTC(): number {
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilSunday);
  next.setUTCHours(0, 0, 0, 0);
  return next.getTime();
}

export const getWeeklyRankings = query({
  args: {
    tab: v.optional(
      v.union(
        v.literal("league"),
        v.literal("alltime"),
        v.literal("friends"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    const tab = args.tab ?? "league";

    const myProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (tab === "alltime") {
      const allProfiles = await ctx.db
        .query("profiles")
        .withIndex("by_totalDp")
        .order("desc")
        .take(50);

      return allProfiles.map((profile, i) => ({
        rank: i + 1,
        userId: profile.userId as string,
        name: profile.displayName ?? "Voltling",
        title: profile.rank
          ? profile.rank.charAt(0).toUpperCase() + profile.rank.slice(1)
          : "Starter",
        dp: profile.totalDp.toLocaleString(),
        dpRaw: profile.totalDp,
        avatarUrl: profile.avatarUrl,
        isYou: profile.userId === userId,
        dim: false,
        persona: profile.persona,
        difficultyLevel: profile.difficultyLevel,
        equippedSkin: profile.equippedSkin,
        inPromotionZone: false,
        inDemotionZone: false,
      }));
    }

    if (tab === "friends") {
      const friendships = await ctx.db
        .query("friends")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
      const acceptedFriendIds = friendships
        .filter((f) => f.status === "accepted")
        .map((f) => f.friendId);

      const friendIdsIncludingSelf = [userId, ...acceptedFriendIds].slice(0, 200);
      const weekStart = currentWeekStart();

      const friendScores = (
        await Promise.all(
          friendIdsIncludingSelf.map((friendId) =>
            ctx.db
              .query("weeklyScores")
              .withIndex("by_userId_week", (q) =>
                q.eq("userId", friendId).eq("weekStart", weekStart),
              )
              .unique(),
          ),
        )
      )
        .filter((score) => score !== null)
        .sort((a, b) => b.dp - a.dp);

      return await Promise.all(
        friendScores.map(async (score, i) => {
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_userId", (q) => q.eq("userId", score.userId))
            .unique();
          return {
            rank: i + 1,
            userId: score.userId as string,
            name: profile?.displayName ?? "Voltling",
            title: profile?.rank
              ? profile.rank.charAt(0).toUpperCase() + profile.rank.slice(1)
              : "Starter",
            dp: score.dp.toLocaleString(),
            dpRaw: score.dp,
            avatarUrl: profile?.avatarUrl,
            isYou: score.userId === userId,
            dim: false,
            persona: profile?.persona,
            difficultyLevel: profile?.difficultyLevel,
            equippedSkin: profile?.equippedSkin,
            inPromotionZone: false,
            inDemotionZone: false,
          };
        })
      );
    }

    // Default: "league" tab
    const myLeague = (myProfile?.league as LeagueKey) ?? "bronze";
    const weekStart = currentWeekStart();

    const weekScores = await ctx.db
      .query("weeklyScores")
      .withIndex("by_week", (q) => q.eq("weekStart", weekStart))
      .take(500);

    const leagueScores = weekScores.filter(
      (s) => (s.league ?? "bronze") === myLeague
    );

    leagueScores.sort((a, b) => b.dp - a.dp);

    return await Promise.all(
      leagueScores.map(async (score, i) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_userId", (q) => q.eq("userId", score.userId))
          .unique();

        return {
          rank: i + 1,
          userId: score.userId as string,
          name: profile?.displayName ?? "Voltling",
          title: profile?.rank
            ? profile.rank.charAt(0).toUpperCase() + profile.rank.slice(1)
            : "Starter",
          dp: score.dp.toLocaleString(),
          dpRaw: score.dp,
          avatarUrl: profile?.avatarUrl,
          isYou: score.userId === userId,
          dim: false,
          persona: profile?.persona,
          difficultyLevel: profile?.difficultyLevel,
          equippedSkin: profile?.equippedSkin,
          inPromotionZone: i < 3,
          inDemotionZone: i >= leagueScores.length - 2 && leagueScores.length > 4,
        };
      })
    );
  },
});

export const getDivisionInfo = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) return null;

    const myLeague = (profile.league as LeagueKey) ?? "bronze";
    const weekStart = currentWeekStart();

    const weekScores = await ctx.db
      .query("weeklyScores")
      .withIndex("by_week", (q) => q.eq("weekStart", weekStart))
      .take(500);

    const leagueScores = weekScores
      .filter((s) => (s.league ?? "bronze") === myLeague)
      .sort((a, b) => b.dp - a.dp);

    const userRank =
      leagueScores.findIndex((s) => s.userId === userId) + 1;
    const userDp = leagueScores.find((score) => score.userId === userId)?.dp ?? 0;
    const promotionDp = leagueScores.length >= 3 ? leagueScores[2].dp : 0;

    return {
      league: myLeague,
      leagueName: LEAGUE_LABELS[myLeague],
      userRank: userRank || leagueScores.length + 1,
      totalUsers: leagueScores.length,
      promotionThreshold: 3,
      demotionThreshold: Math.max(0, leagueScores.length - 1),
      isInPromotionZone: userRank > 0 && userRank <= 3,
      isInDemotionZone:
        userRank > 0 &&
        leagueScores.length > 4 &&
        userRank > leagueScores.length - 2,
      userDp,
      promotionDp,
      dpToPromotion: Math.max(0, promotionDp - userDp + (promotionDp > userDp ? 1 : 0)),
      weekEndsAt: nextSundayMidnightUTC(),
    };
  },
});

export const processWeeklyPromotions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const weekStart = previousWeekStart();

    const weekScores = await ctx.db
      .query("weeklyScores")
      .withIndex("by_week", (q) => q.eq("weekStart", weekStart))
      .collect();

    for (const league of LEAGUES) {
      const leagueScores = weekScores
        .filter((s) => (s.league ?? "bronze") === league)
        .sort((a, b) => b.dp - a.dp);

      if (leagueScores.length === 0) continue;

      const leagueIdx = LEAGUES.indexOf(league);

      // Top 3 promote (if not already in diamond)
      if (leagueIdx < LEAGUES.length - 1) {
        const nextLeague = LEAGUES[leagueIdx + 1];
        const promoteSlice = leagueScores.slice(0, 3);
        for (const score of promoteSlice) {
          if (score.dp <= 0) continue;
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_userId", (q) => q.eq("userId", score.userId))
            .unique();
          if (profile) {
            if (profile.leaguePromotedAt === weekStart) continue;
            await ctx.db.patch(profile._id, {
              league: nextLeague,
              leaguePromotedAt: weekStart,
              coinBalance: (profile.coinBalance ?? 0) + PROMOTION_COIN_BONUS,
            });
          }
        }
      }

      // Bottom 2 demote (if not already in bronze)
      if (leagueIdx > 0 && leagueScores.length > 4) {
        const prevLeague = LEAGUES[leagueIdx - 1];
        const demoteSlice = leagueScores.slice(-2);
        for (const score of demoteSlice) {
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_userId", (q) => q.eq("userId", score.userId))
            .unique();
          if (profile) {
            if (profile.leaguePromotedAt === weekStart) continue;
            await ctx.db.patch(profile._id, {
              league: prevLeague,
              leaguePromotedAt: weekStart,
            });
          }
        }
      }
    }
  },
});
