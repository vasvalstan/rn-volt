import { Alert, Platform } from "react-native";
import Purchases, {
  type PurchasesPackage,
  type CustomerInfo,
  type PurchasesOffering,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
} from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import type { BillingPeriod } from "./subscriptionPlans";

export type { BillingPeriod } from "./subscriptionPlans";

// ─── CONFIG ──────────────────────────────────────────
const TEST_STORE_KEY = "test_UpIQJKQUbmdstACcNLYfbmYHnWc";
/** Public SDK keys from RevenueCat → Project settings → API keys. */
const IOS_PRODUCTION_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() ?? "";
const IOS_KEY = __DEV__ ? TEST_STORE_KEY : IOS_PRODUCTION_KEY;
const ANDROID_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() ?? "";

const API_KEY = Platform.select({
  ios: IOS_KEY,
  android: ANDROID_KEY,
}) as string;

export const REVENUECAT_NOT_CONFIGURED_MESSAGE =
  Platform.OS === "android"
    ? "Add your RevenueCat Google Play public API key to EXPO_PUBLIC_REVENUECAT_ANDROID_KEY in .env.local, then restart Metro (the iOS test key cannot be used on Android)."
    : "Add your RevenueCat App Store public API key to EXPO_PUBLIC_REVENUECAT_IOS_KEY in the production build environment.";

export const ENTITLEMENT_ID = "Volt Pro";

/** Store product IDs — keep aligned with the products in the current RevenueCat offering. */
export const STORE_PRODUCT_IDS = {
  weekly: "weekly_1199",
  monthly: "monthly_2399",
} as const;

let configured = false;

// ─── INIT ────────────────────────────────────────────
export function configureRevenueCat() {
  if (configured) return;
  if (!API_KEY) {
    if (Platform.OS === "android") {
      console.warn(
        "[RC] Missing EXPO_PUBLIC_REVENUECAT_ANDROID_KEY — Purchases not configured; paywall and IAP will not work on Android."
      );
    } else {
      console.warn("[RC] No API key — skipping configure");
    }
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({
    apiKey: API_KEY,
    appUserID: null,
  });
  configured = true;
}

export function isConfigured() {
  return configured;
}

// ─── IDENTITY ────────────────────────────────────────
export async function loginUser(
  appUserID: string
): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    const { customerInfo } = await Purchases.logIn(appUserID);
    return customerInfo;
  } catch (e) {
    console.error("[RC] login:", e);
    return null;
  }
}

export async function logoutUser() {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.error("[RC] logout:", e);
  }
}

// ─── CUSTOMER INFO ───────────────────────────────────
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    console.error("[RC] customerInfo:", e);
    return null;
  }
}

export function addCustomerInfoListener(
  listener: (info: CustomerInfo) => void
) {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}

export function hasEntitlement(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

/** True when RevenueCat knows this customer has ever held the Volt Pro entitlement. */
export function hasEntitlementHistory(info: CustomerInfo): boolean {
  return info.entitlements.all[ENTITLEMENT_ID] !== undefined;
}

/** Billing cadence for streak protection: weekly = 1 pass; monthly/yearly = 3 passes. */
function inferPeriodFromProductId(raw: string): BillingPeriod | null {
  const id = raw.toLowerCase();
  if (id.includes("year") || id.includes("annual")) return "yearly";
  if (id.includes("week")) return "weekly";
  if (id.includes("month")) return "monthly";
  return null;
}

/**
 * Best-effort from RevenueCat. Unknown SKUs default to the lower weekly allowance.
 */
export function getActiveBillingPeriod(info: CustomerInfo): BillingPeriod | null {
  if (!hasEntitlement(info)) return null;
  const ent = info.entitlements.active[ENTITLEMENT_ID];
  const fromEnt = ent?.productIdentifier
    ? inferPeriodFromProductId(ent.productIdentifier)
    : null;
  if (fromEnt) return fromEnt;

  for (const sub of info.activeSubscriptions) {
    const p = inferPeriodFromProductId(sub);
    if (p) return p;
  }

  return "weekly";
}

// ─── OFFERINGS ───────────────────────────────────────
export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch (e) {
    console.error("[RC] offerings:", e);
    return null;
  }
}

// ─── PURCHASE ────────────────────────────────────────
export type PurchaseResult = {
  success: boolean;
  cancelled?: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
};

export async function purchasePackage(
  pkg: PurchasesPackage
): Promise<PurchaseResult> {
  if (!configured) {
    return {
      success: false,
      error: REVENUECAT_NOT_CONFIGURED_MESSAGE,
    };
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { success: hasEntitlement(customerInfo), customerInfo };
  } catch (e: any) {
    if (e.userCancelled) return { success: false, cancelled: true };
    if (e.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
      const restored = await restorePurchases();
      return restored;
    }
    return { success: false, error: e.message ?? "Purchase failed" };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!configured) {
    return {
      success: false,
      error: REVENUECAT_NOT_CONFIGURED_MESSAGE,
    };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { success: hasEntitlement(customerInfo), customerInfo };
  } catch (e: any) {
    return { success: false, error: e.message ?? "Restore failed" };
  }
}

// ─── REVENUECAT PAYWALL UI ───────────────────────────
export async function presentPaywall(options?: {
  offering?: PurchasesOffering;
}): Promise<{ purchased: boolean; restored: boolean }> {
  if (!configured) {
    Alert.alert("Subscriptions unavailable", REVENUECAT_NOT_CONFIGURED_MESSAGE);
    return { purchased: false, restored: false };
  }
  try {
    const result = await RevenueCatUI.presentPaywall({
      displayCloseButton: true,
      offering: options?.offering ?? undefined,
    });

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
        return { purchased: true, restored: false };
      case PAYWALL_RESULT.RESTORED:
        return { purchased: false, restored: true };
      default:
        return { purchased: false, restored: false };
    }
  } catch (e) {
    console.error("[RC] paywall:", e);
    return { purchased: false, restored: false };
  }
}

export async function presentPaywallIfNeeded(): Promise<boolean> {
  if (!configured) {
    return false;
  }
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENT_ID,
    });
    return (
      result === PAYWALL_RESULT.PURCHASED ||
      result === PAYWALL_RESULT.RESTORED
    );
  } catch (e) {
    console.error("[RC] paywallIfNeeded:", e);
    return false;
  }
}

// ─── CUSTOMER CENTER ─────────────────────────────────
export async function presentCustomerCenter() {
  if (!configured) {
    Alert.alert("Subscriptions unavailable", REVENUECAT_NOT_CONFIGURED_MESSAGE);
    return;
  }
  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (e) {
    console.error("[RC] customerCenter:", e);
  }
}

// ─── QUICK STATUS CHECK ─────────────────────────────
export async function checkProStatus(): Promise<boolean> {
  const info = await getCustomerInfo();
  return info ? hasEntitlement(info) : false;
}

export { PAYWALL_RESULT } from "react-native-purchases-ui";
export type { PurchasesPackage, CustomerInfo, PurchasesOffering } from "react-native-purchases";
