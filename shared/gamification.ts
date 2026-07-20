export type DifficultyKey = "chill" | "balanced" | "beast";
export type ActivityCategory = "physical" | "mindful" | "micro" | "anti-scroll";

export type EconomyProfile = {
  baselineToxicMinutesPerDay: number;
  scrollReductionGoalPercent: number;
  difficulty: DifficultyKey;
};

type ActivityRule = {
  category: ActivityCategory;
  effortSec: number;
  verification: string;
  dailyLimit?: number;
};

export const ACTIVITY_RULES: Record<string, ActivityRule> = {
  run: { category: "physical", effortSec: 0, verification: "gps", dailyLimit: 2 },
  pushups: { category: "physical", effortSec: 0, verification: "camera", dailyLimit: 3 },
  squats: { category: "physical", effortSec: 0, verification: "camera", dailyLimit: 3 },
  jumpingjacks: { category: "physical", effortSec: 0, verification: "camera", dailyLimit: 3 },
  wallsit: { category: "physical", effortSec: 0, verification: "camera", dailyLimit: 3 },
  breathe: { category: "mindful", effortSec: 180, verification: "guided", dailyLimit: 2 },
  gratitude: { category: "mindful", effortSec: 60, verification: "self-report", dailyLimit: 1 },
  focusdot: { category: "mindful", effortSec: 45, verification: "guided", dailyLimit: 3 },
  bodyscan: { category: "mindful", effortSec: 120, verification: "timer", dailyLimit: 2 },
  mindfulwalk: { category: "mindful", effortSec: 180, verification: "self-report", dailyLimit: 2 },
  water: { category: "micro", effortSec: 0, verification: "tap", dailyLimit: 4 },
  kindact: { category: "micro", effortSec: 30, verification: "self-report", dailyLimit: 2 },
  planday: { category: "micro", effortSec: 60, verification: "self-report", dailyLimit: 1 },
  eyesclosed: { category: "anti-scroll", effortSec: 30, verification: "timer", dailyLimit: 3 },
  leaveroom: { category: "anti-scroll", effortSec: 30, verification: "timer", dailyLimit: 3 },
  coin_run: { category: "physical", effortSec: 0, verification: "gps", dailyLimit: 1 },
  crunches: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  mountainclimber: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  glutebridge: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  sumosquats: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  lunges: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  sidelunges: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  armcircles: { category: "physical", effortSec: 30, verification: "timer", dailyLimit: 3 },
  bodytwist: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  highkneerun: { category: "physical", effortSec: 60, verification: "timer", dailyLimit: 3 },
  bicyclecrunches: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  scissorkicks: { category: "physical", effortSec: 30, verification: "timer", dailyLimit: 3 },
  onelegsquats: { category: "physical", effortSec: 0, verification: "self-report", dailyLimit: 3 },
  onelegjumping: { category: "physical", effortSec: 30, verification: "timer", dailyLimit: 3 },
  forearmplank: { category: "physical", effortSec: 60, verification: "timer", dailyLimit: 3 },
  sideplank: { category: "physical", effortSec: 60, verification: "timer", dailyLimit: 3 },
  legstretch: { category: "physical", effortSec: 600, verification: "timer", dailyLimit: 3 },
  sidestretch: { category: "physical", effortSec: 60, verification: "timer", dailyLimit: 3 },
  forwardfold: { category: "physical", effortSec: 60, verification: "timer", dailyLimit: 3 },
  smile: { category: "mindful", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  visualizegoals: { category: "mindful", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  positiveaffirmations: { category: "mindful", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  grounding: { category: "mindful", effortSec: 600, verification: "timer", dailyLimit: 3 },
  boxbreathing: { category: "mindful", effortSec: 300, verification: "guided", dailyLimit: 3 },
  windowobserve: { category: "mindful", effortSec: 300, verification: "timer", dailyLimit: 3 },
  humsinging: { category: "mindful", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  selfhugging: { category: "mindful", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  bodytap: { category: "mindful", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  facemassage: { category: "mindful", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  readapage: { category: "micro", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  declutterdrawer: { category: "micro", effortSec: 600, verification: "self-report", dailyLimit: 3 },
  cleanmirror: { category: "micro", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  lightcandle: { category: "micro", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  eatafruit: { category: "micro", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  sweepfloor: { category: "micro", effortSec: 600, verification: "self-report", dailyLimit: 3 },
  newsong: { category: "micro", effortSec: 600, verification: "self-report", dailyLimit: 3 },
  takephoto: { category: "micro", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  grocerylist: { category: "micro", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  planmenu: { category: "micro", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  eyegymnastics: { category: "anti-scroll", effortSec: 60, verification: "guided", dailyLimit: 3 },
  eyemassage: { category: "anti-scroll", effortSec: 300, verification: "timer", dailyLimit: 3 },
  callafriend: { category: "anti-scroll", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  doodle: { category: "anti-scroll", effortSec: 300, verification: "self-report", dailyLimit: 3 },
  reflectday: { category: "anti-scroll", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  questionday: { category: "anti-scroll", effortSec: 60, verification: "self-report", dailyLimit: 3 },
  findcolor: { category: "anti-scroll", effortSec: 60, verification: "self-report", dailyLimit: 3 },
};

const CATEGORY_WEIGHT: Record<ActivityCategory, number> = {
  physical: 1,
  mindful: 0.75,
  micro: 0.4,
  "anti-scroll": 0.5,
};

export const DIFFICULTY_EFFORT_MULT: Record<DifficultyKey, number> = {
  chill: 0.7,
  balanced: 1,
  beast: 1.3,
};

const DIFFICULTY_VP_MULT: Record<DifficultyKey, number> = {
  chill: 1,
  balanced: 1,
  beast: 1.5,
};

const DEFAULT_BASELINE_MINUTES = 60;
const MIN_BASELINE_MINUTES = 1;
const MAX_REWARD_BASELINE_MINUTES = 180;
const DEFAULT_REDUCTION_PERCENT = 20;
const MAX_REDUCTION_PERCENT = 90;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function boundedEconomy(profile: EconomyProfile): EconomyProfile {
  return {
    baselineToxicMinutesPerDay: Math.min(
      MAX_REWARD_BASELINE_MINUTES,
      Math.max(
        MIN_BASELINE_MINUTES,
        finiteOr(profile.baselineToxicMinutesPerDay, DEFAULT_BASELINE_MINUTES),
      ),
    ),
    scrollReductionGoalPercent: Math.min(
      MAX_REDUCTION_PERCENT,
      Math.max(
        0,
        finiteOr(profile.scrollReductionGoalPercent, DEFAULT_REDUCTION_PERCENT),
      ),
    ),
    difficulty:
      profile.difficulty === "chill" || profile.difficulty === "beast"
        ? profile.difficulty
        : "balanced",
  };
}

export function dailyFuelBudget(profile: EconomyProfile): number {
  const bounded = boundedEconomy(profile);
  const baseline = bounded.baselineToxicMinutesPerDay;
  const reduction = bounded.scrollReductionGoalPercent;
  return Math.max(1, Math.round(baseline * (1 - reduction / 100)));
}

export function computeActivityReward(
  profile: EconomyProfile,
  activityKey: string,
  metrics?: { distance?: number },
): { minutes: number; vp: number; coins: number } {
  const rule = ACTIVITY_RULES[activityKey];
  if (!rule) throw new Error("Unknown activity");
  const bounded = boundedEconomy(profile);

  if (activityKey === "coin_run") {
    const distance = Math.max(0, finiteOr(metrics?.distance ?? 0, 0));
    const checkpoints = Math.min(20, Math.floor(distance / 250));
    const baselineMult = Math.max(0.5, bounded.baselineToxicMinutesPerDay / 60);
    return {
      minutes: 0,
      vp: Math.round(checkpoints * 2 * DIFFICULTY_VP_MULT[bounded.difficulty]),
      coins: Math.round(checkpoints * 3 * baselineMult),
    };
  }

  const base = dailyFuelBudget(bounded) / 3;
  const durationFactor = rule.effortSec <= 60 ? 0.75 : rule.effortSec <= 180 ? 1 : 1.15;
  const distance = Math.max(0, finiteOr(metrics?.distance ?? 1000, 1000));
  const distanceFactor = activityKey === "run"
    ? Math.max(0.5, Math.min(1.5, distance / 1000))
    : 1;
  const minutes = Math.max(1, Math.round(base * CATEGORY_WEIGHT[rule.category] * durationFactor * distanceFactor));
  const vp = Math.max(1, Math.round(minutes * 2 * DIFFICULTY_VP_MULT[bounded.difficulty]));
  return { minutes, vp, coins: 0 };
}
