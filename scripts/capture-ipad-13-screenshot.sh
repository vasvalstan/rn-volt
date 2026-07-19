#!/usr/bin/env bash
# Full-resolution PNG from iPad Pro 13-inch (M5) simulator (2064×2752).
# Do not rely on Simulator ⌘S for store assets — it can save a scaled window size (e.g. 768×1024).
set -euo pipefail
UDID="01005EE1-F5B0-4BBF-BE8E-94AB96B12CC9"
NAME="iPad Pro 13-inch (M5)"
OUT="${1:-$HOME/Desktop/ipad-pro-13-$(date +%Y%m%d-%H%M%S).png}"

if ! xcrun simctl list devices booted | grep -q "$UDID"; then
  echo "Booting $NAME..."
  xcrun simctl boot "$UDID" 2>/dev/null || true
  open -a Simulator
  sleep 2
fi

xcrun simctl io "$UDID" screenshot "$OUT"
echo "Wrote: $OUT"
sips -g pixelWidth -g pixelHeight "$OUT"
