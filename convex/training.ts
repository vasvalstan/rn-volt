import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { addWeeklyScore } from "./leaderboardUtils";
import { dailyFuelBudget } from "../shared/gamification";

type MapNodeDef = {
  label: string;
  activityKeys: string[];
  dp: number;
  nodeType: string;
  desc: string;
};

const EXPECTED_ACTIVITIES_PER_DAY = 4;
const VP_PER_MINUTE_RATIO = 2.0;
const NODE_TYPE_VP_MULT: Record<string, number> = {
  regular: 1.0,
  rest: 0.5,
  chest: 2.0,
  boss: 4.0,
};

function computeNodeDpFromProfile(
  baseline: number | undefined,
  reduction: number | undefined,
  nodeType: string,
  phaseMult = 1,
): number {
  const budget = dailyFuelBudget({
    baselineToxicMinutesPerDay: baseline ?? 60,
    scrollReductionGoalPercent: reduction ?? 20,
    difficulty: "balanced",
  });
  const baseMins = Math.max(1, Math.round(budget / EXPECTED_ACTIVITIES_PER_DAY));
  const baseVp = Math.round(baseMins * VP_PER_MINUTE_RATIO);
  const mult = NODE_TYPE_VP_MULT[nodeType] ?? 1;
  return Math.max(1, Math.round(baseVp * mult * phaseMult));
}

const PERSONA_MAPS: Record<string, MapNodeDef[]> = {
  /** Get Moving + beginner: walking-first, short movement blocks */
  fitness_beginner: [
    { label: "Easy Walk", activityKeys: ["run"], dp: 30, nodeType: "regular", desc: "Walk 300m to warm up" },
    { label: "First Push", activityKeys: ["pushups"], dp: 20, nodeType: "regular", desc: "5 push-ups" },
    { label: "Core Start", activityKeys: ["crunches"], dp: 15, nodeType: "rest", desc: "10 controlled crunches" },
    { label: "Glute Base", activityKeys: ["glutebridge"], dp: 28, nodeType: "regular", desc: "10 glute bridges" },
    { label: "Runner's Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Power Cardio", activityKeys: ["mountainclimber", "highkneerun"], dp: 25, nodeType: "regular", desc: "Mountain climbers + high knees" },
    { label: "Strength Flow", activityKeys: ["sumosquats", "lunges"], dp: 45, nodeType: "regular", desc: "Sumo squats + lunges" },
    { label: "Balance Hold", activityKeys: ["forearmplank", "sideplank"], dp: 25, nodeType: "regular", desc: "Forearm plank + side plank" },
    { label: "Mobility Finish", activityKeys: ["legstretch", "forwardfold"], dp: 40, nodeType: "regular", desc: "Leg stretch + forward fold" },
    { label: "Boss: Foundation", activityKeys: ["run", "pushups", "squats"], dp: 200, nodeType: "boss", desc: "Walk 400m + 5 push-ups + 10 squats" },
  ],
  /** Get Moving + decent: more running volume & combos */
  fitness_decent: [
    { label: "Warm-up Jog", activityKeys: ["run"], dp: 35, nodeType: "regular", desc: "Easy 500m jog or walk-run" },
    { label: "Strength Base", activityKeys: ["pushups"], dp: 22, nodeType: "regular", desc: "10 push-ups" },
    { label: "Tempo Legs", activityKeys: ["squats"], dp: 32, nodeType: "regular", desc: "15 squats" },
    { label: "Steady K", activityKeys: ["run"], dp: 55, nodeType: "regular", desc: "Run or run/walk 1 km" },
    { label: "Runner's Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Power Cardio", activityKeys: ["jumpingjacks", "mountainclimber"], dp: 45, nodeType: "regular", desc: "Jumping jacks + mountain climbers" },
    { label: "Core Builder", activityKeys: ["bicyclecrunches", "scissorkicks"], dp: 70, nodeType: "regular", desc: "Bicycle crunches + scissors kicks" },
    { label: "Lateral Strength", activityKeys: ["lunges", "sidelunges"], dp: 30, nodeType: "regular", desc: "Lunges + side lunges" },
    { label: "Mobility Flow", activityKeys: ["legstretch", "sidestretch"], dp: 50, nodeType: "regular", desc: "Leg stretch + side stretch" },
    { label: "Boss: Runner's Test", activityKeys: ["run", "pushups", "squats", "forearmplank"], dp: 220, nodeType: "boss", desc: "1 km + push-ups + squats + plank" },
  ],
  focus: [
    { label: "Screen Reset", activityKeys: ["eyesclosed"], dp: 15, nodeType: "regular", desc: "Close eyes for 10 sec" },
    { label: "Box Breathing", activityKeys: ["boxbreathing"], dp: 20, nodeType: "regular", desc: "5 min box breathing" },
    { label: "Eye Reset", activityKeys: ["eyegymnastics"], dp: 20, nodeType: "rest", desc: "Eye gymnastics to reset your attention" },
    { label: "Attention Test", activityKeys: ["focusdot"], dp: 15, nodeType: "regular", desc: "Focus dot challenge" },
    { label: "Shield Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Window Grounding", activityKeys: ["windowobserve", "grounding"], dp: 30, nodeType: "regular", desc: "Observe outside + ground in the present" },
    { label: "Face & Body Reset", activityKeys: ["facemassage", "selfhugging"], dp: 25, nodeType: "regular", desc: "Face massage + self-hug" },
    { label: "Doodle Break", activityKeys: ["doodle"], dp: 15, nodeType: "regular", desc: "Doodle instead of scrolling" },
    { label: "Daily Reflection", activityKeys: ["reflectday", "questionday"], dp: 30, nodeType: "regular", desc: "Reflect on the day + answer a question" },
    { label: "Boss: Digital Detox", activityKeys: ["eyesclosed", "leaveroom", "callafriend"], dp: 200, nodeType: "boss", desc: "Eyes closed + leave room + call a friend" },
  ],
  discipline: [
    { label: "Light a Candle", activityKeys: ["lightcandle"], dp: 20, nodeType: "regular", desc: "Light a candle and pause" },
    { label: "Read a Page", activityKeys: ["readapage"], dp: 15, nodeType: "regular", desc: "Read one page" },
    { label: "Make the Plan", activityKeys: ["planday"], dp: 10, nodeType: "rest", desc: "Write your #1 task" },
    { label: "Eat a Fruit", activityKeys: ["eatafruit"], dp: 30, nodeType: "regular", desc: "Eat one piece of fruit" },
    { label: "Discipline Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Declutter Drawer", activityKeys: ["declutterdrawer"], dp: 50, nodeType: "regular", desc: "Clear one drawer" },
    { label: "Grocery List", activityKeys: ["grocerylist"], dp: 40, nodeType: "regular", desc: "Write your grocery list" },
    { label: "Plan Menu", activityKeys: ["planmenu"], dp: 50, nodeType: "regular", desc: "Plan a simple menu" },
    { label: "Clean & Sweep", activityKeys: ["cleanmirror", "sweepfloor"], dp: 35, nodeType: "regular", desc: "Clean a mirror + sweep the floor" },
    { label: "Boss: Daily Reset", activityKeys: ["planday", "grocerylist", "planmenu", "kindact"], dp: 200, nodeType: "boss", desc: "Plan your day + groceries + menu + kind act" },
  ],
  calm: [
    { label: "First Breath", activityKeys: ["breathe"], dp: 20, nodeType: "regular", desc: "3 min breathwork" },
    { label: "Grateful Heart", activityKeys: ["gratitude"], dp: 15, nodeType: "regular", desc: "Write 3 things you're grateful for" },
    { label: "Box Breathing", activityKeys: ["boxbreathing"], dp: 15, nodeType: "rest", desc: "5 min box breathing" },
    { label: "Screen Pause", activityKeys: ["eyesclosed", "leaveroom"], dp: 20, nodeType: "regular", desc: "Eyes closed + leave the room" },
    { label: "Calm Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Grounding Walk", activityKeys: ["grounding", "mindfulwalk"], dp: 40, nodeType: "regular", desc: "Grounding + mindful walk" },
    { label: "Smile & Self-Hug", activityKeys: ["smile", "selfhugging"], dp: 25, nodeType: "regular", desc: "Smile + self-hug" },
    { label: "Goals & Affirmations", activityKeys: ["visualizegoals", "positiveaffirmations"], dp: 20, nodeType: "regular", desc: "Visualize goals + affirmations" },
    { label: "Hum & Tap", activityKeys: ["humsinging", "bodytap"], dp: 30, nodeType: "regular", desc: "Hum + body tap" },
    { label: "Boss: Inner Peace", activityKeys: ["breathe", "gratitude", "grounding", "boxbreathing"], dp: 200, nodeType: "boss", desc: "Breathwork + gratitude + grounding + box breathing" },
  ],
};

export const getMapProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("mapProgress")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

function trainingMapKey(persona: string, movementLevel?: string): string {
  if (persona === "fitness") {
    return movementLevel === "decent" ? "fitness_decent" : "fitness_beginner";
  }
  return persona;
}

export const generateTrainingMap = mutation({
  args: {
    persona: v.string(),
    movementLevel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("mapProgress")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const key = trainingMapKey(args.persona, args.movementLevel);
    const nodes = PERSONA_MAPS[key] ?? PERSONA_MAPS.discipline;

    const phases = ["Foundation", "Building", "Mastery"] as const;
    for (let i = 0; i < nodes.length * phases.length; i++) {
      const nodeId = i + 1;
      const phase = Math.floor(i / nodes.length);
      const def = nodes[i % nodes.length];
      const dp = computeNodeDpFromProfile(
        profile?.baselineToxicMinutesPerDay,
        profile?.scrollReductionGoalPercent,
        def.nodeType,
        [1, 1.3, 1.6][phase],
      );
      const existingNode = existing.find((n) => n.nodeId === nodeId);
      const phaseLabel = phase === 0 ? def.label : `${phases[phase]}: ${def.label}`;
      const phaseDesc = phase === 0 ? def.desc : `${phases[phase]} challenge: ${def.desc}`;

      if (existingNode) {
        await ctx.db.patch(existingNode._id, {
          label: phaseLabel,
          activityKeys: def.activityKeys,
          completedActivityKeys: existingNode.completedActivityKeys ?? [],
          dp,
          nodeType: def.nodeType,
          desc: phaseDesc,
          section: phases[phase].toLowerCase(),
        });
      } else {
        await ctx.db.insert("mapProgress", {
          userId,
          nodeId,
          status: nodeId === 1 ? "completed" : nodeId === 2 ? "current" : "locked",
          label: phaseLabel,
          activityKeys: def.activityKeys,
          completedActivityKeys: [],
          dp,
          nodeType: def.nodeType,
          desc: phaseDesc,
          section: phases[phase].toLowerCase(),
        });
      }
    }
  },
});

const COIN_CHEST_MIN = 10;
const COIN_CHEST_MAX = 50;
const COIN_BOSS = 25;

function coinMultiplierFromBaseline(baseline: number | undefined): number {
  const bounded = Math.min(180, Math.max(1, baseline ?? 60));
  return Math.max(0.5, bounded / 60);
}

function scaledCoin(base: number, baseline: number | undefined): number {
  return Math.max(1, Math.round(base * coinMultiplierFromBaseline(baseline)));
}

export const completeNode = mutation({
  args: { nodeId: v.number() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const node = await ctx.db
      .query("mapProgress")
      .withIndex("by_userId_nodeId", (q) =>
        q.eq("userId", userId).eq("nodeId", args.nodeId)
      )
      .unique();

    if (!node) throw new Error("Node not found");
    if (node.status !== "current") throw new Error("Node is not current");
    if ((node.activityKeys?.length ?? 0) > 0) {
      throw new Error("Complete the required activities to finish this node");
    }

    await ctx.db.patch(node._id, {
      status: "completed",
      completedAt: Date.now(),
    });

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (profile) {
      let coinBonus = 0;
      if (node.nodeType === "chest") {
        const raw = Math.floor(Math.random() * (COIN_CHEST_MAX - COIN_CHEST_MIN + 1)) + COIN_CHEST_MIN;
        coinBonus = scaledCoin(raw, profile.baselineToxicMinutesPerDay);
      } else if (node.nodeType === "boss") {
        coinBonus = scaledCoin(COIN_BOSS, profile.baselineToxicMinutesPerDay);
      }

      const updates: Record<string, unknown> = {};
      if (node.dp) updates.totalDp = profile.totalDp + node.dp;
      if (coinBonus > 0)
        updates.coinBalance = (profile.coinBalance ?? 0) + coinBonus;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(profile._id, updates);
      }
      if (node.dp) {
        await addWeeklyScore(ctx, userId, node.dp, profile.league ?? "bronze");
      }
    }

    const nextNode = await ctx.db
      .query("mapProgress")
      .withIndex("by_userId_nodeId", (q) =>
        q.eq("userId", userId).eq("nodeId", args.nodeId + 1)
      )
      .unique();

    if (nextNode) {
      await ctx.db.patch(nextNode._id, { status: "current" });
    }
  },
});
