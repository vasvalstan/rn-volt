import ExpoModulesCore

public class VoltShieldModule: Module {
  private let shieldEnabledKey = "voltShieldEnabled"
  private let shieldUnlockUntilKey = "voltShieldUnlockUntil"

  private func appGroupDefaults() -> UserDefaults? {
    guard
      let appGroup = Bundle.main.object(
        forInfoDictionaryKey: "REACT_NATIVE_DEVICE_ACTIVITY_APP_GROUP"
      ) as? String
    else {
      return nil
    }
    return UserDefaults(suiteName: appGroup)
  }

  public func definition() -> ModuleDefinition {
    Name("VoltShield")

    AsyncFunction("isUsageAccessGranted") {
      false
    }

    AsyncFunction("openUsageAccessSettings") {}

    AsyncFunction("isAccessibilityServiceEnabled") {
      false
    }

    AsyncFunction("openAccessibilitySettings") {}

    AsyncFunction("setBlockedPackages") { (_: [String]) in }

    AsyncFunction("getBlockedPackages") {
      [String]()
    }

    AsyncFunction("setFuelMinutesAvailable") { (minutes: Int) in
      guard let defaults = self.appGroupDefaults() else { return }
      defaults.set(minutes, forKey: "voltFuelMinutesAvailable")
    }

    AsyncFunction("setShieldEnabled") { (enabled: Bool) in
      self.appGroupDefaults()?.set(enabled, forKey: self.shieldEnabledKey)
    }

    AsyncFunction("setShieldUnlockUntil") { (timestampMs: Double) in
      self.appGroupDefaults()?.set(
        max(0, timestampMs),
        forKey: self.shieldUnlockUntilKey
      )
    }

    AsyncFunction("getShieldRuntimeState") {
      let defaults = self.appGroupDefaults()
      let enabled = defaults?.object(forKey: self.shieldEnabledKey) as? Bool ?? true
      let unlockUntil = defaults?.double(forKey: self.shieldUnlockUntilKey) ?? 0
      return [
        "enabled": enabled,
        "unlockUntil": unlockUntil,
      ] as [String: Any]
    }
  }
}
