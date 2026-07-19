import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { auth } from "./auth";
import {
  VOICE_RESERVATION_TTL_MS,
  voiceAllowanceMs,
  voiceSessionAuthorizationMs,
  type VoicePlan,
} from "../shared/voiceQuota";

const usageValidator = v.object({
  totalTokens: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  inputTextTokens: v.number(),
  inputAudioTokens: v.number(),
  inputImageTokens: v.number(),
  cachedTokens: v.number(),
  cachedTextTokens: v.number(),
  cachedAudioTokens: v.number(),
  cachedImageTokens: v.number(),
  outputTextTokens: v.number(),
  outputAudioTokens: v.number(),
});

type Usage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  inputImageTokens: number;
  cachedTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  cachedImageTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
};

const MAX_REPORTED_TOKENS = 20_000_000;

function boundedTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_REPORTED_TOKENS, Math.max(0, Math.round(value)));
}

function boundedUsage(usage: Usage): Usage {
  return {
    totalTokens: boundedTokenCount(usage.totalTokens),
    inputTokens: boundedTokenCount(usage.inputTokens),
    outputTokens: boundedTokenCount(usage.outputTokens),
    inputTextTokens: boundedTokenCount(usage.inputTextTokens),
    inputAudioTokens: boundedTokenCount(usage.inputAudioTokens),
    inputImageTokens: boundedTokenCount(usage.inputImageTokens),
    cachedTokens: boundedTokenCount(usage.cachedTokens),
    cachedTextTokens: boundedTokenCount(usage.cachedTextTokens),
    cachedAudioTokens: boundedTokenCount(usage.cachedAudioTokens),
    cachedImageTokens: boundedTokenCount(usage.cachedImageTokens),
    outputTextTokens: boundedTokenCount(usage.outputTextTokens),
    outputAudioTokens: boundedTokenCount(usage.outputAudioTokens),
  };
}

function estimateRealtimeCostUsd(usage: Usage): number {
  const uncachedText = Math.max(0, usage.inputTextTokens - usage.cachedTextTokens);
  const uncachedAudio = Math.max(0, usage.inputAudioTokens - usage.cachedAudioTokens);
  const uncachedImage = Math.max(0, usage.inputImageTokens - usage.cachedImageTokens);
  const cached =
    usage.cachedTextTokens + usage.cachedAudioTokens + usage.cachedImageTokens;

  return (
    uncachedText * 4e-6 +
    uncachedAudio * 32e-6 +
    uncachedImage * 5e-6 +
    cached * 0.4e-6 +
    usage.outputTextTokens * 24e-6 +
    usage.outputAudioTokens * 64e-6
  );
}

async function insertUsageEvent(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    sessionId: Id<"voiceRealtimeSessions">;
    responseId: string;
    source: "server" | "client";
    usage: Usage;
  },
) {
  const eventKey = `response:${args.responseId}`;
  const existing = await ctx.db
    .query("voiceRealtimeUsageEvents")
    .withIndex("by_session_eventKey", (q) =>
      q.eq("sessionId", args.sessionId).eq("eventKey", eventKey),
    )
    .unique();
  const usage = boundedUsage(args.usage);

  if (existing) {
    if (args.source === "server" && existing.source !== "server") {
      await ctx.db.patch(existing._id, {
        ...usage,
        source: "server",
        recordedAt: Date.now(),
        estimatedCostUsd: estimateRealtimeCostUsd(usage),
      });
    }
    return existing._id;
  }

  return await ctx.db.insert("voiceRealtimeUsageEvents", {
    userId: args.userId,
    sessionId: args.sessionId,
    responseId: args.responseId,
    eventKey,
    source: args.source,
    recordedAt: Date.now(),
    ...usage,
    estimatedCostUsd: estimateRealtimeCostUsd(usage),
  });
}

async function finalizeSession(
  ctx: MutationCtx,
  session: Doc<"voiceRealtimeSessions">,
  endedAt: number,
  endReason: string,
) {
  if (session.status === "ended" || session.status === "cancelled") {
    return session.billedDurationMs ?? 0;
  }

  const effectiveEnd = Math.min(
    Math.max(endedAt, session.startedAt ?? session.reservedAt),
    session.expiresAt ?? endedAt,
  );
  const billedDurationMs = session.startedAt
    ? Math.min(
        session.authorizedDurationMs,
        Math.max(0, effectiveEnd - session.startedAt),
      )
    : 0;

  await ctx.db.patch(session._id, {
    status: session.startedAt ? "ended" : "cancelled",
    endedAt: effectiveEnd,
    billedDurationMs,
    endReason,
  });

  if (billedDurationMs > 0) {
    const window = await ctx.db.get(session.quotaWindowId);
    if (window) {
      await ctx.db.patch(window._id, {
        usedMs: Math.min(
          window.allowanceMs,
          window.usedMs + billedDurationMs,
        ),
        updatedAt: Date.now(),
      });
    }
  }

  return billedDurationMs;
}

export const getAuthProfile = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return profile ? { profileId: profile._id } : null;
  },
});

export const getSessionControl = internalQuery({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const getOpenSessionsForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("voiceRealtimeSessions")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "active"),
      )
      .collect();
    const reserved = await ctx.db
      .query("voiceRealtimeSessions")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "reserved"),
      )
      .collect();
    return [...active, ...reserved];
  },
});

export const reserveSession = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.union(v.literal("weekly"), v.literal("monthly")),
    periodKey: v.string(),
    periodStartAt: v.number(),
    periodEndAt: v.number(),
    activityType: v.string(),
    activityName: v.string(),
    mode: v.union(v.literal("reflective"), v.literal("movement")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeSessions = await ctx.db
      .query("voiceRealtimeSessions")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "active"),
      )
      .collect();
    for (const session of activeSessions) {
      if ((session.expiresAt ?? 0) <= now) {
        await finalizeSession(ctx, session, now, "expired_before_next_session");
      } else {
        throw new Error("A live voice session is already active.");
      }
    }

    const reservations = await ctx.db
      .query("voiceRealtimeSessions")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "reserved"),
      )
      .collect();
    for (const reservation of reservations) {
      if (reservation.reservedAt + VOICE_RESERVATION_TTL_MS <= now) {
        await finalizeSession(ctx, reservation, now, "reservation_expired");
      } else {
        throw new Error("A voice session is still connecting.");
      }
    }

    const allowanceMs = voiceAllowanceMs(args.plan as VoicePlan);
    let window = await ctx.db
      .query("voiceQuotaWindows")
      .withIndex("by_userId_periodKey", (q) =>
        q.eq("userId", args.userId).eq("periodKey", args.periodKey),
      )
      .unique();

    if (!window) {
      const quotaWindowId = await ctx.db.insert("voiceQuotaWindows", {
        userId: args.userId,
        plan: args.plan,
        periodKey: args.periodKey,
        periodStartAt: args.periodStartAt,
        periodEndAt: args.periodEndAt,
        allowanceMs,
        usedMs: 0,
        createdAt: now,
        updatedAt: now,
      });
      window = await ctx.db.get(quotaWindowId);
    }
    if (!window) throw new Error("Could not create the voice quota window.");

    const remainingMs = Math.max(0, window.allowanceMs - window.usedMs);
    if (remainingMs <= 0) {
      const label = args.plan === "weekly" ? "35 weekly" : "90 monthly";
      throw new Error(`You have used all ${label} voice minutes for this period.`);
    }

    const authorizedDurationMs = voiceSessionAuthorizationMs(remainingMs);
    const sessionId = await ctx.db.insert("voiceRealtimeSessions", {
      userId: args.userId,
      quotaWindowId: window._id,
      activityType: args.activityType,
      activityName: args.activityName,
      mode: args.mode,
      status: "reserved",
      authorizedDurationMs,
      reservedAt: now,
    });

    return {
      sessionId,
      authorizedDurationMs,
      remainingBeforeMs: remainingMs,
    };
  },
});

export const activateSession = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    providerCallId: v.string(),
    model: v.string(),
    voice: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "reserved") {
      throw new Error("Voice session reservation is no longer active.");
    }
    const startedAt = Date.now();
    const expiresAt = startedAt + session.authorizedDurationMs;
    await ctx.db.patch(session._id, {
      status: "active",
      providerCallId: args.providerCallId,
      model: args.model,
      voice: args.voice,
      startedAt,
      expiresAt,
    });
    return {
      startedAt,
      expiresAt,
      authorizedDurationMs: session.authorizedDurationMs,
    };
  },
});

export const cancelSession = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    await finalizeSession(ctx, session, Date.now(), args.reason);
  },
});

export const finalizeSessionByServer = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    reason: v.string(),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const billedDurationMs = await finalizeSession(
      ctx,
      session,
      args.endedAt ?? Date.now(),
      args.reason,
    );
    const window = await ctx.db.get(session.quotaWindowId);
    return {
      billedDurationMs,
      remainingMs: window
        ? Math.max(0, window.allowanceMs - window.usedMs)
        : 0,
    };
  },
});

export const markMonitorStarted = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "active") return;
    await ctx.db.patch(session._id, {
      monitorStartedAt: Date.now(),
      monitorError: undefined,
    });
  },
});

export const markMonitorError = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    await ctx.db.patch(session._id, {
      monitorError: args.message.slice(0, 1_000),
    });
  },
});

export const recordServerUsage = internalMutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    responseId: v.string(),
    usage: usageValidator,
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    return await insertUsageEvent(ctx, {
      userId: session.userId,
      sessionId: session._id,
      responseId: args.responseId,
      source: "server",
      usage: args.usage,
    });
  },
});

export const recordClientUsage = mutation({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    responseId: v.string(),
    usage: usageValidator,
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Voice session not found.");
    }
    if (!args.responseId.trim() || args.responseId.length > 120) {
      throw new Error("Invalid Realtime response ID.");
    }
    return await insertUsageEvent(ctx, {
      userId,
      sessionId: session._id,
      responseId: args.responseId,
      source: "client",
      usage: args.usage,
    });
  },
});

export const getQuotaStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const now = Date.now();
    const windows = await ctx.db
      .query("voiceQuotaWindows")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10);
    const window = windows.find(
      (candidate) =>
        candidate.periodStartAt <= now && candidate.periodEndAt > now,
    );
    if (!window) return null;

    const active = await ctx.db
      .query("voiceRealtimeSessions")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .first();
    const activeElapsedMs =
      active?.startedAt && active.quotaWindowId === window._id
        ? Math.min(
            active.authorizedDurationMs,
            Math.max(0, now - active.startedAt),
          )
        : 0;
    return {
      plan: window.plan,
      allowanceMs: window.allowanceMs,
      usedMs: Math.min(window.allowanceMs, window.usedMs + activeElapsedMs),
      remainingMs: Math.max(
        0,
        window.allowanceMs - window.usedMs - activeElapsedMs,
      ),
      periodStartAt: window.periodStartAt,
      periodEndAt: window.periodEndAt,
    };
  },
});
