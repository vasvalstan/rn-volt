"use node";

import WebSocket, { type RawData } from "ws";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { auth } from "./auth";
import {
  voiceQuotaPeriod,
  VOICE_IDLE_TIMEOUT_MS,
} from "../shared/voiceQuota";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
const DEFAULT_REALTIME_VOICE = "marin";
const MAX_AUDIO_BASE64_CHARS = 12_000_000;
const MAX_TURNS = 20;
const MAX_TURN_CHARS = 4_000;
const MAX_TYPED_CHARS = 4_000;
const MAX_SDP_CHARS = 250_000;
const MAX_PROVIDER_ERROR_CHARS = 1_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
const REVENUECAT_API_BASE = "https://api.revenuecat.com/v2";
const REVENUECAT_PROJECT_ID = "proj3d9a1ac2";
const REVENUECAT_ENTITLEMENT_ID = "entl006ec3f892";
const REVENUECAT_WEEKLY_PRODUCT_ID = "prod26382f88af";
const REVENUECAT_MONTHLY_PRODUCT_ID = "prod4b28bb924b";

type RealtimeUsage = {
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

type RawRealtimeUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    image_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: {
      text_tokens?: number;
      audio_tokens?: number;
      image_tokens?: number;
    };
  };
  output_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
  };
};

type RealtimeSidebandEvent = {
  type?: string;
  event_id?: string;
  response?: {
    id?: string;
    usage?: RawRealtimeUsage;
  };
};

type RevenueCatV2Entitlement = {
  id?: string;
  entitlement_id?: string;
  lookup_key?: string;
  expires_at?: number | null;
};

type RevenueCatV2Subscription = {
  product_id?: string;
  starts_at?: number;
  current_period_starts_at?: number;
  current_period_ends_at?: number;
  ends_at?: number | null;
  gives_access?: boolean;
  entitlements?: {
    items?: RevenueCatV2Entitlement[];
  };
};

type RevenueCatV2CustomerResponse = {
  active_entitlements?: {
    items?: RevenueCatV2Entitlement[];
  };
};

type RevenueCatV2SubscriptionsResponse = {
  items?: RevenueCatV2Subscription[];
};

function revenueCatPlanForProduct(productId: string | undefined) {
  if (productId === REVENUECAT_WEEKLY_PRODUCT_ID) return "weekly" as const;
  if (productId === REVENUECAT_MONTHLY_PRODUCT_ID) return "monthly" as const;
  return null;
}

async function fetchRevenueCatV2<T>(path: string): Promise<T> {
  const response = await fetch(
    `${REVENUECAT_API_BASE}/projects/${REVENUECAT_PROJECT_ID}${path}`,
    {
      headers: {
        Authorization: `Bearer ${requireRevenueCatApiKey()}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Could not verify the Volt Pro subscription (${providerErrorMessage(
        response.status,
        response.statusText,
        body,
      )}).`,
    );
  }

  return (await response.json()) as T;
}

function subscriptionHasVoltPro(
  subscription: RevenueCatV2Subscription,
): boolean {
  return Boolean(
    subscription.entitlements?.items?.some(
      (entitlement) =>
        entitlement.id === REVENUECAT_ENTITLEMENT_ID ||
        entitlement.entitlement_id === REVENUECAT_ENTITLEMENT_ID ||
        entitlement.lookup_key === "Volt Pro",
    ),
  );
}

function latestAccessibleSubscription(
  subscriptions: RevenueCatV2Subscription[],
): RevenueCatV2Subscription | undefined {
  return subscriptions
    .filter(
      (subscription) =>
        subscription.gives_access === true &&
        subscriptionHasVoltPro(subscription),
    )
    .sort(
      (left, right) =>
        (right.current_period_ends_at ?? right.ends_at ?? 0) -
        (left.current_period_ends_at ?? left.ends_at ?? 0),
    )[0];
}

function customerHasVoltPro(customer: RevenueCatV2CustomerResponse): boolean {
  return Boolean(
    customer.active_entitlements?.items?.some(
      (entitlement) =>
        entitlement.entitlement_id === REVENUECAT_ENTITLEMENT_ID &&
        (entitlement.expires_at == null || entitlement.expires_at > Date.now()),
    ),
  );
}

function revenueCatCustomerPath(appUserId: string, suffix = ""): string {
  return `/customers/${encodeURIComponent(appUserId)}${suffix}`;
}

type RevenueCatVoiceRecord = {
  customer: RevenueCatV2CustomerResponse;
  subscriptions: RevenueCatV2SubscriptionsResponse;
};

async function revenueCatVoiceRecord(
  appUserId: string,
): Promise<RevenueCatVoiceRecord> {
  const customerPath = revenueCatCustomerPath(appUserId);
  const [customer, subscriptions] = await Promise.all([
    fetchRevenueCatV2<RevenueCatV2CustomerResponse>(customerPath),
    fetchRevenueCatV2<RevenueCatV2SubscriptionsResponse>(
      `${customerPath}/subscriptions?limit=100`,
    ),
  ]);
  return { customer, subscriptions };
}

type VoiceQuotaEntitlement = {
  plan: "weekly" | "monthly";
  periodKey: string;
  periodStartAt: number;
  periodEndAt: number;
};

type CreatedRealtimeCall = {
  answerSdp: string;
  model: string;
  voice: string;
  sessionId: Id<"voiceRealtimeSessions">;
  maxDurationMs: number;
  expiresAt: number;
  quotaRemainingMs: number;
};

type JsonResult = {
  transcript?: string;
  summary?: string;
  note?: string;
};

type ReflectiveTurn = {
  role: "assistant" | "user";
  text: string;
  at?: number;
};

type ReflectiveResult = JsonResult & {
  userTranscript?: string;
  assistantText?: string;
  shouldComplete?: boolean | string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | null;
    };
  }[];
};

type TranscriptionResponse = {
  text?: string;
};

function assertTextLength(label: string, value: string | undefined, max: number): void {
  if (value !== undefined && value.length > max) {
    throw new Error(`${label} exceeds the ${max} character limit`);
  }
}

function assertAudioInput(audioBase64: string | undefined, mimeType: string | undefined): void {
  if (audioBase64 === undefined) return;
  if (audioBase64.length === 0 || audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    throw new Error("Audio recording is empty or too large");
  }
  if (
    !mimeType ||
    !["audio/mp4", "audio/m4a", "audio/webm", "audio/wav", "audio/mpeg"].includes(
      mimeType.toLowerCase(),
    )
  ) {
    throw new Error("Unsupported audio format");
  }
}

function assertTurns(turns: ReflectiveTurn[]): void {
  if (turns.length > MAX_TURNS) {
    throw new Error(`A maximum of ${MAX_TURNS} conversation turns is supported`);
  }
  for (const turn of turns) {
    assertTextLength("Conversation turn", turn.text, MAX_TURN_CHARS);
  }
}

function assertActivityIdentity(activityKey: string, activityName: string): void {
  assertTextLength("Activity key", activityKey, 80);
  assertTextLength("Activity name", activityName, 120);
}

function requireApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in Convex environment.");
  }
  return apiKey;
}

function requireRevenueCatApiKey(): string {
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    throw new Error("Missing REVENUECAT_API_KEY in Convex environment.");
  }
  return apiKey;
}

function providerErrorMessage(status: number, statusText: string, body: string): string {
  let message = statusText || "Request failed";
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      message = parsed.error?.message ?? body;
    } catch {
      message = body;
    }
  }
  return `${status}: ${message.slice(0, MAX_PROVIDER_ERROR_CHARS)}`;
}

async function revenueCatVoiceEntitlement(
  appUserId: string,
): Promise<VoiceQuotaEntitlement> {
  const { customer, subscriptions } =
    await revenueCatVoiceRecord(appUserId);
  if (!customerHasVoltPro(customer)) {
    throw new Error("Volt Pro is required for live voice coaching.");
  }

  const now = Date.now();
  const subscription = latestAccessibleSubscription(
    subscriptions.items ?? [],
  );
  const plan = revenueCatPlanForProduct(subscription?.product_id);
  if (!subscription || !plan) {
    throw new Error("Your Volt Pro plan is not eligible for live voice coaching.");
  }

  const purchaseAt =
    subscription.current_period_starts_at ?? subscription.starts_at;
  const subscriptionExpiresAt =
    subscription.current_period_ends_at ?? subscription.ends_at ?? undefined;
  return {
    plan,
    ...voiceQuotaPeriod({
      plan,
      now,
      purchaseAt,
      expiresAt: subscriptionExpiresAt,
    }),
  };
}

function extractRealtimeCallId(location: string | null): string | undefined {
  if (!location) return undefined;
  const match = location.match(/\/realtime\/calls\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

async function hangupRealtimeCall(callId: string): Promise<void> {
  const response = await fetch(
    `${OPENAI_API_BASE}/realtime/calls/${encodeURIComponent(callId)}/hangup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
      },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    },
  );
  if (response.ok || response.status === 404 || response.status === 409) return;

  const body = await response.text().catch(() => "");
  throw new Error(
    `OpenAI Realtime hangup failed (${providerErrorMessage(
      response.status,
      response.statusText,
      body,
    )})`,
  );
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function normalizeRealtimeUsage(
  usage: RawRealtimeUsage | undefined,
): RealtimeUsage | undefined {
  if (!usage) return undefined;
  const input = usage.input_token_details;
  const cached = input?.cached_tokens_details;
  const output = usage.output_token_details;
  return {
    totalTokens: tokenCount(usage.total_tokens),
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    inputTextTokens: tokenCount(input?.text_tokens),
    inputAudioTokens: tokenCount(input?.audio_tokens),
    inputImageTokens: tokenCount(input?.image_tokens),
    cachedTokens: tokenCount(input?.cached_tokens),
    cachedTextTokens: tokenCount(cached?.text_tokens),
    cachedAudioTokens: tokenCount(cached?.audio_tokens),
    cachedImageTokens: tokenCount(cached?.image_tokens),
    outputTextTokens: tokenCount(output?.text_tokens),
    outputAudioTokens: tokenCount(output?.audio_tokens),
  };
}

function realtimeEventIsActivity(type: string): boolean {
  return (
    type.startsWith("input_audio_buffer.") ||
    type.startsWith("conversation.item.") ||
    type.startsWith("response.")
  );
}

async function closeRealtimeSession(
  ctx: ActionCtx,
  sessionId: Id<"voiceRealtimeSessions">,
  reason: string,
) {
  const session = await ctx.runQuery(internal.voiceUsage.getSessionControl, {
    sessionId,
  });
  if (!session || session.status === "ended" || session.status === "cancelled") {
    return null;
  }
  const endedAt = Date.now();

  if (session.providerCallId) {
    try {
      await hangupRealtimeCall(session.providerCallId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OpenAI Realtime hangup failed.";
      await ctx.runMutation(internal.voiceUsage.markMonitorError, {
        sessionId,
        message,
      });
    }
  }

  return await ctx.runMutation(internal.voiceUsage.finalizeSessionByServer, {
    sessionId,
    reason,
    endedAt,
  });
}

function chatModel(): string {
  return process.env.OPENAI_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
}

function transcriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;
}

function realtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
}

function realtimeVoice(): string {
  return process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;
}

async function safetyIdentifier(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reflectiveCoachInstruction(activityName: string, activityKey: string, triggerType?: string): string {
  const base = [
    "You are Volt, a warm but concise habit coach in a mobile app that helps people reduce compulsive social media use.",
    "You are speaking out loud, so keep assistantText under 28 words unless the user is finishing.",
    "Ask one clear follow-up question at a time. Do not lecture. Make the user feel seen, then guide them into one concrete reflection or action.",
    "Never claim the user completed the habit until there is at least one meaningful user response.",
    `Current activity: ${activityName} (${activityKey}).`,
  ];
  if (triggerType === "fast_fuel_spend") {
    base.push(
      "This session was triggered because the user used scroll fuel quickly. Help them notice the urge and choose one next step without shaming them.",
    );
  }
  return base.join(" ");
}

function reflectiveRealtimeInstruction(activityName: string, activityKey: string, triggerType?: string): string {
  const activityGoals: Record<string, string> = {
    gratitude: "Help the user name something specific they appreciate and why it matters today.",
    kindact: "Help the user describe the kind action and its effect, then choose a small next action.",
    mindfulwalk: "Help the user notice one concrete sight, sound, sensation, or change in attention.",
    planday: "Help the user choose one priority and the first small action that starts it.",
    phonebed: "Help the user choose a realistic phone boundary and a calming next step for tonight.",
    clean: "Help the user name what they cleaned, how it feels now, and the next tiny area if useful.",
    instrument: "Help the user reflect on what they practised and choose the next focused repetition.",
    study: "Help the user name what they studied and identify the next tiny step.",
    read: "Help the user recall one useful idea and decide how they want to remember or use it.",
    cookmeal: "Help the user reflect on what they prepared and one thing that went well.",
    grayscale: "Help the user notice whether grayscale changed the urge to scroll and choose what to do next.",
    scrollreset: "Help the user notice the urge to scroll without shame and choose one immediate alternative.",
  };

  return [
    "# Role and Objective",
    reflectiveCoachInstruction(activityName, activityKey, triggerType),
    "",
    "# Voice Behavior",
    "This is a live speech-to-speech session. Listen to the user directly and answer with natural spoken audio.",
    "Do not mention transcripts, transcription, files, uploads, or text-to-speech.",
    "Keep each spoken response to one or two short sentences unless the user asks for more.",
    "",
    "# Activity Goal",
    activityGoals[activityKey] ??
      "Help the user reflect on what they did, how it felt, and one useful next action.",
    "Ask only one question at a time.",
    "If the user is just testing audio, acknowledge briefly and return to the activity.",
    "",
    "# Completion",
    "When there is enough detail, say the session can be finished, but do not claim rewards or save anything yourself.",
  ].join("\n");
}

function movementRealtimeInstruction(activityName: string, activityKey: string): string {
  return [
    "# Role and Objective",
    "You are Volt, a natural live exercise coach inside a fitness app.",
    `Current exercise: ${activityName} (${activityKey}).`,
    "The app uses local on-device pose detection. It, not you, is the source of truth for reps, hold time, position, and form quality.",
    "",
    "# Activity Events",
    "Messages beginning with [LOCAL_ACTIVITY_EVENT] are trusted app telemetry, not words spoken by the user.",
    "Respond to each activity event with a motivating spoken cue of no more than eight words.",
    "Use the exact counts and timing in the event. Never invent a rep, duration, pose, completion, or visual observation.",
    "Do not repeat every field. Prefer useful cues such as the remaining count, steady pacing, form reminders, or brief celebration.",
    "",
    "# Live Conversation",
    "The user may speak while exercising. Answer naturally and briefly, then return attention to the exercise.",
    "Do not mention transcripts, text-to-speech, telemetry, internal events, or implementation details.",
    "Never repeat or respond to audio that sounds like your own immediately preceding words.",
    "Keep normal spoken replies to one short sentence unless the user asks for more.",
  ].join("\n");
}

async function fetchOpenAI<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireApiKey()}`);

  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = response.statusText;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        message = parsed.error?.message ?? body;
      } catch {
        message = body;
      }
    }
    throw new Error(`OpenAI request failed (${response.status}): ${message}`);
  }

  return (await response.json()) as T;
}

function parseJsonText<T extends Record<string, unknown>>(raw: string): T | undefined {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(source) as T;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean {
  return value === true || value === "true";
}

function audioBlobFromBase64(audioBase64: string, mimeType: string): Blob {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "voice.wav";
  if (mimeType.includes("webm")) return "voice.webm";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "voice.mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "voice.m4a";
  return "voice.audio";
}

async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append("file", audioBlobFromBase64(audioBase64, mimeType), filenameForMimeType(mimeType));
  form.append("model", transcriptionModel());
  form.append("response_format", "json");

  const response = await fetchOpenAI<TranscriptionResponse>("/audio/transcriptions", {
    method: "POST",
    body: form,
  });

  return response.text?.trim() ?? "";
}

async function completeJson<T extends Record<string, unknown>>(
  messages: ChatMessage[],
  temperature = 0.5,
): Promise<T> {
  const response = await fetchOpenAI<ChatCompletionResponse>("/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatModel(),
      messages,
      temperature,
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    }),
  });

  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return parseJsonText<T>(content) ?? ({ summary: content } as unknown as T);
}

const turnValidator = v.object({
  role: v.union(v.literal("assistant"), v.literal("user")),
  text: v.string(),
  at: v.optional(v.number()),
});

const triggerValidator = v.object({
  type: v.string(),
  minutesSpent: v.optional(v.number()),
  reason: v.optional(v.string()),
});

export const summarizeVoiceNote = action({
  args: {
    activityKey: v.string(),
    activityName: v.string(),
    audioBase64: v.string(),
    mimeType: v.string(),
    typedNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    assertActivityIdentity(args.activityKey, args.activityName);
    assertAudioInput(args.audioBase64, args.mimeType);
    assertTextLength("Typed note", args.typedNote, MAX_TYPED_CHARS);

    const transcript = await transcribeAudio(args.audioBase64, args.mimeType);
    const parsed = await completeJson<JsonResult>(
      [
        {
          role: "system",
          content:
            "You turn habit voice notes into concise JSON. Return only JSON with keys transcript, summary, and note.",
        },
        {
          role: "user",
          content: [
            `Activity: ${args.activityName} (${args.activityKey}).`,
            transcript ? `Voice transcript:\n${transcript}` : "The transcription was empty.",
            args.typedNote ? `The user also typed:\n${args.typedNote}` : "",
            "The note should be a polished first-person activity note suitable for storing in a habit log.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      0.35,
    );

    return {
      transcript: stringField(parsed.transcript) ?? transcript,
      summary: stringField(parsed.summary),
      note: stringField(parsed.note),
    };
  },
});

export const continueReflectiveSession = action({
  args: {
    activityKey: v.string(),
    activityName: v.string(),
    turns: v.array(turnValidator),
    audioBase64: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    typedText: v.optional(v.string()),
    trigger: v.optional(triggerValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    assertActivityIdentity(args.activityKey, args.activityName);
    assertTurns(args.turns);
    assertAudioInput(args.audioBase64, args.mimeType);
    assertTextLength("Typed response", args.typedText, MAX_TYPED_CHARS);
    assertTextLength("Trigger type", args.trigger?.type, 80);
    assertTextLength("Trigger reason", args.trigger?.reason, 500);
    if (!args.audioBase64 && !args.typedText?.trim()) {
      throw new Error("Record audio or type a response first.");
    }

    const audioTranscript =
      args.audioBase64 && args.mimeType ? await transcribeAudio(args.audioBase64, args.mimeType) : "";
    const latestUserText = [audioTranscript, args.typedText?.trim()].filter(Boolean).join("\n");
    const recentTurns: ChatMessage[] = args.turns.slice(-8).map((turn: ReflectiveTurn) => ({
      role: turn.role,
      content: turn.text,
    }));

    const parsed = await completeJson<ReflectiveResult>(
      [
        {
          role: "system",
          content: [
            reflectiveCoachInstruction(args.activityName, args.activityKey, args.trigger?.type),
            "Return only JSON with keys: userTranscript, assistantText, shouldComplete, summary, note.",
            "userTranscript is the transcript or cleaned typed response from this latest user turn.",
            "assistantText is the next thing Volt should say out loud.",
            "shouldComplete is true only when the conversation has enough detail to count as a completed habit session.",
            "summary is a short third-person summary. note is a polished first-person habit log note.",
          ].join(" "),
        },
        ...recentTurns,
        {
          role: "user",
          content: [
            args.trigger ? `Trigger context: ${JSON.stringify(args.trigger)}` : "",
            `Latest user response:\n${latestUserText || "Voice response"}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      0.75,
    );

    return {
      userTranscript:
        stringField(parsed.userTranscript) ?? stringField(parsed.transcript) ?? latestUserText,
      assistantText:
        stringField(parsed.assistantText) ??
        "Tell me a little more about that, and what you want to do next.",
      shouldComplete: booleanField(parsed.shouldComplete),
      summary: stringField(parsed.summary),
      note: stringField(parsed.note),
    };
  },
});

export const createReflectiveRealtimeCall = action({
  args: {
    activityKey: v.string(),
    activityName: v.string(),
    offerSdp: v.string(),
    trigger: v.optional(triggerValidator),
    sessionMode: v.optional(v.union(v.literal("reflective"), v.literal("movement"))),
  },
  handler: async (ctx, args): Promise<CreatedRealtimeCall> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    assertActivityIdentity(args.activityKey, args.activityName);
    assertTextLength("Realtime offer", args.offerSdp, MAX_SDP_CHARS);
    assertTextLength("Trigger type", args.trigger?.type, 80);
    assertTextLength("Trigger reason", args.trigger?.reason, 500);

    const sessionMode = args.sessionMode ?? "reflective";
    const profile = await ctx.runQuery(internal.voiceUsage.getAuthProfile, {
      userId,
    });
    if (!profile) {
      throw new Error("Finish setting up your Volt profile before starting voice.");
    }
    const entitlement = await revenueCatVoiceEntitlement(
      String(profile.profileId),
    );
    const openSessions = await ctx.runQuery(
      internal.voiceUsage.getOpenSessionsForUser,
      { userId },
    );
    for (const openSession of openSessions) {
      await closeRealtimeSession(
        ctx,
        openSession._id,
        "replaced_before_next_session",
      );
    }
    const reservation = await ctx.runMutation(
      internal.voiceUsage.reserveSession,
      {
        userId,
        plan: entitlement.plan,
        periodKey: entitlement.periodKey,
        periodStartAt: entitlement.periodStartAt,
        periodEndAt: entitlement.periodEndAt,
        activityType: args.activityKey,
        activityName: args.activityName,
        mode: sessionMode,
      },
    );

    const form = new FormData();
    form.set("sdp", args.offerSdp);
    form.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: realtimeModel(),
        instructions:
          sessionMode === "movement"
            ? movementRealtimeInstruction(args.activityName, args.activityKey)
            : reflectiveRealtimeInstruction(
                args.activityName,
                args.activityKey,
                args.trigger?.type,
              ),
        output_modalities: ["audio"],
        audio: {
          input: {
            noise_reduction: {
              type: sessionMode === "movement" ? "far_field" : "near_field",
            },
            ...(sessionMode === "reflective"
              ? {
                  transcription: {
                    model: transcriptionModel(),
                    language: "en",
                  },
                }
              : {}),
            turn_detection: {
              type: "server_vad",
              threshold: 0.72,
              prefix_padding_ms: 300,
              silence_duration_ms: sessionMode === "movement" ? 800 : 650,
              create_response: false,
              interrupt_response: false,
            },
          },
          output: {
            voice: realtimeVoice(),
          },
        },
      }),
    );

    let providerCallId: string | undefined;
    try {
      const response = await fetch(`${OPENAI_API_BASE}/realtime/calls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireApiKey()}`,
          "OpenAI-Safety-Identifier": await safetyIdentifier(identity.subject),
        },
        body: form,
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `OpenAI Realtime call failed (${providerErrorMessage(
            response.status,
            response.statusText,
            body,
          )})`,
        );
      }

      providerCallId = extractRealtimeCallId(response.headers.get("Location"));
      if (!providerCallId) {
        throw new Error("OpenAI Realtime did not return a call identifier.");
      }
      const answerSdp = await response.text();
      const activation = await ctx.runMutation(
        internal.voiceUsage.activateSession,
        {
          sessionId: reservation.sessionId,
          providerCallId,
          model: realtimeModel(),
          voice: realtimeVoice(),
        },
      );

      await ctx.scheduler.runAfter(
        0,
        internal.openai.monitorRealtimeCall,
        { sessionId: reservation.sessionId },
      );
      await ctx.scheduler.runAt(
        activation.expiresAt,
        internal.openai.enforceRealtimeSessionLimit,
        { sessionId: reservation.sessionId },
      );

      return {
        answerSdp,
        model: realtimeModel(),
        voice: realtimeVoice(),
        sessionId: reservation.sessionId,
        maxDurationMs: activation.authorizedDurationMs,
        expiresAt: activation.expiresAt,
        quotaRemainingMs: Math.max(
          0,
          reservation.remainingBeforeMs - activation.authorizedDurationMs,
        ),
      };
    } catch (error) {
      if (providerCallId) {
        await hangupRealtimeCall(providerCallId).catch(() => {});
      }
      await ctx.runMutation(internal.voiceUsage.cancelSession, {
        sessionId: reservation.sessionId,
        reason: "setup_failed",
      });
      throw error;
    }
  },
});

export const endRealtimeVoiceSession = action({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
    reason: v.union(
      v.literal("user"),
      v.literal("completed"),
      v.literal("client_idle"),
      v.literal("client_limit"),
      v.literal("remote"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args): Promise<{
    billedDurationMs: number;
    remainingMs: number;
  } | null> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const session = await ctx.runQuery(
      internal.voiceUsage.getSessionControl,
      { sessionId: args.sessionId },
    );
    if (!session || session.userId !== userId) {
      throw new Error("Voice session not found.");
    }
    return await closeRealtimeSession(ctx, args.sessionId, args.reason);
  },
});

export const enforceRealtimeSessionLimit = internalAction({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
  },
  handler: async (ctx, args): Promise<void> => {
    await closeRealtimeSession(ctx, args.sessionId, "max_duration");
  },
});

export const monitorRealtimeCall = internalAction({
  args: {
    sessionId: v.id("voiceRealtimeSessions"),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.runQuery(
      internal.voiceUsage.getSessionControl,
      { sessionId: args.sessionId },
    );
    if (
      !session ||
      session.status !== "active" ||
      !session.providerCallId ||
      !session.expiresAt
    ) {
      return;
    }

    await ctx.runMutation(internal.voiceUsage.markMonitorStarted, {
      sessionId: args.sessionId,
    });

    let socket: WebSocket | undefined;
    let idleTimer: ReturnType<typeof setInterval> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let lastActivityAt = Date.now();
    let finished = false;
    let resolveMonitor: (() => void) | undefined;
    let pendingUsage: Promise<void> = Promise.resolve();

    const finish = async (reason: string, monitorError?: string) => {
      if (finished) return;
      finished = true;
      if (idleTimer) clearInterval(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);

      try {
        if (monitorError) {
          await ctx.runMutation(internal.voiceUsage.markMonitorError, {
            sessionId: args.sessionId,
            message: monitorError.slice(0, MAX_PROVIDER_ERROR_CHARS),
          }).catch(() => {});
        }

        await pendingUsage.catch(() => {});
        if (
          socket &&
          socket.readyState !== WebSocket.CLOSED &&
          socket.readyState !== WebSocket.CLOSING
        ) {
          socket.close();
        }
        await closeRealtimeSession(ctx, args.sessionId, reason);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not finalize the Realtime session.";
        await ctx.runMutation(internal.voiceUsage.markMonitorError, {
          sessionId: args.sessionId,
          message,
        }).catch(() => {});
      } finally {
        resolveMonitor?.();
      }
    };

    await new Promise<void>((resolve) => {
      resolveMonitor = resolve;
      try {
        socket = new WebSocket(
          `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(
            session.providerCallId!,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${requireApiKey()}`,
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not create the OpenAI Realtime monitor.";
        void finish("monitor_error", message);
        return;
      }

      socket.on("message", (raw: RawData) => {
        let event: RealtimeSidebandEvent;
        try {
          event = JSON.parse(raw.toString()) as RealtimeSidebandEvent;
        } catch {
          return;
        }
        if (!event.type) return;
        if (realtimeEventIsActivity(event.type)) {
          lastActivityAt = Date.now();
        }
        if (event.type === "error") {
          void finish("provider_error", "OpenAI Realtime emitted an error event.");
          return;
        }
        if (event.type !== "response.done") return;

        const responseId = event.response?.id?.trim();
        const usage = normalizeRealtimeUsage(event.response?.usage);
        if (!responseId || responseId.length > 120 || !usage) return;
        pendingUsage = pendingUsage.then(async () => {
          try {
            await ctx.runMutation(internal.voiceUsage.recordServerUsage, {
              sessionId: args.sessionId,
              responseId,
              usage,
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Could not store Realtime usage.";
            await ctx.runMutation(internal.voiceUsage.markMonitorError, {
              sessionId: args.sessionId,
              message,
            });
          }
        });
      });

      socket.once("close", () => {
        void finish("provider_closed");
      });
      socket.once("error", (error: Error) => {
        void finish("monitor_error", error.message);
      });

      idleTimer = setInterval(() => {
        if (Date.now() - lastActivityAt >= VOICE_IDLE_TIMEOUT_MS) {
          void finish("idle_timeout");
        }
      }, 5_000);
      hardTimer = setTimeout(() => {
        void finish("max_duration");
      }, Math.max(0, session.expiresAt! - Date.now()));
    });
  },
});

export const summarizeReflectiveSession = action({
  args: {
    activityKey: v.string(),
    activityName: v.string(),
    turns: v.array(turnValidator),
    trigger: v.optional(triggerValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    assertActivityIdentity(args.activityKey, args.activityName);
    assertTurns(args.turns);
    assertTextLength("Trigger type", args.trigger?.type, 80);
    assertTextLength("Trigger reason", args.trigger?.reason, 500);

    const transcript = args.turns
      .map((turn: ReflectiveTurn) => `${turn.role === "assistant" ? "Volt" : "User"}: ${turn.text}`)
      .join("\n");

    const parsed = await completeJson<JsonResult>(
      [
        {
          role: "system",
          content:
            "You summarize completed coached habit sessions. Return only JSON with keys transcript, summary, and note.",
        },
        {
          role: "user",
          content: [
            `Activity: ${args.activityName} (${args.activityKey}).`,
            args.trigger ? `Trigger context: ${JSON.stringify(args.trigger)}` : "",
            "transcript should be a readable conversation transcript.",
            "summary should be one concise third-person sentence.",
            "note should be a polished first-person activity note suitable for storing in a habit log.",
            transcript,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      0.35,
    );

    return {
      transcript: stringField(parsed.transcript) ?? transcript,
      summary: stringField(parsed.summary),
      note: stringField(parsed.note),
    };
  },
});
