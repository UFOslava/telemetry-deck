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

def main():
    stops = load_stops()
    roads = json.loads(ROADS.read_text())['elements']
    nodes, adj = build_graph(roads, MERGE_M)
    print(f'graph: {len(nodes)} nodes, {sum(len(x) for x in adj)//2} edges')

    def nearest(p):
        return min(range(len(nodes)), key=lambda i: hav(nodes[i], p))
    stop_idx = [nearest((s['gtfs_stop__lat'], s['gtfs_stop__lon'])) for s in stops]

    path_ids = [stop_idx[0]]
    for a, b in zip(stop_idx, stop_idx[1:]):
        leg = dijkstra(nodes, adj, a, b)
        if leg is None:
            print('WARN unreachable leg, straight fallback')
            leg = [a, b]
        if path_ids and path_ids[-1] == leg[0]:
            path_ids.extend(leg[1:])
        else:
            path_ids.extend(leg)

    path = [nodes[i] for i in path_ids]
    chain = [0.0]
    for a, b in zip(path, path[1:]):
        chain.append(chain[-1] + hav(a, b))
    total_m = chain[-1]

    # stop chainages: snap each stop to the nearest path vertex
    stop_chain = []
    for s in stops:
        p = (s['gtfs_stop__lat'], s['gtfs_stop__lon'])
        j = min(range(len(path)), key=lambda i: hav(path[i], p))
        stop_chain.append(chain[j])
    # enforce monotonic chainage
    for i in range(1, len(stop_chain)):
        if stop_chain[i] < stop_chain[i-1]:
            stop_chain[i] = stop_chain[i-1]

    t0 = dt.datetime.fromisoformat(stops[0]['arrival_time']).timestamp()
    times = [dt.datetime.fromisoformat(s['arrival_time']).timestamp() for s in stops]

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

    samples = []
    sim_times = [times[0]]
    t_cursor = times[0]
    MIN_KMH = 50.0
    for i in range(len(stops) - 1):
        D = stop_chain[i+1] - stop_chain[i]
        T = times[i+1] - times[i]
        # GTFS has a 6s gap on one leg; cap the implied speed at 50 km/h.
        T_eff = max(T, D / (MIN_KMH / 3.6)) if D > 0 else T
        sim_times.append(t_cursor + T_eff)
        if D <= 0.1 or T_eff <= 0:
            t_cursor += T_eff
            continue
        steps = max(1, int(T_eff / 2))
        for k in range(steps + 1):
            frac = k / steps
            t = t_cursor + frac * T_eff
            s = stop_chain[i] + u_at(frac) * D
            lat, lon = interpolate(path, chain, s)
            samples.append({'t': round(t - t0, 1), 's': round(s, 1), 'lat': lat, 'lon': lon})
        t_cursor += T_eff
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
        return ((p[1] - lon0) * 111.0 * math.cos(math.radians(lat0)), -(p[0] - lat0) * 111.0)

    data = {
        'ride_id': RIDE_ID, 'line': '16', 'agency': 'סופרבוס', 'city': 'יקנעם עילית',
        'route_name': "מסוף קניון ג'י/רציפים <-> קריית החינוך",
        'scheduled_start': dt.datetime.fromisoformat(stops[0]['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
        'scheduled_end': dt.datetime.fromisoformat(stops[-1]['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
        'delay_s': DELAY_S, 'path_km': round(total_m / 1000, 2),
        'stops': [{
            'seq': s['stop_sequence'], 'name': s['gtfs_stop__name'], 'code': s['gtfs_stop__code'],
            'lat': s['gtfs_stop__lat'], 'lon': s['gtfs_stop__lon'],
            'arrival': dt.datetime.fromisoformat(s['arrival_time']).astimezone(ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'sim_arrival': dt.datetime.fromtimestamp(sim_times[i], ZoneInfo('Asia/Jerusalem')).strftime('%H:%M:%S'),
            'chain_km': round(stop_chain[i] / 1000, 3),
            'xy': xy((s['gtfs_stop__lat'], s['gtfs_stop__lon']))
        } for i, s in enumerate(stops)],
        'path': [list(xy(p)) for p in path],
        'samples': [dict(s, xy=xy((s['lat'], s['lon']))) for s in samples],
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
