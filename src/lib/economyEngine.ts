/**
 * Economy Engine — derives VP, minutes, and coin rewards from the user's
 * screen-time baseline, cut-back target, difficulty, and activity category.
 *
 * All reward values flow from a single anchor: the user's daily fuel budget.
 */
import { computeActivityReward as computeServerActivityReward } from "../../shared/gamification";

// ─── TYPES ───────────────────────────────────────────

export type DifficultyKey = "chill" | "balanced" | "beast";
export type ActivityCategory = "physical" | "mindful" | "micro" | "anti-scroll";

export interface GpsMilestoneComputed {
  distanceM: number;
  dp: number;
  minutes: number;
  label: string;
}

export interface EconomyProfile {
  baselineToxicMinutesPerDay: number;
  scrollReductionGoalPercent: number;
  difficulty: DifficultyKey;
}

export interface ActivityReward {
  minutes: number;
  vp: number;
}

// ─── CONSTANTS (tuning knobs) ────────────────────────

/** How many distinct activities a user is expected to complete per day. */
const EXPECTED_ACTIVITIES_PER_DAY = 4;

/** Converts 1 earned minute into VP. Keeps VP proportional to fuel. */
const VP_PER_MINUTE_RATIO = 2.0;

/** Category multipliers relative to the base reward per activity. */
const CATEGORY_MULT: Record<ActivityCategory, number> = {
  physical: 1.5,
  mindful: 1.0,
  micro: 0.6,
  "anti-scroll": 0.8,
};

/**
 * Difficulty affects VP (beast gets more for leaderboard prestige)
 * but NOT minutes — the fuel budget stays the same so users cannot
 * out-earn their cut-back target.
 */
const DIFFICULTY_VP_MULT: Record<DifficultyKey, number> = {
  chill: 1.0,
  balanced: 1.0,
  beast: 1.5,
};

/** Effort scaling: chill = fewer reps, beast = more. Only cosmetic in formulas. */
export const DIFFICULTY_EFFORT_MULT: Record<DifficultyKey, number> = {
  chill: 0.7,
  balanced: 1.0,
  beast: 1.3,
};

/** Fallback when profile has no baseline yet (first-time / manual skipped). */
const DEFAULT_BASELINE_MINUTES = 60;
const DEFAULT_REDUCTION_PERCENT = 20;

/** Map node type multipliers (relative to base VP per activity). */
const NODE_TYPE_VP_MULT: Record<string, number> = {
  regular: 1.0,
  rest: 0.5,
  chest: 2.0,
  boss: 4.0,
};

/** Phase multipliers for the 30-day map (Foundation / Building / Mastery). */
export const PHASE_DP_MULT = [1, 1.3, 1.6] as const;

// ─── CORE COMPUTATIONS ──────────────────────────────

export function dailyFuelBudget(profile: EconomyProfile): number {
  const baseline = profile.baselineToxicMinutesPerDay || DEFAULT_BASELINE_MINUTES;
  const pct = profile.scrollReductionGoalPercent || DEFAULT_REDUCTION_PERCENT;
  return Math.round(baseline * (1 - pct / 100));
}

export function baseMinutesPerActivity(profile: EconomyProfile): number {
  return Math.max(1, Math.round(dailyFuelBudget(profile) / EXPECTED_ACTIVITIES_PER_DAY));
}

export function baseVpPerActivity(profile: EconomyProfile): number {
  return Math.round(baseMinutesPerActivity(profile) * VP_PER_MINUTE_RATIO);
}

/**
 * Compute reward for a single activity completion.
 * Minutes are category-scaled but NOT difficulty-scaled.
 * VP is both category- and difficulty-scaled.
 */
export function computeReward(
  profile: EconomyProfile,
  category: ActivityCategory,
): ActivityReward {
  const baseMins = baseMinutesPerActivity(profile);
  const catMult = CATEGORY_MULT[category];
  const minutes = Math.max(1, Math.round(baseMins * catMult));
  const vp = Math.max(1, Math.round(
    minutes * VP_PER_MINUTE_RATIO * DIFFICULTY_VP_MULT[profile.difficulty],
  ));
  return { minutes, vp };
}

/**
 * Effort-scaled reward: anchored so 60 s of effort = 1x base reward.
 * Shorter tasks earn less, longer tasks earn more (capped at 3x).
 */
export function computeScaledReward(
  profile: EconomyProfile,
  category: ActivityCategory,
  effortDurationSec: number,
): ActivityReward {
  const effortMult = Math.max(0.15, Math.min(3, effortDurationSec / 60));
  const baseMins = baseMinutesPerActivity(profile);
  const catMult = CATEGORY_MULT[category];
  const minutes = Math.max(1, Math.round(baseMins * catMult * effortMult));
  const vp = Math.max(1, Math.round(
    minutes * VP_PER_MINUTE_RATIO * DIFFICULTY_VP_MULT[profile.difficulty],
  ));
  return { minutes, vp };
}

export function scaledCoinRewardForActivity(
  profile: EconomyProfile,
  category: ActivityCategory,
  effortDurationSec: number,
): number {
  const base = ACTIVITY_COIN_BASE[category];
  const effortMult = Math.max(0.25, Math.min(3, effortDurationSec / 60));
  return Math.max(1, Math.round(base * coinMultiplier(profile) * effortMult));
}

/**
 * Build a formula string like "30 reps = 12 min + 24 VP" for UI display.
 * The effort side (reps/distance/duration) comes from the activity's base
 * requirement scaled by difficulty effort multiplier.
 */
export function buildFormulaString(
  effortLabel: string,
  reward: ActivityReward,
): string {
  return `${effortLabel} = ${reward.minutes} min + ${reward.vp} VP`;
}

// ─── MAP NODE DP ─────────────────────────────────────

export function computeNodeDp(
  profile: EconomyProfile,
  nodeType: string,
  phaseMult: number = 1,
): number {
  const baseVp = baseVpPerActivity(profile);
  const nodeMult = NODE_TYPE_VP_MULT[nodeType] ?? 1;
  return Math.max(1, Math.round(baseVp * nodeMult * phaseMult));
}

// ─── GPS MILESTONES ──────────────────────────────────

const WALK_DISTANCES = [250, 500, 750, 1000, 1500, 2000, 3000, 5000];
const RUN_BEGINNER_DISTANCES = [500, 1000, 1500, 2000, 3000, 4000, 5000];
const RUN_DECENT_DISTANCES = [1000, 2000, 3000, 5000, 10000];

function distanceLabel(m: number): string {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`;
}

/**
 * Build personalized GPS milestones. Cumulative rewards scale linearly
 * from 0 to (physicalBase * distanceFactor) where distanceFactor maps
 * the milestone's position in the table.
 */
export function buildPersonalizedMilestones(
  profile: EconomyProfile,
  mode: "walk" | "run_beginner" | "run_decent",
): GpsMilestoneComputed[] {
  const distances =
    mode === "walk"
      ? WALK_DISTANCES
      : mode === "run_beginner"
        ? RUN_BEGINNER_DISTANCES
        : RUN_DECENT_DISTANCES;

  return distances.map((d) => {
    const reward = computeServerActivityReward(profile, "run", {
      distance: d,
    });
    return {
      distanceM: d,
      dp: reward.vp,
      minutes: reward.minutes,
      label: distanceLabel(d),
    };
  });
}

// ─── COINS (baseline-scaled) ─────────────────────────

export const COIN_REWARDS = {
  dailyLogin: 5,
  streak7: 25,
  streak14: 50,
  streak30: 100,
  mapChestMin: 10,
  mapChestMax: 50,
  bossNode: 25,
  leaderboardPromotion: 50,
} as const;

const ACTIVITY_COIN_BASE: Record<ActivityCategory, number> = {
  physical: 3,
  mindful: 2,
  micro: 1,
  "anti-scroll": 2,
};

export function coinRewardForActivity(
  profile: EconomyProfile,
  category: ActivityCategory,
): number {
  const base = ACTIVITY_COIN_BASE[category];
  return Math.max(1, Math.round(base * coinMultiplier(profile)));
}

/** Linear scaling: a 2h baseline user earns 2x coins vs a 1h user. Floor 0.5x. */
export function coinMultiplier(profile: EconomyProfile): number {
  const baseline = profile.baselineToxicMinutesPerDay || DEFAULT_BASELINE_MINUTES;
  return Math.max(0.5, Math.min(180, Math.max(1, baseline)) / 60);
}

export function scaledCoinReward(base: number, profile: EconomyProfile): number {
  return Math.max(1, Math.round(base * coinMultiplier(profile)));
}

/** Extra coins for aggressive cutback goals (>=30% or >=50%). */
export function cutbackBountyCoins(profile: EconomyProfile): number {
  const pct = profile.scrollReductionGoalPercent || DEFAULT_REDUCTION_PERCENT;
  if (pct >= 50) return scaledCoinReward(15, profile);
  if (pct >= 30) return scaledCoinReward(8, profile);
  return 0;
}

export function coinRewardForChest(profile?: EconomyProfile): number {
  const { mapChestMin, mapChestMax } = COIN_REWARDS;
  const raw = Math.floor(Math.random() * (mapChestMax - mapChestMin + 1)) + mapChestMin;
  return profile ? scaledCoinReward(raw, profile) : raw;
}

export function coinRewardForStreak(currentStreak: number, profile?: EconomyProfile): number {
  let base = 0;
  if (currentStreak === 30) base = COIN_REWARDS.streak30;
  else if (currentStreak === 14) base = COIN_REWARDS.streak14;
  else if (currentStreak === 7) base = COIN_REWARDS.streak7;
  return base > 0 && profile ? scaledCoinReward(base, profile) : base;
}

// ─── COIN RUN ────────────────────────────────────────

export const COIN_RUN_BASE_PER_250M = 3;
export const VP_RUN_BASE_PER_250M = 2;

// ─── DAILY CAP ───────────────────────────────────────

export function dailyMinutesCap(profile: EconomyProfile): number {
  return dailyFuelBudget(profile);
}

/**
 * Returns true if the user has NOT yet hit the daily minute cap.
 * `todayMinutesEarned` should be the sum of all minutesEarned for today.
 */
export function canEarnMoreMinutes(
  profile: EconomyProfile,
  todayMinutesEarned: number,
): boolean {
  return todayMinutesEarned < dailyMinutesCap(profile);
}
