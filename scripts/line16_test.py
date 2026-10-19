#!/usr/bin/env python3
"""Line 16 pipeline test: TomTom path reconstruction, timetable simulation, delay adjustment.

Data source: Open Bus Stride (GTFS ride 158340114, Yokneam Illit line 16).
Road source: frontend/public/data/tomtom_roads.json (TomTom vector tiles).
"""
import json, math, heapq, datetime as dt
import urllib.request, urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
RIDE_ID = 158340114
RIDE_STOPS = Path('/tmp/l16-stops.json')
ROADS = ROOT / 'frontend/public/data/tomtom_roads.json'
OUT_HTML = ROOT / 'frontend/public/debug/line16.html'
OUT_JSON = ROOT / 'frontend/public/data/line16_test.json'
MERGE_M = 60.0
DELAY_S = 90

def hav(a, b):
    la = math.radians((a[0] + b[0]) / 2)
    return math.hypot((a[0] - b[0]) * 111000.0, (a[1] - b[1]) * 111000.0 * math.cos(la))

def build_graph(roads, connect_m=35.0):
    """Preserve every TomTom vertex and link nearby vertices across segments."""
    nodes, adj = [], []
    for e in roads:
        geom = e.get('geometry', [])
        ids = []
        for pt in geom:
            ids.append(len(nodes))
            nodes.append((pt['lat'], pt['lon']))
            adj.append([])
        for a, b in zip(ids, ids[1:]):
            w = hav(nodes[a], nodes[b])
            if w > 0.01:
                adj[a].append((b, w)); adj[b].append((a, w))

    cell = connect_m / 111000.0 * 1.2
    grid = {}
    for i, p in enumerate(nodes):
        grid.setdefault((int(p[1] / cell), int(p[0] / cell)), []).append(i)

    for i, p in enumerate(nodes):
        cx, cy = int(p[1] / cell), int(p[0] / cell)
        neighbors = {v for v, _ in adj[i]}
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cx + dx, cy + dy), []):
                    if j <= i or j in neighbors: continue
                    d = hav(p, nodes[j])
                    if d <= connect_m:
                        adj[i].append((j, d)); adj[j].append((i, d))
    return nodes, adj

def dijkstra(nodes, adj, start, goal):
    if start == goal:
        return [start]
    dist = {start: 0.0}; prev = {}; pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal: break
        if d > dist.get(u, 1e30): continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e30):
                dist[v] = nd; prev[v] = u
                heapq.heappush(pq, (nd, v))
    if goal not in dist: return None
    path = [goal]
    while path[-1] != start: path.append(prev[path[-1]])
    return path[::-1]

def interpolate(path, chain, s):
    lo, hi = 0, len(chain) - 1
    if s <= 0: return path[0]
    if s >= chain[-1]: return path[-1]
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if chain[mid] <= s: lo = mid
        else: hi = mid
    seg = chain[hi] - chain[lo]
    u = 0 if seg <= 0 else (s - chain[lo]) / seg
    a, b = path[lo], path[hi]
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)

def load_stops():
    if RIDE_STOPS.exists():
        d = json.loads(RIDE_STOPS.read_text())
    else:
        q = urllib.parse.urlencode({
            'gtfs_ride_ids': str(RIDE_ID),
            'arrival_time_from': '2026-10-01T00:00:00+00:00',
            'arrival_time_to': '2026-10-02T00:00:00+00:00',
            'limit': '100',
        })
        with urllib.request.urlopen('https://open-bus-stride-api.hasadna.org.il/gtfs_ride_stops/list?' + q, timeout=40) as r:
            d = json.load(r)
        RIDE_STOPS.write_text(json.dumps(d, ensure_ascii=False))
    stops = d['ride_stops']
    stops.sort(key=lambda x: x['stop_sequence'])
    return stops

def estimate_times(stops, chain, raw):
    """GTFS stop_times are minute-resolution; distribute seconds inside each minute window."""
    groups = []
    for i, t in enumerate(raw):
        minute = int(t // 60) * 60
        if groups and groups[-1][0] == minute:
            groups[-1][1].append(i)
        else:
            groups.append((minute, [i]))
    est = [0.0] * len(stops)
    prev = -1e18
    for minute, idxs in groups:
        if len(idxs) == 1:
            vals = [minute + 30.0]
        else:
            s0, s1 = chain[idxs[0]], chain[idxs[-1]]
            span = max(s1 - s0, 0.001)
            vals = [minute + 4.0 + (chain[i] - s0) / span * 52.0 for i in idxs]
        for i, v in zip(idxs, vals):
            v = max(v, prev + 2.0)
            if v > minute + 59.0 and prev + 2.0 <= minute + 59.0:
                v = minute + 59.0
            est[i] = v
            prev = v
    return est

def main():
    stops = load_stops()
    roads = json.loads(ROADS.read_text())['elements']
    shape_file = ROOT / 'frontend/public/data/line16_shape.json'
    if not shape_file.exists():
        shape_file = Path('/tmp/line16_shape.json')
    if shape_file.exists():
        pts = json.loads(shape_file.read_text())
        path = [(p[0], p[1]) for p in pts]
        print(f'using GTFS shape: {len(path)} points')
    else:
        nodes, adj = build_graph(roads, MERGE_M)
        print(f'graph: {len(nodes)} nodes, {sum(len(x) for x in adj)//2} edges')
        def nearest(p):
            return min(range(len(nodes)), key=lambda i: hav(nodes[i], p))
        stop_idx = [nearest((s['gtfs_stop__lat'], s['gtfs_stop__lon'])) for s in stops]
        path_ids = [stop_idx[0]]
        for a, b in zip(stop_idx, stop_idx[1:]):
            leg = dijkstra(nodes, adj, a, b)
            if leg is None:
                leg = [a, b]
            path_ids.extend(leg)
        path = [nodes[i] for i in path_ids]

    chain = [0.0]
    for a, b in zip(path, path[1:]):
        chain.append(chain[-1] + hav(a, b))
    total_m = chain[-1]

    # Project stops onto the route sequentially (monotonic chainage).
    def project(p, start_j):
        best_d, best_s, best_j = 1e30, chain[start_j], start_j
        lat = p[0]
        for j in range(start_j, len(path) - 1):
            a, b = path[j], path[j+1]
            ax = (a[1] - p[1]) * 111000.0 * math.cos(math.radians(lat))
            ay = (a[0] - p[0]) * 111000.0
            bx = (b[1] - p[1]) * 111000.0 * math.cos(math.radians(lat))
            by = (b[0] - p[0]) * 111000.0
            dx, dy = bx - ax, by - ay
            den = dx * dx + dy * dy
            t = 0.0 if den <= 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / den))
            cx, cy = ax + t * dx, ay + t * dy
            d = math.hypot(cx, cy)
            if d < best_d:
                best_d = d
                best_s = chain[j] + t * (chain[j + 1] - chain[j])
                best_j = j
        return best_d, best_s, best_j

    stop_chain = []
    j = 0
    for s in stops:
        d, cs, j = project((s['gtfs_stop__lat'], s['gtfs_stop__lon']), j)
        stop_chain.append(cs)
        if d > 600:
            print(f'WARN stop {s["stop_sequence"]} is {d:.0f} m from route')
    for i in range(1, len(stop_chain)):
        if stop_chain[i] < stop_chain[i-1]:
            stop_chain[i] = stop_chain[i-1]

    raw_times = [dt.datetime.fromisoformat(s['arrival_time']).timestamp() for s in stops]
    times = estimate_times(stops, stop_chain, raw_times)
    t0 = times[0]

    # normalized bell velocity shape and its inverse time map
    N = 400
    us = [i / (N - 1) for i in range(N)]
    w = [0.5 + 0.5 * math.sin(math.pi * u) ** 2 for u in us]
    cum = [0.0]
    for i in range(1, N):
        cum.append(cum[-1] + (us[i] - us[i-1]) * 2 / (w[i] + w[i-1]))
    ctot = cum[-1]
    cum = [c / ctot for c in cum]
    def u_at(frac):
        if frac <= 0: return 0.0
        if frac >= 1: return 1.0
        lo, hi = 0, N - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if cum[mid] <= frac: lo = mid
            else: hi = mid
        span = cum[hi] - cum[lo]
        f = 0 if span <= 0 else (frac - cum[lo]) / span
        return us[lo] + (us[hi] - us[lo]) * f

    # DEM height: GTFS shapes carry no elevation, so sample the deck's terrain.
    DEM = json.loads((ROOT / 'frontend/public/data/yokneam_elevation_512.json').read_text())
    db = DEM['bounds']; de = DEM['elevations']; dh = len(de); dw = len(de[0])
    def elev_km(lat, lon):
        py = int((db['lat_max'] - lat) / (db['lat_max'] - db['lat_min']) * dh)
        px = int((lon - db['lon_min']) / (db['lon_max'] - db['lon_min']) * dw)
        py = max(0, min(dh - 1, py)); px = max(0, min(dw - 1, px))
        return de[py][px] / 1000.0 * 3.0

    samples = []
    sim_arr = [times[0]]
    sim_dep = []
    DWELL_S = 10
    MIN_KMH = 50.0
    for i in range(len(stops)):
        arr = sim_arr[i]
        lat_i, lon_i = interpolate(path, chain, stop_chain[i])
        for k in range(0 if i == 0 else 2, DWELL_S + 1, 2):
            samples.append({'t': round(arr + k - t0, 1), 's': round(stop_chain[i], 1), 'lat': lat_i, 'lon': lon_i})
        sim_dep.append(arr + DWELL_S)
        if i == len(stops) - 1:
            break
        D = stop_chain[i+1] - stop_chain[i]
        T = times[i+1] - times[i] - DWELL_S
        T_eff = max(T, D / (MIN_KMH / 3.6)) if D > 0 else max(0.0, T)
        if D <= 0.1 or T_eff <= 0:
            sim_arr.append(sim_dep[i] + max(0.0, T_eff))
            continue
        steps = max(1, int(T_eff / 2))
        for k in range(1, steps + 1):
            frac = k / steps
            t = sim_dep[i] + frac * T_eff
            s = stop_chain[i] + u_at(frac) * D
            lat, lon = interpolate(path, chain, s)
            samples.append({'t': round(t - t0, 1), 's': round(s, 1), 'lat': lat, 'lon': lon})
        sim_arr.append(sim_dep[i] + T_eff)
    # speed from finite differences
    for i, smp in enumerate(samples):
        if i == 0: smp['v'] = 0.0
        else:
            dts = smp['t'] - samples[i-1]['t']
            ds = smp['s'] - samples[i-1]['s']
            smp['v'] = round((ds / dts) * 3.6, 1) if dts > 0 else 0.0

    # project to a local km frame for drawing
    lats = [p[0] for p in path]; lons = [p[1] for p in path]
    lat0 = (min(lats) + max(lats)) / 2; lon0 = (min(lons) + max(lons)) / 2
    def xy(p):
        return ((p[1] - lon0) * 111.0 * math.cos(math.radians(lat0)), (p[0] - lat0) * 111.0)

    data = {
        'ride_id': RIDE_ID, 'line': '16', 'agency': 'סופרבוס', 'city': 'יקנעם עילית',
        'route_name': "מסוף קניון ג'י/רציפים <-> קריית החינוך",
        'scheduled_start': dt.datetime.fromisoformat(stops[0]['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
        'scheduled_end': dt.datetime.fromisoformat(stops[-1]['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
        'delay_s': DELAY_S, 'dwell_s': DWELL_S, 'path_km': round(total_m / 1000, 2),
        'path_y': [round(elev_km(a, b), 3) for a, b in path],
        'stops': [{
            'seq': s['stop_sequence'], 'name': s['gtfs_stop__name'], 'code': s['gtfs_stop__code'],
            'lat': s['gtfs_stop__lat'], 'lon': s['gtfs_stop__lon'],
            'arrival': dt.datetime.fromisoformat(s['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'est_arrival': dt.datetime.fromtimestamp(times[i], ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'sim_arrival': dt.datetime.fromtimestamp(sim_arr[i], ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'sim_depart': dt.datetime.fromtimestamp(sim_dep[i], ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'y': round(elev_km(s['gtfs_stop__lat'], s['gtfs_stop__lon']) + 0.04, 3),
            'elev_m': round(elev_km(s['gtfs_stop__lat'], s['gtfs_stop__lon']) / 3.0 * 1000.0, 1),
            'chain_km': round(stop_chain[i] / 1000, 3),
            'xy': xy((s['gtfs_stop__lat'], s['gtfs_stop__lon']))
        } for i, s in enumerate(stops)],
        'path': [list(xy(p)) for p in path],
        'samples': [dict(s, xy=xy((s['lat'], s['lon'])),
                         ground_y=round(elev_km(s['lat'], s['lon']), 3),
                         y=round(elev_km(s['lat'], s['lon']) + 0.04, 3)) for s in samples],
        'roads': []
    }
    # draw only roads near the route
    pad = 0.012
    minlat, maxlat = min(lats) - pad, max(lats) + pad
    minlon, maxlon = min(lons) - pad, max(lons) + pad
    for e in roads:
        seg = []
        for pt in e.get('geometry', []):
            if minlat <= pt['lat'] <= maxlat and minlon <= pt['lon'] <= maxlon:
                seg.append(list(xy((pt['lat'], pt['lon']))))
        if len(seg) >= 2:
            data['roads'].append(seg)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False))
    print(f'path {data["path_km"]} km, {len(samples)} samples, {len(data["roads"])} road segments')
    if samples:
        print(f'speed min/avg/max {min(s["v"] for s in samples)}/{sum(s["v"] for s in samples)/len(samples):.1f}/{max(s["v"] for s in samples)} km/h')
    print('wrote', OUT_JSON)

if __name__ == '__main__':
    main()
