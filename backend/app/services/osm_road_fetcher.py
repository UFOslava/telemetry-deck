import os
import json
import httpx

def fetch_yokneam_roads():
    query = """[out:json][timeout:25];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary"](32.55,34.98,32.77,35.24);
);
out geom;
"""
    print("Fetching major roads from Overpass API...")
    headers = {"User-Agent": "TacticalTelemetryDeck/1.0 (telemetry.deck.local)"}
    with httpx.Client(timeout=35.0, headers=headers) as client:
        resp = client.post("https://overpass-api.de/api/interpreter", data={"data": query})
        if resp.status_code != 200:
            raise RuntimeError(f"Overpass failed with HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        elements = data.get("elements", [])
        print(f"Successfully retrieved {len(elements)} road segments!")
        
        target_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "data")
        os.makedirs(target_dir, exist_ok=True)
        target_file = os.path.join(target_dir, "yokneam_roads.json")
        with open(target_file, "w") as f:
            json.dump(data, f)
        print(f"Saved road network to {target_file}")
        return data

if __name__ == "__main__":
    fetch_yokneam_roads()
