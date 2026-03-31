import ExpoModulesCore

public class VoltShieldModule: Module {
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
      guard
        let appGroup = Bundle.main.object(forInfoDictionaryKey: "REACT_NATIVE_DEVICE_ACTIVITY_APP_GROUP") as? String,
        let defaults = UserDefaults(suiteName: appGroup)
      else {
        return
      }
      defaults.set(minutes, forKey: "voltFuelMinutesAvailable")
    }
  }
}
