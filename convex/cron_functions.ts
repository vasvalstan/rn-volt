import { internalMutation } from "./_generated/server";

export const snapshotWeeklyLeaderboard = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const oneWeekAgo = weekStart.getTime();

    const profiles = await ctx.db.query("profiles").collect();

    for (const profile of profiles) {
      const activities = await ctx.db
        .query("activities")
        .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
        .collect();

      const weeklyDp = activities
        .filter((a) => a._creationTime >= oneWeekAgo)
        .reduce((sum, a) => sum + a.dpEarned, 0);

      const existing = await ctx.db
        .query("weeklyScores")
        .withIndex("by_userId_week", (q) =>
          q.eq("userId", profile.userId).eq("weekStart", weekStartStr)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { dp: weeklyDp, league: profile.league ?? "bronze" });
      } else {
        await ctx.db.insert("weeklyScores", {
          userId: profile.userId,
          weekStart: weekStartStr,
          dp: weeklyDp,
          division: 3,
          league: profile.league ?? "bronze",
        });
      }
    }
  },
});

export const checkAllStreaks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("profiles").collect();
    const today = new Date();

    for (const profile of profiles) {
      if (!profile.lastActivityDate) continue;

      const lastActivity = new Date(profile.lastActivityDate);
      const diffDays = Math.floor(
        (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays > 1 && profile.currentStreak > 0) {
        await ctx.db.patch(profile._id, { currentStreak: 0 });
      }
    }
  },
});
