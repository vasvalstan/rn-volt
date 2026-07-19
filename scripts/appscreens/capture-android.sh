#!/usr/bin/env bash
# Capture PNG from one or both Android emulators (1080×2340 phone + 1848×2960 tablet).
# Usage:
#   bash scripts/appscreens/capture-android.sh <step>           # both (default)
#   bash scripts/appscreens/capture-android.sh <step> phone    # S25-class only
#   bash scripts/appscreens/capture-android.sh <step> tablet   # Tab S8U-class only
#   bash scripts/appscreens/capture-android.sh <step> both
# Prereq: adb; boot the emulator(s) you need; only that device must be online for single-device mode.
set -euo pipefail

STEP="${1:-step}"
DEVICE="${2:-both}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUT_ROOT="${APPSCREENS_OUT:-$REPO_ROOT/screenshots/appscreens-raw}"
OUT="$OUT_ROOT/$STEP"
mkdir -p "$OUT"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Add platform-tools to PATH (Android SDK)."
  exit 1
fi

EMS=$(adb devices | awk '/emulator-[0-9]+/ {print $1}')
if [[ -z "${EMS// /}" ]]; then
  echo "No emulators in adb devices. Start Volt_S25_1080x2340 and/or Volt_TabS8U_1848x2960."
  exit 1
fi

found_phone=
found_tab=
fail=0

for serial in $EMS; do
  sz=$(adb -s "$serial" shell wm size 2>/dev/null | tr -d '\r' | head -1 || true)
  if [[ "$sz" == *1080*x*2340* ]]; then
    if [[ "$DEVICE" == "phone" || "$DEVICE" == "both" || "$DEVICE" == "all" || "$DEVICE" == "" ]]; then
      echo "→ $OUT/android-phone-1080x2340.png ($serial) [$sz]"
      adb -s "$serial" exec-out screencap -p > "$OUT/android-phone-1080x2340.png"
      found_phone=1
    fi
  elif [[ "$sz" == *1848*x*2960* ]]; then
    if [[ "$DEVICE" == "tablet" || "$DEVICE" == "both" || "$DEVICE" == "all" || "$DEVICE" == "" ]]; then
      echo "→ $OUT/android-tablet-1848x2960.png ($serial) [$sz]"
      adb -s "$serial" exec-out screencap -p > "$OUT/android-tablet-1848x2960.png"
      found_tab=1
    fi
  else
    echo "Note: $serial size [$sz] — not matched (expected 1080x2340 or 1848x2960)."
  fi
done

fail=0
if [[ "$DEVICE" == "phone" || "$DEVICE" == "both" || "$DEVICE" == "all" || "$DEVICE" == "" ]]; then
  if [[ -z "$found_phone" ]]; then
    echo "Warning: no 1080x2340 emulator captured."
    [[ "$DEVICE" == "phone" ]] && fail=1
  elif [[ -f "$OUT/android-phone-1080x2340.png" ]]; then
    sips -g pixelWidth -g pixelHeight "$OUT/android-phone-1080x2340.png" 2>/dev/null || file "$OUT/android-phone-1080x2340.png"
  fi
fi
if [[ "$DEVICE" == "tablet" || "$DEVICE" == "both" || "$DEVICE" == "all" || "$DEVICE" == "" ]]; then
  if [[ -z "$found_tab" ]]; then
    echo "Warning: no 1848x2960 emulator captured."
    [[ "$DEVICE" == "tablet" ]] && fail=1
  elif [[ -f "$OUT/android-tablet-1848x2960.png" ]]; then
    sips -g pixelWidth -g pixelHeight "$OUT/android-tablet-1848x2960.png" 2>/dev/null || file "$OUT/android-tablet-1848x2960.png"
  fi
fi

exit "$fail"
