#!/usr/bin/env bash
# Boot iPhone 17 Pro Max + iPad Pro 13" (M5) simulators and start both Volt Android AVDs.
# Heavy on RAM/CPU — close other emulators first.
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
EMU="$SDK/emulator/emulator"

IPHONE_UDID="${APPSCREENS_IPHONE_UDID:-E3505110-10F0-4FDB-B6AF-0AF4011F7832}"
IPAD_UDID="${APPSCREENS_IPAD_UDID:-01005EE1-F5B0-4BBF-BE8E-94AB96B12CC9}"

echo "Booting iOS simulators..."
xcrun simctl boot "$IPHONE_UDID" 2>/dev/null || true
xcrun simctl boot "$IPAD_UDID" 2>/dev/null || true
open -a Simulator

if [[ ! -x "$EMU" ]]; then
  echo "Emulator not found at $EMU — set ANDROID_HOME."
  exit 1
fi

echo "Starting Android AVDs (background)..."
"$EMU" -avd Volt_S25_1080x2340 >/tmp/volt-emulator-s25.log 2>&1 &
"$EMU" -avd Volt_TabS8U_1848x2960 >/tmp/volt-emulator-tab.log 2>&1 &

echo ""
echo "iOS: Use Simulator → Window to switch between iPhone 17 Pro Max and iPad Pro 13-inch."
echo "     Start Metro (npm run start:dev-client), then: npm run appscreens:run-ios-both"
echo "     See repo-root STORE_SCREENSHOTS.md for sizes and checklists."
echo "Android: wait until 'adb devices' lists two emulators, then run the app on each (or use two terminal runs)."
echo ""
echo "  adb devices"
echo "  cd test && npx expo run:android   # repeat with ANDROID_SERIAL=... if both are online"
echo ""
