const VoltShieldModule = {
  async isUsageAccessGranted() {
    return false;
  },
  async openUsageAccessSettings() {},
  async isAccessibilityServiceEnabled() {
    return false;
  },
  async openAccessibilitySettings() {},
  async setBlockedPackages(_packages: string[]) {},
  async getBlockedPackages() {
    return [] as string[];
  },
  async setFuelMinutesAvailable(_minutes: number) {},
  async setShieldEnabled(_enabled: boolean) {},
  async setShieldUnlockUntil(_timestampMs: number) {},
  async getShieldRuntimeState() {
    return { enabled: true, unlockUntil: 0 };
  },
  async getSocialMediaUsageMinutes(_days: number) {
    return { dailyAverageMinutes: 0, todayMinutes: 0, daysOfData: 0 };
  },
};

export default VoltShieldModule;
