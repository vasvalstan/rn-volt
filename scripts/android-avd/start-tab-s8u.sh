#!/usr/bin/env bash
exec "${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator" -avd Volt_TabS8U_1848x2960 "$@"
