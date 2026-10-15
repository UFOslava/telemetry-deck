import os
import json
import httpx

def fetch_yokneam_railways():
    query = """[out:json][timeout:25];
(
  way["railway"~"rail|light_rail|subway"](32.55,34.98,32.77,35.24);
);
out geom;
"""
    print("Fetching railway tracks from Overpass API...")
    headers = {"User-Agent": "TacticalTelemetryDeck/1.0 (telemetry.deck.local)"}
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter"
    ]
    data = None
    with httpx.Client(timeout=40.0, headers=headers) as client:
        for ep in endpoints:
            try:
                print(f"Trying Overpass endpoint: {ep}")
                resp = client.post(ep, data={"data": query})
                if resp.status_code == 200:
                    data = resp.json()
                    break
                else:
                    print(f"Endpoint {ep} returned status {resp.status_code}")
            except Exception as e:
                print(f"Endpoint {ep} failed: {e}")
        
        if not data:
            raise RuntimeError("All Overpass endpoints failed or timed out.")
        elements = data.get("elements", [])
        print(f"Successfully retrieved {len(elements)} railway segments!")
        
        target_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "data")
        os.makedirs(target_dir, exist_ok=True)
        target_file = os.path.join(target_dir, "yokneam_railways.json")
        with open(target_file, "w") as f:
            json.dump(data, f)
        print(f"Saved railways to {target_file}")
        return data

if __name__ == "__main__":
    fetch_yokneam_railways()
