import time
import httpx
from app.config import settings

cached_traffic = {
    "last_updated": 0,
    "source": "simulated",
    "corridors": [
        {
            "name": "Route 70 - Yokneam Main Junction",
            "severity": "severe",
            "color": "#ff2244",
            "currentSpeedKmh": 22,
            "freeFlowSpeedKmh": 70,
            "delayMinutes": 11
        },
        {
            "name": "Highway 6 - Ein Tut Interchange",
            "severity": "moderate",
            "color": "#ff8f00",
            "currentSpeedKmh": 52,
            "freeFlowSpeedKmh": 110,
            "delayMinutes": 5
        },
        {
            "name": "Route 66 - Yokneam East",
            "severity": "free_flow",
            "color": "#ffe600",
            "currentSpeedKmh": 78,
            "freeFlowSpeedKmh": 80,
            "delayMinutes": 0
        }
    ]
}

async def fetch_tomtom_traffic():
    global cached_traffic
    now = time.time()
    
    # Strictly respect user requirement: not required over 1/5min (300s)
    if now - cached_traffic["last_updated"] < settings.TRAFFIC_POLL_INTERVAL and cached_traffic["last_updated"] > 0:
        return cached_traffic

    api_key = settings.get_tomtom_key()
    if not api_key:
        return cached_traffic

    try:
        # Query TomTom incident details for Yokneam bounding box
        bbox = f"{settings.CENTER_LON - 0.12:.4f},{settings.CENTER_LAT - 0.10:.4f},{settings.CENTER_LON + 0.12:.4f},{settings.CENTER_LAT + 0.10:.4f}"
        url = f"https://api.tomtom.com/traffic/services/5/incidentDetails?key={api_key}&bbox={bbox}&fields={{incidents{{type,geometry{{type,coordinates}},properties{{iconCategory,magnitudeOfDelay,events{{description}}}}}}}}"

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                incidents = data.get("incidents", [])
                
                cached_traffic["last_updated"] = now
                cached_traffic["source"] = "tomtom_live"
                cached_traffic["incidents_count"] = len(incidents)
                cached_traffic["raw_incidents"] = incidents
                print(f"[TomTom Traffic] Successfully refreshed traffic data: {len(incidents)} incidents in Yokneam sector")
            else:
                print(f"[TomTom Traffic] HTTP {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"[TomTom Traffic] Error fetching traffic: {e}")

    return cached_traffic
