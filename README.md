# Telemetry Deck

Live holographic telemetry dashboard: FastAPI backend + Vite/Three.js frontend.
Architecture and visual spec: [live_holographic_telemetry_deck_spec.md](live_holographic_telemetry_deck_spec.md).

## Run locally (front + back) — Slava-lap

Double-click **`Run-Deck.cmd`** (or run `scripts\Run-Dev.ps1` from PowerShell).
Everything is preinstalled on the laptop (root `.venv` with uvicorn,
`frontend\node_modules` with Vite). The script:

- loads the ignored `.env` from the repo root (TomTom key),
- starts uvicorn on `127.0.0.1:8000` and Vite on `http://localhost:5173`,
- stops both when you press Ctrl+C.

Optional ports:
`powershell -ExecutionPolicy Bypass -File scripts\Run-Dev.ps1 -BackendPort 8010 -FrontendPort 5180`

Linux/macOS equivalent: `./scripts/dev.sh` (creates `backend/.venv`, installs
dependencies when `requirements.txt` changes, auto-picks a free frontend port).
Overrides: `BACKEND_PORT`, `FRONTEND_PORT`, `PYTHON`.

## Containers

```bash
docker compose up --build     # local images, backend :18000, frontend :5173
```

## Deployment (era-server)

CI on `main`:

1. `build` — GitHub-hosted runners build both images and push
   `ghcr.io/ufoslava/telemetry-deck-{backend,frontend}:latest` (+ branch/SHA tags).
2. `deploy` — the self-hosted runner `era-server-telemetry-deck` pulls the new
   images at `/opt/stacks/telemetry-deck` (`deploy/compose.yaml`), recreates the
   containers and verifies `http://127.0.0.1:5173/api/health`.

Server-side state:

- `/opt/stacks/telemetry-deck/.env` — runtime secrets (`TomTom_API_Key`); created
  once from `.env.example` and never overwritten by CI.
- `/opt/stacks/telemetry-deck/config/settings.json` — kiosk settings; created once,
  then owned by the running deck.
- Frontend: `http://<era-server>:5173`, backend (local only): `127.0.0.1:18000`.

## Kiosk

`scripts/kiosk.sh [URL] [last|extend]` launches Chrome full-screen under cage on a
DRM output (see `scripts/telemetry-deck-kiosk.service`).
