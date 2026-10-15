import os
import math
import json
import httpx
import mapbox_vector_tile
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env"))
load_dotenv()

def tile_px_to_latlon(px, py, xtile, ytile, zoom, extent=4096):
    lon = (xtile + px / float(extent)) / (2.0 ** zoom) * 360.0 - 180.0
    y_norm = (ytile + py / float(extent)) / (2.0 ** zoom)
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_norm)))
    return math.degrees(lat_rad), lon

ROAD_LAYERS = [
    'Motorway',
    'Toll motorway',
    'Toll motorway tunnel',
    'Major road',
    'Major road tunnel',
    'Toll international road',
    'International road',
    'Secondary road',
    'Connecting road',
    'Major local road',
    'Minor local road',
    'Local road'
]

def fetch_tomtom_roads():
    key = os.getenv('TomTom_API_Key') or os.getenv('TOMTOM_API_KEY')
    if not key:
        raise RuntimeError("TomTom API key not found in .env")

    # Zoom 12 provides exact geometric alignment to topography
    # 3x3 grid around Yokneam center (32.6595, 35.1090)
    zoom = 12
    tiles = [
        (2446, 1653), (2446, 1654), (2446, 1655),
        (2447, 1653), (2447, 1654), (2447, 1655),
        (2448, 1653), (2448, 1654), (2448, 1655)
    ]

    c_lat, c_lon = 32.6595, 35.1090
    max_radius_km = 11.2

    all_features = []
    print(f"Fetching zoom {zoom} vector tiles from TomTom Maps API with y_coord_down=True...")

    with httpx.Client(timeout=15.0) as client:
        for xtile, ytile in tiles:
            url = f"https://api.tomtom.com/map/1/tile/basic/main/{zoom}/{xtile}/{ytile}.pbf?key={key}"
            resp = client.get(url)
            if resp.status_code != 200:
                print(f"Warning: Failed to fetch TomTom tile ({xtile}, {ytile}): HTTP {resp.status_code}")
                continue

            # Critical: y_coord_down=True prevents vertical flip in mapbox-vector-tile
            tile_data = mapbox_vector_tile.decode(resp.content, default_options={'y_coord_down': True})

            for layer_name in ROAD_LAYERS:
                if layer_name not in tile_data:
                    continue

                layer = tile_data[layer_name]
                extent = layer.get('extent', 4096)
                is_tunnel = 'tunnel' in layer_name.lower()

                for feat in layer.get('features', []):
                    geom = feat.get('geometry', {})
                    g_type = geom.get('type')
                    coords = geom.get('coordinates', [])

                    lines = []
                    if g_type == 'LineString':
                        lines = [coords]
                    elif g_type == 'MultiLineString':
                        lines = coords

                    for line in lines:
                        if len(line) < 2:
                            continue
                        latlon_line = []
                        in_scope = False

                        for pt in line:
                            lat, lon = tile_px_to_latlon(pt[0], pt[1], xtile, ytile, zoom, extent)
                            latlon_line.append({"lat": lat, "lon": lon})
                            
                            # Check radius to Yokneam
                            d_km = math.hypot((lat - c_lat) * 111.0, (lon - c_lon) * 111.0 * math.cos(math.radians(c_lat)))
                            if d_km <= max_radius_km:
                                in_scope = True

                        if in_scope and len(latlon_line) >= 2:
                            all_features.append({
                                "type": "way",
                                "layer": layer_name,
                                "tags": {
                                    "highway": "motorway" if "motorway" in layer_name.lower() else ("primary" if "major" in layer_name.lower() else ("secondary" if "secondary" in layer_name.lower() else "tertiary")),
                                    "tunnel": "yes" if is_tunnel else "no",
                                    "name": feat.get('properties', {}).get('name', layer_name),
                                    "ref": feat.get('properties', {}).get('icon_text', '')
                                },
                                "geometry": latlon_line
                            })

    print(f"Extracted {len(all_features)} road & tunnel line segments aligned to Yokneam topography!")
    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "data")
    os.makedirs(output_dir, exist_ok=True)
    out_file = os.path.join(output_dir, "tomtom_roads.json")
    
    with open(out_file, "w") as f:
        json.dump({"elements": all_features, "source": "tomtom_basic_vector_z12"}, f)
    print(f"Saved TomTom roads to {out_file}")
    return all_features

if __name__ == "__main__":
    fetch_tomtom_roads()
