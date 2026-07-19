import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export function currentWeekStart(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - now.getUTCDay());
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString().split("T")[0];
}
export async function addWeeklyScore(
  ctx: MutationCtx,
  userId: Id<"users">,
  amount: number,
  league = "bronze",
) {
  if (amount <= 0) return;
  const weekStart = currentWeekStart();
  const existing = await ctx.db
    .query("weeklyScores")
    .withIndex("by_userId_week", (q) =>
      q.eq("userId", userId).eq("weekStart", weekStart),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      dp: existing.dp + amount,
      league,
    });
  } else {
    await ctx.db.insert("weeklyScores", {
      userId,
      weekStart,
      dp: amount,
      division: 3,
      league,
    });
  }
}
