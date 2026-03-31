/**
 * Tailored GPS unlock sessions from onboarding: persona, fitness goal, movement level.
 * Milestones are now dynamically built via economyEngine.buildPersonalizedMilestones.
 */

import { buildPersonalizedMilestones, type EconomyProfile, type GpsMilestoneComputed } from "./economyEngine";

export type MovementLevelKey = "beginner" | "decent";

export type GpsMode = "walk" | "run";

export interface GpsMilestone {
  distanceM: number;
  dp: number;
  minutes: number;
  label: string;
}

export interface GpsSessionUI {
  mode: GpsMode;
  name: string;
  formula: string;
  milestones: GpsMilestone[];
  /** Optional session target (e.g. first 5K). */
  targetDistanceM: number | null;
  startCta: string;
  summaryTitle: string;
  summarySubtitle: string;
}

function parseTargetKm(goal: string): number | null {
  if (/5\s*k|5k|5K/i.test(goal)) return 5000;
  if (/3\s*k|3k|3K/i.test(goal)) return 3000;
  return null;
}

function isWalkHeavyGoal(goal: string): boolean {
  return /walk|steps|10k steps|step/i.test(goal);
}

/**
 * Build UI + milestone table for the GPS activity card and GPSWalkSession.
 * Milestones are personalized from the user's economy profile.
 */
export function buildGpsSessionUI(params: {
  persona: string;
  goal: string | undefined;
  movementLevel: string | undefined;
  economyProfile?: EconomyProfile;
}): GpsSessionUI {
  const goal = params.goal ?? "";
  const level: MovementLevelKey =
    params.movementLevel === "decent" ? "decent" : "beginner";

  const fitness = params.persona === "fitness";
  const walkHeavy = isWalkHeavyGoal(goal);
  const mode: GpsMode = fitness && !walkHeavy ? "run" : "walk";

  const targetDistanceM = mode === "run" ? parseTargetKm(goal) : null;

  const ep: EconomyProfile = params.economyProfile ?? {
    baselineToxicMinutesPerDay: 60,
    scrollReductionGoalPercent: 20,
    difficulty: "balanced",
  };

  if (mode === "walk") {
    const name = level === "decent" ? "Power walk" : "Neighborhood walk";
    const milestones = buildPersonalizedMilestones(ep, "walk");
    const km = milestones.find((m) => m.distanceM === 1000);
    const formulaHint = km
      ? `1km ≈ ${km.minutes} min fuel + ${km.dp} VP`
      : "Walk to earn fuel + VP";
    return {
      mode: "walk",
      name,
      formula: `Earn every 250m+ · ${formulaHint}`,
      milestones,
      targetDistanceM: null,
      startCta: "START WALK",
      summaryTitle: "WALK COMPLETE!",
      summarySubtitle: "Nice miles — claim your fuel.",
    };
  }

  if (level === "decent") {
    const milestones = buildPersonalizedMilestones(ep, "run_decent");
    const hasTarget = targetDistanceM !== null;
    return {
      mode: "run",
      name: "GPS Run",
      formula: hasTarget
        ? `Target ~${(targetDistanceM as number) / 1000}km · km coins + unlock time`
        : "Km checkpoints · stronger rewards per km",
      milestones,
      targetDistanceM,
      startCta: "START RUN",
      summaryTitle: hasTarget && targetDistanceM ? "GOAL RUN COMPLETE!" : "RUN COMPLETE!",
      summarySubtitle: hasTarget
        ? "You hit your distance target."
        : "Strong session — claim your rewards.",
    };
  }

  const milestones = buildPersonalizedMilestones(ep, "run_beginner");
  const hasTarget = targetDistanceM !== null;
  return {
    mode: "run",
    name: "GPS Run (starter)",
    formula: hasTarget
      ? `Build to ${(targetDistanceM as number) / 1000}km · celebrate each 500m–1km`
      : "500m & 1km coins · stack unlock time as you go",
    milestones,
    targetDistanceM,
    startCta: "START RUN",
    summaryTitle: hasTarget ? "YOU DID IT!" : "RUN COMPLETE!",
    summarySubtitle: hasTarget
      ? "Beginning runner win — fuel is yours."
      : "Every step counts. Claim below.",
  };
}

export function getReachedMilestones(distanceM: number, milestones: GpsMilestone[]): GpsMilestone[] {
  return milestones.filter((m) => distanceM >= m.distanceM);
}

export function getNextMilestone(distanceM: number, milestones: GpsMilestone[]): GpsMilestone | null {
  return milestones.find((m) => distanceM < m.distanceM) ?? null;
}

export function getCurrentRewards(
  distanceM: number,
  milestones: GpsMilestone[],
): { dp: number; minutes: number } {
  const reached = getReachedMilestones(distanceM, milestones);
  if (reached.length === 0) return { dp: 0, minutes: 0 };
  const last = reached.at(-1);
  if (!last) return { dp: 0, minutes: 0 };
  return { dp: last.dp, minutes: last.minutes };
}
