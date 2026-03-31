import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** Monday UTC as YYYY-MM-DD (ISO date). */
export function utcWeekStartString(d: Date = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - daysFromMonday);
  return x.toISOString().slice(0, 10);
}

export async function bumpWeeklyFuelRollup(
  ctx: MutationCtx,
  userId: Id<"users">,
  delta: { minutesEarned?: number; minutesSpent?: number; dpEarned?: number }
): Promise<void> {
  const weekStart = utcWeekStartString();
  const existing = await ctx.db
    .query("weeklyFuelRollups")
    .withIndex("by_userId_week", (q) => q.eq("userId", userId).eq("weekStart", weekStart))
    .unique();

  const addMinEarned = delta.minutesEarned ?? 0;
  const addMinSpent = delta.minutesSpent ?? 0;
  const addDp = delta.dpEarned ?? 0;

  if (existing) {
    await ctx.db.patch(existing._id, {
      minutesEarned: existing.minutesEarned + addMinEarned,
      minutesSpent: existing.minutesSpent + addMinSpent,
      dpEarned: existing.dpEarned + addDp,
    });
  } else {
    await ctx.db.insert("weeklyFuelRollups", {
      userId,
      weekStart,
      minutesEarned: addMinEarned,
      minutesSpent: addMinSpent,
      dpEarned: addDp,
    });
  }
}
