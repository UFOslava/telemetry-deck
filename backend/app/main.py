import os
import json
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# Load .env from workspace root or current dir
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv()

from app.config import settings
from app.services.dem_extractor import fetch_terrarium_tile
from app.services.traffic_poller import fetch_tomtom_traffic, cached_traffic

app = FastAPI(title="Tactical Holographic Telemetry Deck API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "yokneam_elevation_512.json")
active_connections = set()

@app.on_event("startup")
async def startup_event():
    # Initial traffic fetch
    asyncio.create_task(periodic_traffic_poller())

async def periodic_traffic_poller():
    while True:
        await fetch_tomtom_traffic()
        # Sleep for 5 minutes (300 seconds)
        await asyncio.sleep(settings.TRAFFIC_POLL_INTERVAL)

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "center": {
            "lat": settings.CENTER_LAT,
            "lon": settings.CENTER_LON,
            "radius_km": settings.RADIUS_KM
        },
        "tomtom_configured": bool(settings.get_tomtom_key())
    }

SETTINGS_DEFAULTS = {
    "centerLat": 32.6595,
    "centerLon": 35.1090,
    "radiusKm": 10.0,
    "stepMeters": 25.0,
    "contourOpacity": 0.42,
    "roadColor": 16770560,
    "roadOpacity": 0.95,
    "idleTimeoutMs": 30000,
    "idleRotationSpeed": 0.0015,
}


from fastapi.responses import HTMLResponse

SETTINGS_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "templates", "settings.html")

@app.get("/settings", response_class=HTMLResponse)
async def get_settings_page():
    if os.path.exists(SETTINGS_TEMPLATE_PATH):
        with open(SETTINGS_TEMPLATE_PATH, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h2>Settings page template not found.</h2>", status_code=404)


@app.get("/api/settings")
async def get_settings():
    """Tactical parameters loaded from disk (config/settings.json)."""
    path = os.path.abspath(settings.SETTINGS_FILE)
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except Exception:
            data = {}
    return {**SETTINGS_DEFAULTS, **data}


@app.put("/api/settings")
async def put_settings(payload: dict):
    path = os.path.abspath(settings.SETTINGS_FILE)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    merged = {**SETTINGS_DEFAULTS, **payload}
    with open(path, "w") as f:
        json.dump(merged, f, indent=2)

    # Broadcast settings_updated to all active WebSocket clients
    dead_connections = set()
    for ws in list(active_connections):
        try:
            await ws.send_json({
                "type": "settings_updated",
                "settings": merged
            })
        except Exception:
            dead_connections.add(ws)
    for ws in dead_connections:
        active_connections.discard(ws)

    return {"saved": True, "path": path, "clients_notified": len(active_connections)}


@app.get("/api/elevation")
async def get_elevation_grid():
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, "r") as f:
            return json.load(f)
    elev, bounds = fetch_terrarium_tile(settings.CENTER_LAT, settings.CENTER_LON, zoom=11)
    return {
        "bounds": bounds,
        "shape": list(elev.shape),
        "min_elevation": float(elev.min()),
        "max_elevation": float(elev.max()),
        "elevations": elev.tolist()
    }

@app.get("/api/traffic/flow")
async def get_traffic_flow():
    return await fetch_tomtom_traffic()

@app.get("/api/roads/tomtom")
async def get_tomtom_roads():
    tomtom_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "data", "tomtom_roads.json")
    if os.path.exists(tomtom_path):
        with open(tomtom_path, "r") as f:
            return json.load(f)
    return {"elements": [], "source": "empty"}

@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        await websocket.send_json({
            "type": "init",
            "center": {
                "lat": settings.CENTER_LAT,
                "lon": settings.CENTER_LON,
                "radius_km": settings.RADIUS_KM
            },
            "tomtom_active": bool(settings.get_tomtom_key())
        })
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
