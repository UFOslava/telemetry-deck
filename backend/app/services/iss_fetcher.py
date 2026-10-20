import os
import json
import time
import httpx
from typing import Dict, Any

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
CACHE_FILE = os.path.join(CACHE_DIR, "iss_tle_cache.json")
CACHE_DURATION_SEC = 24 * 3600  # 24 hours

FALLBACK_TLE = {
    "name": "ISS (ZARYA)",
    "norad": "25544",
    "line1": "1 25544U 98067A   26292.75756895  .00007600  00000+0  14619-3 0  9999",
    "line2": "2 25544  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067",
    "source": "fallback",
    "last_updated": 0
}

_memory_cache: Dict[str, Any] = {}

def load_cached_tle() -> Dict[str, Any]:
    global _memory_cache
    if _memory_cache:
        return _memory_cache

    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("line1") and data.get("line2"):
                    _memory_cache = data
                    return data
        except Exception:
            pass

    _memory_cache = dict(FALLBACK_TLE)
    return _memory_cache

def save_cached_tle(data: Dict[str, Any]) -> None:
    global _memory_cache
    _memory_cache = data
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

async def get_iss_tle() -> Dict[str, Any]:
    cached = load_cached_tle()
    now = time.time()

    # If cache is still fresh, return it
    if cached.get("last_updated", 0) > 0 and (now - cached["last_updated"]) < CACHE_DURATION_SEC:
        return cached

    # Try fetching fresh TLE from Celestrak
    url = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                raw_lines = [l.strip() for l in resp.text.strip().split("\n") if l.strip()]
                if len(raw_lines) >= 3:
                    name = raw_lines[0]
                    line1 = raw_lines[1]
                    line2 = raw_lines[2]
                elif len(raw_lines) == 2:
                    name = "ISS (ZARYA)"
                    line1 = raw_lines[0]
                    line2 = raw_lines[1]
                else:
                    return cached

                fresh_data = {
                    "name": name,
                    "norad": "25544",
                    "line1": line1,
                    "line2": line2,
                    "source": "celestrak_live",
                    "last_updated": now
                }
                save_cached_tle(fresh_data)
                return fresh_data
    except Exception:
        pass

    return cached
