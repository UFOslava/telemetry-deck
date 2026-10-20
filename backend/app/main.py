import io
import os
import json
import socket
import asyncio
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

# Load .env from workspace root or current dir
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv()

from app.config import settings
from app.services.dem_extractor import fetch_terrarium_tile
from app.services.traffic_poller import fetch_tomtom_traffic, cached_traffic
from app.services.iss_fetcher import get_iss_tle

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

@app.get("/api/version")
async def version_check():
    return {"version": os.getenv("APP_VERSION", "dev")}


def _lan_ip() -> str:
    """Best-effort LAN address of this host (no packets are sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


@app.get("/api/qr/settings")
async def settings_qr(request: Request):
    """QR code that opens the settings page over the LAN.

    The URL is built from the request host so it matches whatever address the
    deck is being viewed on. If the deck is viewed on localhost, the host's LAN
    address is substituted so a phone can actually reach it.
    """
    import qrcode
    from qrcode.image.svg import SvgPathImage

    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    hostname, _, port = host.partition(":")

    # The kiosk loads the deck from localhost, and inside a container the
    # detected "LAN" address would be the container bridge, so an explicit
    # public host is the only reliable source for a phone-scannable URL.
    public_host = os.getenv("DECK_PUBLIC_HOST", "").strip()
    if public_host:
        hostname = public_host
    elif hostname in ("", "localhost", "127.0.0.1", "0.0.0.0"):
        hostname = _lan_ip()
    port = port or "5173"
    base = f"http://{hostname}" + (f":{port}" if port else "")
    url = f"{base}/settings"

    img = qrcode.make(url, image_factory=SvgPathImage, box_size=8, border=1)
    buf = io.BytesIO()
    img.save(buf)
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-store",
            "X-QR-Target": url,
        },
    )

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
    "cameraRotationSpeed": 0.0015,
    "cylinderRotationSpeed": 0.035,
    "initialCameraPitch": 58.0,
    "aaMode": "fxaa",
    "issTrackingMode": "realtime",
}

@app.get("/api/satellites/iss")
async def get_iss_tle_endpoint():
    """Returns the latest Two-Line Elements (TLE) for the ISS from Celestrak."""
    return await get_iss_tle()


@app.get("/api/tomtom-config")
async def get_tomtom_config():
    """Returns TomTom client configuration for settings page map."""
    key = settings.get_tomtom_key()
    return {
        "configured": bool(key),
        "key": key
    }


@app.get("/api/tomtom/search")
async def search_tomtom(query: str = Query(..., min_length=1)):
    """Proxy TomTom Fuzzy Search to find coordinates for addresses/cities/landmarks."""
    key = settings.get_tomtom_key()
    if not key:
        return {"results": [], "error": "TomTom API key not configured"}
    url = f"https://api.tomtom.com/search/2/search/{query}.json"
    params = {"key": key, "limit": 5}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for r in data.get("results", []):
                    pos = r.get("position", {})
                    addr = r.get("address", {}).get("freeformAddress", "")
                    poi = r.get("poi", {}).get("name", "")
                    name = f"{poi} - {addr}" if poi and addr and poi not in addr else (poi or addr or "Location")
                    results.append({
                        "name": name,
                        "lat": pos.get("lat"),
                        "lon": pos.get("lon"),
                        "type": r.get("type", "")
                    })
                return {"results": results}
    except Exception as e:
        return {"results": [], "error": str(e)}
    return {"results": []}


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

@app.get("/api/weather")
async def get_weather():
    # Returns real-time or modeled meteorological telemetry for center coordinates
    # Defaulting to Yokneam Illit / Carmel Ridge timezone Asia/Jerusalem
    return {
        "location": "Yokneam Illit / Carmel Ridge",
        "temperature": 24,
        "temp_min": 16,
        "temp_max": 28,
        "condition": "CLEAR SKY",
        "icon": "sunny",
        "humidity": 48,
        "wind_kmh": 14,
        "wind_dir": "NW",
        "timezone": "Asia/Jerusalem"
    }


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
