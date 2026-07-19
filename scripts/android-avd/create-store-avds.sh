#!/usr/bin/env bash
# If you need to recreate the store AVDs, delete these folders and re-clone from Android Studio:
#   ~/.android/avd/Volt_S25_1080x2340.avd
#   ~/.android/avd/Volt_S25_1080x2340.ini
#   ~/.android/avd/Volt_TabS8U_1848x2960.avd
#   ~/.android/avd/Volt_TabS8U_1848x2960.ini
# Then duplicate your working "Google Play" AVD in Device Manager and edit:
#   Phone:  1080 x 2340, density 420, skin pixel_5
#   Tablet: 1848 x 2960, density 340, disable device frame (no matching skin)
set -euo pipefail
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
"$SDK/emulator/emulator" -list-avds | grep -E 'Volt_' || echo "No Volt_* AVDs listed — create them in Device Manager (see comments in this script)."
