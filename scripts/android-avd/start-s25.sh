#!/usr/bin/env bash
exec "${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator" -avd Volt_S25_1080x2340 "$@"
