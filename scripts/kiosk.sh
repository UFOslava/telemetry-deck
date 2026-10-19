#!/usr/bin/env bash
# Telemetry Deck kiosk launcher - full-screen on a DRM output (headless, no mouse).
#
# Usage: kiosk.sh [URL] [OUTPUT_MODE]
#   URL          default: http://localhost:5173/
#   OUTPUT_MODE  "last" (default) = only the last connected output,
#                "extend" = across all outputs
set -euo pipefail

URL="${1:-http://localhost:5173/}"
OUTPUT_MODE="${2:-last}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

CHROME_FLAGS=(
  --kiosk
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --disable-session-crashed-bubble
  --disable-features=Translate,MediaRouter
  --autoplay-policy=no-user-gesture-required
  --check-for-update-interval=31536000
  --user-data-dir="${HOME}/.cache/telemetry-deck-kiosk"
  "${URL}"
)

exec cage -m "${OUTPUT_MODE}" -- google-chrome "${CHROME_FLAGS[@]}"
