export type VoicePlan = "weekly" | "monthly";

export const VOICE_QUOTA_MINUTES: Record<VoicePlan, number> = {
  weekly: 35,
  monthly: 90,
};

export const VOICE_SESSION_MAX_MS = 5 * 60 * 1000;
export const VOICE_IDLE_TIMEOUT_MS = 60 * 1000;
export const VOICE_RESERVATION_TTL_MS = 30 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function voiceAllowanceMs(plan: VoicePlan): number {
  return VOICE_QUOTA_MINUTES[plan] * 60 * 1000;
}

export function voiceSessionAuthorizationMs(remainingMs: number): number {
  if (!Number.isFinite(remainingMs)) return 0;
  return Math.min(
    VOICE_SESSION_MAX_MS,
    Math.max(0, Math.floor(remainingMs)),
  );
}

export function inferVoicePlan(productIdentifier: string): VoicePlan | null {
  const id = productIdentifier.trim().toLowerCase();
  if (id.includes("week")) return "weekly";
  if (id.includes("month") || id.includes("year") || id.includes("annual")) {
    return "monthly";
  }
  return null;
}

function utcCalendarPeriod(plan: VoicePlan, now: number) {
  const date = new Date(now);
  if (plan === "weekly") {
    const day = date.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const periodStartAt = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysSinceMonday,
    );
    return {
      periodStartAt,
      periodEndAt: periodStartAt + 7 * DAY_MS,
    };
  }

  const periodStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const periodEndAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { periodStartAt, periodEndAt };
}

export function voiceQuotaPeriod(args: {
  plan: VoicePlan;
  now: number;
  purchaseAt?: number;
  expiresAt?: number;
}): { periodStartAt: number; periodEndAt: number; periodKey: string } {
  const { plan, now, purchaseAt, expiresAt } = args;
  const duration =
    purchaseAt !== undefined && expiresAt !== undefined ? expiresAt - purchaseAt : 0;
  const durationLooksReal =
    plan === "weekly"
      ? duration >= 6 * DAY_MS && duration <= 10 * DAY_MS
      : duration >= 20 * DAY_MS && duration <= 40 * DAY_MS;

  const period =
    durationLooksReal &&
    purchaseAt !== undefined &&
    expiresAt !== undefined &&
    purchaseAt <= now &&
    expiresAt > now
      ? { periodStartAt: purchaseAt, periodEndAt: expiresAt }
      : utcCalendarPeriod(plan, now);

  return {
    ...period,
    periodKey: `${plan}:${period.periodStartAt}:${period.periodEndAt}`,
  };
}
