import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

const turnValidator = v.object({
  role: v.union(v.literal("assistant"), v.literal("user")),
  text: v.string(),
  at: v.number(),
});

const triggerValidator = v.object({
  type: v.string(),
  minutesSpent: v.optional(v.number()),
  reason: v.optional(v.string()),
});

function assertOptionalText(label: string, value: string | undefined, max: number): void {
  if (value !== undefined && value.length > max) {
    throw new Error(`${label} is too long`);
  }
}

export const saveCoachedSession = mutation({
  args: {
    activityType: v.string(),
    activityName: v.string(),
    mode: v.string(),
    status: v.string(),
    turns: v.array(turnValidator),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    note: v.optional(v.string()),
    trigger: v.optional(triggerValidator),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (args.turns.length > 50) {
      throw new Error("A maximum of 50 conversation turns can be saved");
    }
    assertOptionalText("Activity type", args.activityType, 80);
    assertOptionalText("Activity name", args.activityName, 120);
    assertOptionalText("Mode", args.mode, 40);
    assertOptionalText("Status", args.status, 40);
    assertOptionalText("Transcript", args.transcript, 20_000);
    assertOptionalText("Summary", args.summary, 4_000);
    assertOptionalText("Note", args.note, 4_000);
    assertOptionalText("Trigger type", args.trigger?.type, 80);
    assertOptionalText("Trigger reason", args.trigger?.reason, 500);
    for (const turn of args.turns) {
      assertOptionalText("Conversation turn", turn.text, 4_000);
    }

    return await ctx.db.insert("activitySessions", {
      userId,
      ...args,
    });
  },
});

export const getRecentCoachedSessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Limit must be an integer between 1 and 50");
    }

    return await ctx.db
      .query("activitySessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});
