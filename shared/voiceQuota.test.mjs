import assert from "node:assert/strict";
import {
  VOICE_IDLE_TIMEOUT_MS,
  VOICE_QUOTA_MINUTES,
  VOICE_SESSION_MAX_MS,
  inferVoicePlan,
  voiceAllowanceMs,
  voiceQuotaPeriod,
  voiceSessionAuthorizationMs,
} from "./voiceQuota.ts";

assert.equal(VOICE_SESSION_MAX_MS, 5 * 60 * 1000);
assert.equal(VOICE_IDLE_TIMEOUT_MS, 60 * 1000);
assert.equal(voiceAllowanceMs("weekly"), 35 * 60 * 1000);
assert.equal(voiceAllowanceMs("monthly"), 90 * 60 * 1000);
assert.equal(voiceSessionAuthorizationMs(20 * 60 * 1000), 5 * 60 * 1000);
assert.equal(voiceSessionAuthorizationMs(45_500.9), 45_500);
assert.equal(voiceSessionAuthorizationMs(-1), 0);
assert.deepEqual(VOICE_QUOTA_MINUTES, { weekly: 35, monthly: 90 });

assert.equal(inferVoicePlan("weekly_1199"), "weekly");
assert.equal(inferVoicePlan("monthly_2499"), "monthly");
assert.equal(inferVoicePlan("legacy_annual"), "monthly");
assert.equal(inferVoicePlan("unknown"), null);

const mondayNoon = Date.UTC(2026, 6, 20, 12);
assert.deepEqual(voiceQuotaPeriod({ plan: "weekly", now: mondayNoon }), {
  periodStartAt: Date.UTC(2026, 6, 20),
  periodEndAt: Date.UTC(2026, 6, 27),
  periodKey: `weekly:${Date.UTC(2026, 6, 20)}:${Date.UTC(2026, 6, 27)}`,
});

const july = voiceQuotaPeriod({
  plan: "monthly",
  now: Date.UTC(2026, 6, 18),
});
assert.equal(july.periodStartAt, Date.UTC(2026, 6, 1));
assert.equal(july.periodEndAt, Date.UTC(2026, 7, 1));

const realPurchase = Date.UTC(2026, 6, 15);
const realExpiry = Date.UTC(2026, 7, 15);
assert.deepEqual(
  voiceQuotaPeriod({
    plan: "monthly",
    now: Date.UTC(2026, 6, 18),
    purchaseAt: realPurchase,
    expiresAt: realExpiry,
  }),
  {
    periodStartAt: realPurchase,
    periodEndAt: realExpiry,
    periodKey: `monthly:${realPurchase}:${realExpiry}`,
  },
);

const sandboxExpiry = realPurchase + 5 * 60 * 1000;
assert.equal(
  voiceQuotaPeriod({
    plan: "monthly",
    now: realPurchase + 60 * 1000,
    purchaseAt: realPurchase,
    expiresAt: sandboxExpiry,
  }).periodStartAt,
  Date.UTC(2026, 6, 1),
  "accelerated sandbox renewals must not reset a production-sized quota",
);

console.log("voice quota checks passed");
