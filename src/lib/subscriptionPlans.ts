export type BillingPeriod = "weekly" | "monthly" | "yearly";
export type PurchasableBillingPeriod = Exclude<BillingPeriod, "yearly">;

export const PACKAGE_IDENTIFIER_BY_PERIOD: Record<PurchasableBillingPeriod, string> = {
  weekly: "$rc_weekly",
  monthly: "$rc_monthly",
};
