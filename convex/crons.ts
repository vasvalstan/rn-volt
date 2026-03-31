import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.weekly(
  "weekly leaderboard snapshot",
  { dayOfWeek: "sunday", hourUTC: 0, minuteUTC: 0 },
  internal.cron_functions.snapshotWeeklyLeaderboard
);

crons.weekly(
  "weekly league promotions",
  { dayOfWeek: "sunday", hourUTC: 0, minuteUTC: 5 },
  internal.leaderboard.processWeeklyPromotions
);

crons.daily(
  "daily streak check",
  { hourUTC: 6, minuteUTC: 0 },
  internal.cron_functions.checkAllStreaks
);

export default crons;
