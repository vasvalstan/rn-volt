import { NativeModule, requireNativeModule } from "expo";

export type SocialMediaUsageResult = {
  dailyAverageMinutes: number;
  todayMinutes: number;
  daysOfData: number;
};

export type ShieldRuntimeState = {
  enabled: boolean;
  unlockUntil: number;
};

declare class VoltShieldModule extends NativeModule {
  isUsageAccessGranted(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  isAccessibilityServiceEnabled(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  setBlockedPackages(packages: string[]): Promise<void>;
  getBlockedPackages(): Promise<string[]>;
  /** Sync Convex fuel bank to native (Android toast/notification + iOS Screen Time app group for shield placeholders). */
  setFuelMinutesAvailable(minutes: number): Promise<void>;
  setShieldEnabled(enabled: boolean): Promise<void>;
  setShieldUnlockUntil(timestampMs: number): Promise<void>;
  getShieldRuntimeState(): Promise<ShieldRuntimeState>;
  /** Query UsageStatsManager for social-media foreground time over the past N days. Android only. */
  getSocialMediaUsageMinutes(days: number): Promise<SocialMediaUsageResult>;
}

export default requireNativeModule<VoltShieldModule>("VoltShield");
