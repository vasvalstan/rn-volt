import assert from "node:assert/strict";
import {
  ACTIVITY_RULES,
  DIFFICULTY_EFFORT_MULT,
  computeActivityReward,
  dailyFuelBudget,
} from "./gamification.ts";

const balanced = {
  baselineToxicMinutesPerDay: 120,
  scrollReductionGoalPercent: 50,
  difficulty: "balanced",
};

assert.equal(Object.keys(ACTIVITY_RULES).length, 27, "26 activities plus Coin Run must be configured");
assert.equal(dailyFuelBudget(balanced), 60, "cut-in-half target should create a 60 minute budget");
assert.equal(DIFFICULTY_EFFORT_MULT.chill, 0.7);
assert.equal(DIFFICULTY_EFFORT_MULT.beast, 1.3);
assert.equal(
  dailyFuelBudget({
    baselineToxicMinutesPerDay: 1_000_000,
    scrollReductionGoalPercent: -500,
    difficulty: "beast",
  }),
  180,
  "untrusted profile values must be bounded before reward calculation",
);

const balancedPushups = computeActivityReward(balanced, "pushups");
const beastPushups = computeActivityReward({ ...balanced, difficulty: "beast" }, "pushups");
assert.equal(beastPushups.minutes, balancedPushups.minutes, "difficulty changes effort and VP, not fuel inflation");
assert.equal(beastPushups.vp, Math.round(balancedPushups.vp * 1.5));

const shortWalk = computeActivityReward(balanced, "run", { distance: 500 });
const longWalk = computeActivityReward(balanced, "run", { distance: 1500 });
assert.ok(longWalk.minutes > shortWalk.minutes, "GPS reward must follow verified distance");

assert.deepEqual(
  computeActivityReward(balanced, "coin_run", { distance: 100 }),
  { minutes: 0, vp: 0, coins: 0 },
  "Coin Run should pay nothing before the first checkpoint",
);
assert.deepEqual(
  computeActivityReward(
    {
      baselineToxicMinutesPerDay: 1_000_000,
      scrollReductionGoalPercent: 20,
      difficulty: "beast",
    },
    "coin_run",
    { distance: 5_000 },
  ),
  { minutes: 0, vp: 60, coins: 180 },
  "coin rewards must not scale without limit from a client-editable baseline",
);
assert.deepEqual(
  computeActivityReward(balanced, "coin_run", { distance: 500 }),
  { minutes: 0, vp: 4, coins: 12 },
  "Coin Run should use server checkpoint rewards",
);

for (const activityKey of Object.keys(ACTIVITY_RULES)) {
  const reward = computeActivityReward(balanced, activityKey, { distance: 1000 });
  assert.ok(reward.minutes >= 0 && reward.vp >= 0 && reward.coins >= 0, `${activityKey} reward must be non-negative`);
  assert.ok(reward.minutes <= dailyFuelBudget(balanced), `${activityKey} cannot exceed the daily fuel budget`);
}

console.log("gamification checks passed");
