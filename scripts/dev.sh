#!/usr/bin/env bash
# Telemetry Deck — local development launcher (backend + frontend).
#
#   ./scripts/dev.sh
#
# Starts:
#   backend  -> uvicorn --reload on 127.0.0.1:8000
#   frontend -> vite dev server on :5173 (proxies /api and /ws to the backend)
#
# Ctrl-C stops both. Requires python3 (+ venv) and npm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

log() { printf '\033[1;36m[deck]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deck]\033[0m %s\n' "$*" >&2; exit 1; }

command -v "$PYTHON" >/dev/null 2>&1 || die "$PYTHON not found"
command -v npm >/dev/null 2>&1 || die "npm not found"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  log "Created .env from .env.example — set TomTom_API_Key there for traffic data."
fi

# Load .env (tolerate CRLF files edited on Windows).
set -a
# shellcheck disable=SC1090
source <(sed 's/\r$//' "$ROOT/.env")
set +a

# ---- backend ---------------------------------------------------------------
if [[ ! -x "$ROOT/backend/.venv/bin/python" || ! -x "$ROOT/backend/.venv/bin/pip" ]]; then
  log "Creating backend virtualenv…"
  rm -rf "$ROOT/backend/.venv"
  "$PYTHON" -m venv "$ROOT/backend/.venv" || die "python3 -m venv failed (install python3-venv)"
fi
PY="$ROOT/backend/.venv/bin/python"

REQ_HASH="$(sha256sum "$ROOT/backend/requirements.txt" | cut -d' ' -f1)"
STAMP="$ROOT/backend/.venv/.requirements.sha256"
if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$REQ_HASH" ]]; then
  log "Installing backend dependencies…"
  "$PY" -m pip install --upgrade pip >/dev/null
  "$PY" -m pip install -r "$ROOT/backend/requirements.txt"
  printf '%s\n' "$REQ_HASH" >"$STAMP"
fi

# ---- frontend --------------------------------------------------------------
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  log "Installing frontend dependencies…"
  ( cd "$ROOT/frontend" && npm install --no-audit --no-fund )
fi

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

if ! port_free "$BACKEND_PORT"; then
  die "Backend port $BACKEND_PORT is already in use. Set BACKEND_PORT=<free port>."
fi

# Pick the first free frontend port (production containers may hold 5173).
while ! port_free "$FRONTEND_PORT"; do
  FRONTEND_PORT=$((FRONTEND_PORT + 1))
done

cleanup() {
  trap - EXIT INT TERM
  log "Stopping…"
  [[ -n "${FE_PID:-}" ]] && kill "$FE_PID" 2>/dev/null || true
  [[ -n "${BE_PID:-}" ]] && kill "$BE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "Starting backend  http://127.0.0.1:${BACKEND_PORT}"
( cd "$ROOT/backend" && exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload ) &
BE_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    log "Backend is healthy."
    break
  fi
  kill -0 "$BE_PID" 2>/dev/null || die "Backend exited during startup."
  sleep 1
done

log "Starting frontend http://localhost:${FRONTEND_PORT}"
( cd "$ROOT/frontend" && BACKEND_PROXY="http://127.0.0.1:${BACKEND_PORT}" exec npm run dev -- --port "$FRONTEND_PORT" --strictPort ) &
FE_PID=$!

log "Deck ready:  http://localhost:${FRONTEND_PORT}"
log "API health:  http://localhost:${FRONTEND_PORT}/api/health"
log "Ctrl-C stops both."

wait -n "$BE_PID" "$FE_PID" 2>/dev/null || true
