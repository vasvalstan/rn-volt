#!/usr/bin/env bash
# Usage: bash scripts/appscreens/capture-android-phone.sh <step>
exec "$(cd "$(dirname "$0")" && pwd)/capture-android.sh" "${1:?usage: $0 <step>}" phone
