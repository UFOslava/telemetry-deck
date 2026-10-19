# Transit routing on TomTom geometry (one-time map matching)

## Goal

Bus route definitions and TomTom road geometry come from different providers and do not
line up. The deck should run buses on TomTom roads **without** issuing a TomTom Routing
request per bus or per trip. Routing is deterministic for a fixed route pattern, so the
expensive work is done **once**, cached, and only redone when the inputs change.

## 1. Build a routable graph from TomTom data (once)

The deck already caches TomTom vector roads (`frontend/public/data/tomtom_roads.json`).
Turn that into a directed graph:

- Node = segment endpoint, merged by proximity (about 5 m) and intersection detection.
- Edge = directed road segment with: length, road class, speed limit, one-way flag, geometry.
- Keep a spatial index (R-tree / grid) for nearest-edge lookups.
- Optional: add turn restrictions and bus-access tags from OSM where TomTom tiles lack them.

Store the graph in SQLite or a compact JSON. This is a background job, not a UI concern.

## 2. Match each bus route pattern once

Inputs: GTFS `shapes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`, or the operator API.

Two cases:

1. **Stop sequence, no usable shape** — snap each stop to the nearest edge; run Dijkstra/A*
   between consecutive stops; concatenate. Constrain by direction, road class, and no U-turns.
2. **Shape polyline** — HMM/Viterbi map matching: for each shape point, candidate edges within
   a radius; emission cost = perpendicular distance; transition cost = continuity/bearing; then
   backtrack the best edge sequence. This is robust to noisy GPS/shape points.

Post-process:

- Project every stop onto the matched polyline and store the cumulative **chainage** (metres).
- Save route variants as separate patterns (short-turn, express, direction).
- Cache as `matched_routes.json` keyed by a hash of (road graph version, route version).

Recompute weekly/monthly or when the graph/route changes. **Zero Routing API calls at runtime.**

## 3. Timetable simulation

For each trip:

```
stops: [(stop_id, arrival_s, departure_s, chainage_m), ...]
```

Between stop i and i+1:

- Scheduled travel time `T = arrival[i+1] - departure[i]`.
- Distance `D = chainage[i+1] - chainage[i]`.
- Use a wide bell speed profile, for example:
  `v(u) = v_min + (v_cruise - v_min) * sin^2(pi * u)`, `u = s / D`.
- Choose `v_cruise` from the road class/speed limit, then scale the profile so
  `integral(0..D) ds / v = T`.
- Precompute `s(t)` for the segment (e.g. 128 samples) and store a lookup table.
  Runtime interpolation is O(1).
- Add dwell time at each stop from the timetable.

This gives smooth acceleration, cruise, and braking into stations while still hitting
the scheduled arrival times.

## 4. Real-time correction

Consume GTFS-RT TripUpdate/VehiclePosition (or the operator feed):

- Estimate delay at the last observed stop: `delay = observed - scheduled`.
- Smooth it with an EMA or a small Kalman filter.
- Shift the simulation clock: `t_sim = now - delay`; clamp to a sane range
  (e.g. -60 s to +15 min).
- If delay is positive, optionally raise `v_cruise` within the speed limit to recover time;
  if early, hold at stops.
- If live GPS is fresh, snap it to the matched polyline and blend with the model
  (e.g. 80% GPS / 20% model) to avoid jitter. If GPS is stale, use the model alone.
- Recompute stop ETAs from the current `s(t)`.

## 5. Why this avoids 1000 navigation calls

- TomTom Routing is replaced by a local shortest-path/HMM pass over the cached road graph.
- The match is computed once per route pattern, not per vehicle or trip.
- TomTom traffic/flow polling stays as-is; it adjusts speeds, not the route geometry.

## 6. Integration points in this repo

- Batch matcher: `backend/app/services/route_matcher.py` (new) + `scripts/match_transit.py`.
- Cache: `backend/app/data/matched_routes.json` (or SQLite), served by the API.
- Runtime: `frontend/src/network/transit_sim.js` (new) computes `s(t)` and ETAs.
- Rendering: `frontend/src/scene/telemetry_pins.js` already draws the moving entities;
  feed it the simulated positions instead of the synthetic route seeding in `main.js`.

## 7. Gotchas

- Stop snapping can pick the wrong carriageway; constrain by direction/bearing.
- TomTom tiles may omit turn restrictions; add OSM restrictions if needed.
- Keep route variants separate; do not blend them into one polyline.
- GTFS times are stop times; dwell is included in the schedule. Do not add it twice.
