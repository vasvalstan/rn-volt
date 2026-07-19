#!/usr/bin/env bash
# Usage: bash scripts/appscreens/capture-ios-iphone.sh <step>
exec "$(cd "$(dirname "$0")" && pwd)/capture-ios.sh" "${1:?usage: $0 <step>}" iphone
