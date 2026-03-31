/** Mirrors convex/activities.ts RANK_THRESHOLDS — keep in sync when tuning ranks. */
export const RANK_THRESHOLDS: Record<string, number> = {
  starter: 0,
  disciplined: 500,
  warrior: 2000,
  elite: 5000,
  legend: 10000,
};

const RANK_ORDER = ["starter", "disciplined", "warrior", "elite", "legend"] as const;

export type RankKey = (typeof RANK_ORDER)[number];

export function rankProgressInCurrentTier(
  totalDp: number,
  currentRank: string
): { percentToNext: number; label: string } {
  const rank = (RANK_ORDER.includes(currentRank as RankKey) ? currentRank : "starter") as RankKey;
  const idx = RANK_ORDER.indexOf(rank);

  if (rank === "legend") {
    return { percentToNext: 100, label: "Max rank!" };
  }

  const prevThreshold = RANK_THRESHOLDS[rank];
  const nextRank = RANK_ORDER[idx + 1];
  const nextThreshold = RANK_THRESHOLDS[nextRank];
  const span = nextThreshold - prevThreshold;
  if (span <= 0) {
    return { percentToNext: 100, label: "Max rank!" };
  }

  const pct = Math.min(100, Math.max(0, Math.round(((totalDp - prevThreshold) / span) * 100)));
  const nextLabel =
    nextRank === "disciplined"
      ? "Disciplined"
      : nextRank === "warrior"
        ? "Warrior"
        : nextRank === "elite"
          ? "Elite"
          : "Legend";

  return { percentToNext: pct, label: `${pct}% to ${nextLabel}` };
}
