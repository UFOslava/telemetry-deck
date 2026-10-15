import httpx
import json

def find_station():
    query = """[out:json][timeout:25];
(
  node["railway"="station"](32.55,34.98,32.77,35.24);
  way["railway"="station"](32.55,34.98,32.77,35.24);
  node["railway"="stop"](32.55,34.98,32.77,35.24);
);
out center;
"""
    headers = {'User-Agent': 'TacticalTelemetryDeck/1.0'}
    resp = httpx.post('https://overpass-api.de/api/interpreter', data={'data': query}, headers=headers)
    if resp.status_code == 200:
        for el in resp.json().get('elements', []):
            tags = el.get('tags', {})
            lat = el.get('lat') or el.get('center', {}).get('lat')
            lon = el.get('lon') or el.get('center', {}).get('lon')
            print(f"ID: {el.get('id')} Name: {tags.get('name')} | Name:en: {tags.get('name:en')} -> Lat: {lat}, Lon: {lon}")
    else:
        print(f"Error {resp.status_code}")

if __name__ == '__main__':
    find_station()
