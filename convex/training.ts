import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

type MapNodeDef = {
  label: string;
  activityKeys: string[];
  dp: number;
  nodeType: string;
  desc: string;
};

const EXPECTED_ACTIVITIES_PER_DAY = 4;
const VP_PER_MINUTE_RATIO = 2.0;
const DEFAULT_BASELINE = 60;
const DEFAULT_REDUCTION = 20;

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
): number {
  const b = baseline ?? DEFAULT_BASELINE;
  const r = reduction ?? DEFAULT_REDUCTION;
  const budget = Math.round(b * (1 - r / 100));
  const baseMins = Math.max(1, Math.round(budget / EXPECTED_ACTIVITIES_PER_DAY));
  const baseVp = Math.round(baseMins * VP_PER_MINUTE_RATIO);
  const mult = NODE_TYPE_VP_MULT[nodeType] ?? 1;
  return Math.max(1, Math.round(baseVp * mult));
}

const PERSONA_MAPS: Record<string, MapNodeDef[]> = {
  /** Get Moving + beginner: walking-first, short movement blocks */
  fitness_beginner: [
    { label: "Easy Walk", activityKeys: ["run"], dp: 30, nodeType: "regular", desc: "Walk 300m to warm up" },
    { label: "First Push", activityKeys: ["pushups"], dp: 20, nodeType: "regular", desc: "5 push-ups" },
    { label: "Stretch Break", activityKeys: ["stretch"], dp: 15, nodeType: "rest", desc: "15 sec full body stretch" },
    { label: "Short Shuffle", activityKeys: ["run"], dp: 28, nodeType: "regular", desc: "Easy jog or brisk walk 200m" },
    { label: "Runner's Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Hydrate & Breathe", activityKeys: ["water", "breathe"], dp: 25, nodeType: "regular", desc: "Drink water + 2 min breathwork" },
    { label: "Neighborhood Walk", activityKeys: ["run"], dp: 45, nodeType: "regular", desc: "Walk 400m" },
    { label: "Squat Set", activityKeys: ["squats"], dp: 25, nodeType: "regular", desc: "10 squats" },
    { label: "Cool-down Lap", activityKeys: ["run", "stretch"], dp: 40, nodeType: "regular", desc: "Walk 300m + stretch" },
    { label: "Boss: Foundation", activityKeys: ["run", "pushups", "squats"], dp: 200, nodeType: "boss", desc: "Walk 400m + 5 push-ups + 10 squats" },
  ],
  /** Get Moving + decent: more running volume & combos */
  fitness_decent: [
    { label: "Warm-up Jog", activityKeys: ["run"], dp: 35, nodeType: "regular", desc: "Easy 500m jog or walk-run" },
    { label: "Strength Base", activityKeys: ["pushups"], dp: 22, nodeType: "regular", desc: "10 push-ups" },
    { label: "Tempo Legs", activityKeys: ["squats"], dp: 32, nodeType: "regular", desc: "15 squats" },
    { label: "Steady K", activityKeys: ["run"], dp: 55, nodeType: "regular", desc: "Run or run/walk 1 km" },
    { label: "Runner's Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Power Cardio", activityKeys: ["jumpingjacks", "plank"], dp: 45, nodeType: "regular", desc: "20 jumping jacks + 20s plank" },
    { label: "Distance Builder", activityKeys: ["run"], dp: 70, nodeType: "regular", desc: "Cover 1.5 km your pace" },
    { label: "Wall & Recover", activityKeys: ["wallsit", "water"], dp: 30, nodeType: "regular", desc: "Wall sit 20s + hydrate" },
    { label: "Interval Mix", activityKeys: ["run", "breathe"], dp: 50, nodeType: "regular", desc: "800m + 3 min breathwork" },
    { label: "Boss: Runner's Test", activityKeys: ["run", "pushups", "squats"], dp: 220, nodeType: "boss", desc: "1 km + 10 push-ups + 15 squats" },
  ],
  focus: [
    { label: "Screen Reset", activityKeys: ["eyesclosed"], dp: 15, nodeType: "regular", desc: "Close eyes for 10 sec" },
    { label: "Focus Breath", activityKeys: ["breathe"], dp: 20, nodeType: "regular", desc: "3 min breathwork" },
    { label: "Quick Push", activityKeys: ["pushups"], dp: 20, nodeType: "rest", desc: "5 push-ups to reset" },
    { label: "Attention Test", activityKeys: ["focusdot"], dp: 15, nodeType: "regular", desc: "Focus dot challenge" },
    { label: "Shield Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Break & Breathe", activityKeys: ["leaveroom", "breathe"], dp: 30, nodeType: "regular", desc: "Leave the room + breathwork" },
    { label: "Mindful Move", activityKeys: ["stretch", "eyesclosed"], dp: 25, nodeType: "regular", desc: "Stretch + eyes closed" },
    { label: "Gratitude Pause", activityKeys: ["gratitude"], dp: 15, nodeType: "regular", desc: "Write 3 things you're grateful for" },
    { label: "Deep Focus", activityKeys: ["focusdot", "breathe"], dp: 30, nodeType: "regular", desc: "Focus dot + 3 min breathwork" },
    { label: "Boss: Digital Detox", activityKeys: ["eyesclosed", "leaveroom", "breathe"], dp: 200, nodeType: "boss", desc: "Eyes closed + leave room + breathe" },
  ],
  discipline: [
    { label: "First Rep", activityKeys: ["pushups"], dp: 20, nodeType: "regular", desc: "10 push-ups" },
    { label: "Make the Plan", activityKeys: ["planday"], dp: 15, nodeType: "regular", desc: "Write your #1 task" },
    { label: "Hydrate", activityKeys: ["water"], dp: 10, nodeType: "rest", desc: "Drink a glass of water" },
    { label: "Squat Set", activityKeys: ["squats"], dp: 30, nodeType: "regular", desc: "15 squats" },
    { label: "Discipline Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Full Stack", activityKeys: ["pushups", "squats"], dp: 50, nodeType: "regular", desc: "10 push-ups + 15 squats" },
    { label: "Walk & Plan", activityKeys: ["run", "planday"], dp: 40, nodeType: "regular", desc: "Walk 300m + plan your day" },
    { label: "Hold the Line", activityKeys: ["plank", "wallsit"], dp: 50, nodeType: "regular", desc: "Plank 20s + wall sit 20s" },
    { label: "Kind & Strong", activityKeys: ["kindact", "jumpingjacks"], dp: 35, nodeType: "regular", desc: "Do a kind act + 20 jumping jacks" },
    { label: "Boss: Iron Routine", activityKeys: ["pushups", "squats", "plank", "water"], dp: 200, nodeType: "boss", desc: "Push-ups + squats + plank + hydrate" },
  ],
  calm: [
    { label: "First Breath", activityKeys: ["breathe"], dp: 20, nodeType: "regular", desc: "3 min breathwork" },
    { label: "Grateful Heart", activityKeys: ["gratitude"], dp: 15, nodeType: "regular", desc: "Write 3 things you're grateful for" },
    { label: "Gentle Stretch", activityKeys: ["stretch"], dp: 15, nodeType: "rest", desc: "15 sec stretch" },
    { label: "Screen Pause", activityKeys: ["eyesclosed", "leaveroom"], dp: 20, nodeType: "regular", desc: "Eyes closed + leave the room" },
    { label: "Calm Chest", activityKeys: [], dp: 100, nodeType: "chest", desc: "Open for a surprise" },
    { label: "Kindness Walk", activityKeys: ["kindact", "run"], dp: 40, nodeType: "regular", desc: "Do a kind act + walk 300m" },
    { label: "Focus Flow", activityKeys: ["focusdot", "breathe"], dp: 25, nodeType: "regular", desc: "Focus dot + breathwork" },
    { label: "Body Calm", activityKeys: ["stretch", "water"], dp: 20, nodeType: "regular", desc: "Stretch + drink water" },
    { label: "Deep Gratitude", activityKeys: ["gratitude", "breathe"], dp: 30, nodeType: "regular", desc: "Gratitude + breathwork" },
    { label: "Boss: Inner Peace", activityKeys: ["breathe", "gratitude", "stretch", "eyesclosed"], dp: 200, nodeType: "boss", desc: "Breathwork + gratitude + stretch + eyes closed" },
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

    const alreadyPopulated = existing.some((n) => n.label);
    if (alreadyPopulated) return;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const key = trainingMapKey(args.persona, args.movementLevel);
    const nodes = PERSONA_MAPS[key] ?? PERSONA_MAPS.discipline;

    for (let i = 0; i < nodes.length; i++) {
      const nodeId = i + 1;
      const def = nodes[i];
      const dp = computeNodeDpFromProfile(
        profile?.baselineToxicMinutesPerDay,
        profile?.scrollReductionGoalPercent,
        def.nodeType,
      );
      const existingNode = existing.find((n) => n.nodeId === nodeId);

      if (existingNode) {
        await ctx.db.patch(existingNode._id, {
          label: def.label,
          activityKeys: def.activityKeys,
          dp,
          nodeType: def.nodeType,
          desc: def.desc,
          section: "foundation",
        });
      } else {
        await ctx.db.insert("mapProgress", {
          userId,
          nodeId,
          status: nodeId === 1 ? "completed" : nodeId === 2 ? "current" : "locked",
          label: def.label,
          activityKeys: def.activityKeys,
          dp,
          nodeType: def.nodeType,
          desc: def.desc,
          section: "foundation",
        });
      }
    }
  },
});

const COIN_CHEST_MIN = 10;
const COIN_CHEST_MAX = 50;
const COIN_BOSS = 25;

function coinMultiplierFromBaseline(baseline: number | undefined): number {
  return Math.max(0.5, (baseline ?? 60) / 60);
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
