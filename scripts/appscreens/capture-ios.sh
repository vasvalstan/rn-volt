#!/usr/bin/env bash
# Capture full-resolution PNG from one or both iOS simulators (AppScreens sizes).
# Usage:
#   bash scripts/appscreens/capture-ios.sh <step>           # both (default)
#   bash scripts/appscreens/capture-ios.sh <step> iphone   # iPhone 17 Pro Max only
#   bash scripts/appscreens/capture-ios.sh <step> ipad     # iPad Pro 13" only
#   bash scripts/appscreens/capture-ios.sh <step> both
# Prereq: target simulator(s) booted; align UI on the device you are capturing.
set -euo pipefail

STEP="${1:-step}"
DEVICE="${2:-both}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUT_ROOT="${APPSCREENS_OUT:-$REPO_ROOT/screenshots/appscreens-raw}"
OUT="$OUT_ROOT/$STEP"
mkdir -p "$OUT"

IPHONE_UDID="${APPSCREENS_IPHONE_UDID:-E3505110-10F0-4FDB-B6AF-0AF4011F7832}"
IPAD_UDID="${APPSCREENS_IPAD_UDID:-01005EE1-F5B0-4BBF-BE8E-94AB96B12CC9}"

capture_iphone() {
  if ! xcrun simctl list devices booted | grep -q "$IPHONE_UDID"; then
    echo "Warning: iPhone simulator $IPHONE_UDID is not booted."
  fi
  echo "→ $OUT/ios-iphone-6p9.png"
  xcrun simctl io "$IPHONE_UDID" screenshot "$OUT/ios-iphone-6p9.png"
  sips -g pixelWidth -g pixelHeight "$OUT/ios-iphone-6p9.png"
}

capture_ipad() {
  if ! xcrun simctl list devices booted | grep -q "$IPAD_UDID"; then
    echo "Warning: iPad simulator $IPAD_UDID is not booted."
  fi
  echo "→ $OUT/ios-ipad-13.png"
  xcrun simctl io "$IPAD_UDID" screenshot "$OUT/ios-ipad-13.png"
  sips -g pixelWidth -g pixelHeight "$OUT/ios-ipad-13.png"
}

case "$DEVICE" in
  iphone|phone)
    capture_iphone
    ;;
  ipad)
    capture_ipad
    ;;
  both|all|"")
    for udid in "$IPHONE_UDID" "$IPAD_UDID"; do
      if ! xcrun simctl list devices booted | grep -q "$udid"; then
        echo "Warning: $udid is not in the booted list — boot it (Simulator or xcrun simctl boot)."
      fi
    done
    capture_iphone
    capture_ipad
    ;;
  *)
    echo "Unknown device '$DEVICE'. Use: iphone | ipad | both"
    exit 1
    ;;
esac
