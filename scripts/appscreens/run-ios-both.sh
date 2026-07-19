#!/usr/bin/env bash
# Install and launch the dev client on iPhone 17 Pro Max + iPad Pro 13" (M5) simulators.
# Prereq: both simulators booted (e.g. npm run appscreens:start-all) AND Metro:
#   npm run start:dev-client
# Uses --no-bundler so a single Metro instance serves both apps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

IPHONE_UDID="${APPSCREENS_IPHONE_UDID:-E3505110-10F0-4FDB-B6AF-0AF4011F7832}"
IPAD_UDID="${APPSCREENS_IPAD_UDID:-01005EE1-F5B0-4BBF-BE8E-94AB96B12CC9}"

for udid in "$IPHONE_UDID" "$IPAD_UDID"; do
  if ! xcrun simctl list devices booted | grep -q "$udid"; then
    echo "Error: simulator $udid is not booted. Run: npm run appscreens:start-all"
    exit 1
  fi
done

echo "→ iPhone ($IPHONE_UDID)"
npx expo run:ios --no-bundler -d "$IPHONE_UDID"

echo "→ iPad ($IPAD_UDID)"
npx expo run:ios --no-bundler -d "$IPAD_UDID"

echo ""
echo "Done. Switch Simulator → Window to move between iPhone and iPad; align UI, then capture."
