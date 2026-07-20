#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

convex_pid=""

cleanup() {
  if [[ -n "$convex_pid" ]] && kill -0 "$convex_pid" 2>/dev/null; then
    kill "$convex_pid" 2>/dev/null || true
    wait "$convex_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Convex dev server..."
npx convex dev &
convex_pid=$!

echo "Starting Expo. Use the Expo CLI prompts or press i/a/w to choose a device."
npx expo start "$@"
