import { PACKAGE_IDENTIFIER_BY_PERIOD } from "../src/lib/subscriptionPlans.ts";

const expected = {
  weekly: "$rc_weekly",
  monthly: "$rc_monthly",
  yearly: "$rc_annual",
};

if (JSON.stringify(PACKAGE_IDENTIFIER_BY_PERIOD) !== JSON.stringify(expected)) {
  throw new Error("RevenueCat package mapping is incorrect");
}
