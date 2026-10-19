# Telemetry Deck

Live holographic telemetry dashboard: FastAPI backend + Vite/Three.js frontend.
Architecture and visual spec: [live_holographic_telemetry_deck_spec.md](live_holographic_telemetry_deck_spec.md).

## Run locally (front + back)

```bash
cp .env.example .env        # add TomTom_API_Key for traffic data
./scripts/dev.sh
```

The script creates `backend/.venv`, installs dependencies on change, starts
uvicorn on `127.0.0.1:8000` and Vite on `http://localhost:5173` (which proxies
`/api` and `/ws` to the backend). Ctrl-C stops both.

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
