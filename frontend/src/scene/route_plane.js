import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

/**
 * Bus route + timetable inspection overlay.
 *
 * A PROJECTION LAYER above the terrain, deliberately separate from the main
 * terrain compass circle (polar_grid.js):
 *   - its own amber encompassing circle + tick ring,
 *   - a Cartesian grid clipped to that circle,
 *   - the real GTFS route shape flattened to one Y height,
 *   - real GTFS stops (not evenly-spaced decorations),
 *   - the scheduled bus position driven by the trip's simulation samples,
 *   - a DOM timetable panel listing every stop with sched/est times.
 *
 * Nothing here touches the main polar grid.
 */
export class RouteInspectionPlane {
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.route = null;
    this.routeRef = null;
    this.onSelect = options.onSelect || null;
    this.onClear = options.onClear || null;

    this.radiusKm = options.radiusKm || 10.0;
    this.overlayRadius = Math.min(8.5, Math.max(4.5, this.radiusKm * 0.7));
    this.planeHeight = 5.2;          // above the 4.4 km cylinder HUD top
    this.veilHeight = 4.85;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.staticGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.group.add(this.staticGroup, this.dynamicGroup);

    this.transform = null;
    this.stops = [];
    this.trip = null;
    this.busMarker = null;
    this.nextStopRing = null;
    this.nextStopIndex = -1;
    this._lastPanelSec = -1;

    this.buildStaticLayer();
  }

  // ---------------------------------------------------------------- static
  buildStaticLayer() {
    this.buildDimVeil();
    this.buildEncompassingCircle();
    this.buildGrid();
  }

  buildDimVeil() {
    const r = Math.max(14, this.radiusKm * 1.45);
    const geo = new THREE.CircleGeometry(r, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x01050d) },
        uOpacity: { value: 0.5 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = uOpacity * (1.0 - smoothstep(0.35, 1.0, d));
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const veil = new THREE.Mesh(geo, mat);
    veil.rotation.x = -Math.PI / 2;
    veil.position.y = this.veilHeight;
    veil.renderOrder = 1;
    this.staticGroup.add(veil);
  }

  buildEncompassingCircle() {
    const R = this.overlayRadius;
    const y = this.planeHeight;

    // Faint surface so the projection reads as a separate pane, not the map.
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshBasicMaterial({
        color: 0x001018,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = y - 0.015;
    fill.renderOrder = 10;
    this.staticGroup.add(fill);

    // Amber encompassing ring (distinct from the cyan main compass circle).
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.04, R + 0.04, 128),
      new THREE.MeshBasicMaterial({
        color: 0xff8f00,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    ring.renderOrder = 11;
    this.staticGroup.add(ring);

    // Tick band, longer every 90 degrees.
    const tickPositions = [];
    const ticks = 72;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const long = i % 18 === 0;
      const r0 = R + 0.04;
      const r1 = R + (long ? 0.34 : 0.18);
      tickPositions.push(Math.cos(a) * r0, y, Math.sin(a) * r0);
      tickPositions.push(Math.cos(a) * r1, y, Math.sin(a) * r1);
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
    const ticksMesh = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: 0xff8f00,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    ticksMesh.renderOrder = 11;
    this.staticGroup.add(ticksMesh);
  }

  buildGrid() {
    const R = this.overlayRadius;
    const y = this.planeHeight + 0.005;
    const step = R / 5;
    const positions = [];

    for (let x = -R + 0.0001; x <= R; x += step) {
      const z = Math.sqrt(Math.max(0, R * R - x * x));
      positions.push(x, y, -z, x, y, z);
    }
    for (let z = -R + 0.0001; z <= R; z += step) {
      const x = Math.sqrt(Math.max(0, R * R - z * z));
      positions.push(-x, y, z, x, y, z);
    }

    // Centre crosshair.
    positions.push(-0.35, y, 0, 0.35, y, 0);
    positions.push(0, y, -0.35, 0, y, 0.35);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    grid.renderOrder = 11;
    this.staticGroup.add(grid);
  }

  // --------------------------------------------------------------- public
  /**
   * @param {object} route  Line payload: { line, agency, city, route_name,
   *   scheduled_start, scheduled_end, delay_s, dwell_s, path_km, path,
   *   stops, samples }
   */
  selectRoute(route) {
    if (!route || !Array.isArray(route.path) || route.path.length < 2) {
      this.clear();
      return;
    }

    this.route = route;
    this.clearDynamic();
    this.buildFlattenedRoute(route);
    this.group.visible = true;
    this.renderInfoPanel(route);
    this._lastPanelSec = -1;
    this.update(0);
    if (this.onSelect) this.onSelect(route);
  }

  clear() {
    const wasSelected = !!this.route;
    this.route = null;
    this.routeRef = null;
    this.trip = null;
    this.group.visible = false;
    this.clearDynamic();
    const panel = document.getElementById('transit-route-panel');
    if (panel) panel.style.display = 'none';
    if (wasSelected && this.onClear) this.onClear();
  }

  clearDynamic() {
    while (this.dynamicGroup.children.length > 0) {
      const obj = this.dynamicGroup.children[0];
      this.dynamicGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }
    this.stops = [];
    this.busMarker = null;
    this.nextStopRing = null;
    this.nextStopIndex = -1;
  }

  // ------------------------------------------------------------- geometry
  /** Fit the route into the inspection circle and remember the transform so
   *  stops/samples can be projected into the same flattened frame. */
  fitTransform(path) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of path) {
      const [x, z] = Array.isArray(p) ? p : [p.x, p.z];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    let maxR = 0;
    for (const p of path) {
      const [x, z] = Array.isArray(p) ? p : [p.x, p.z];
      maxR = Math.max(maxR, Math.hypot(x - cx, z - cz));
    }
    const fit = (this.overlayRadius * 0.82) / Math.max(maxR, 0.0001);
    return { cx, cz, fit };
  }

  project(x, z) {
    const t = this.transform;
    return { x: (x - t.cx) * t.fit, z: (z - t.cz) * t.fit };
  }

  buildFlattenedRoute(route) {
    const y = this.planeHeight + 0.02;
    this.transform = this.fitTransform(route.path);
    const pts = route.path.map(p => this.project(p[0], p[1]));

    // Glow underlay + crisp flat ribbon.
    const glowGeo = this.buildRibbonGeometry(pts, 0.26, y + 0.001);
    if (glowGeo) {
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      glow.renderOrder = 12;
      this.dynamicGroup.add(glow);
    }

    const routeGeo = this.buildRibbonGeometry(pts, 0.10, y + 0.002);
    if (routeGeo) {
      const ribbon = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      ribbon.renderOrder = 13;
      this.dynamicGroup.add(ribbon);
    }

    // --- Real GTFS stops -------------------------------------------------
    const stops = Array.isArray(route.stops) ? route.stops : [];
    this.stops = stops.map((s, i) => {
      const p = this.project(s.xy[0], s.xy[1]);
      return { ...s, index: i, px: p.x, pz: p.z };
    });

    this.stops.forEach((s, i) => {
      const isTerminal = i === 0 || i === this.stops.length - 1;

      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(isTerminal ? 0.07 : 0.045, 14),
        new THREE.MeshBasicMaterial({
          color: isTerminal ? 0xffe600 : 0xe0f7fa,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(s.px, y + 0.006, s.pz);
      dot.renderOrder = 14;
      this.dynamicGroup.add(dot);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(isTerminal ? 0.11 : 0.075, isTerminal ? 0.16 : 0.105, 18),
        new THREE.MeshBasicMaterial({
          color: 0xffe600,
          transparent: true,
          opacity: isTerminal ? 0.95 : 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.px, y + 0.005, s.pz);
      ring.renderOrder = 14;
      this.dynamicGroup.add(ring);

      // Number every fifth stop + both terminals, so 31 stops stay legible.
      if (isTerminal || (i + 1) % 5 === 0) {
        const label = createHUDText(String(s.seq).padStart(2, '0'), {
          size: 0.15,
          color: isTerminal ? 0xffe600 : 0x70d8ff,
          opacity: 0.95,
          align: 'center'
        });
        label.rotation.x = -Math.PI / 2;
        label.position.set(s.px, y + 0.012, s.pz + 0.26);
        label.renderOrder = 15;
        this.dynamicGroup.add(label);
      }
    });

    // --- Next-stop pulse ring -------------------------------------------
    this.nextStopRing = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.23, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.nextStopRing.rotation.x = -Math.PI / 2;
    this.nextStopRing.position.y = y + 0.008;
    this.nextStopRing.renderOrder = 16;
    this.nextStopRing.visible = false;
    this.dynamicGroup.add(this.nextStopRing);

    // --- Scheduled bus marker -------------------------------------------
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.18, 0, 0,
      -0.11, 0, 0.10,
      -0.11, 0, -0.10
    ], 3));
    this.busMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    this.busMarker.position.y = y + 0.03;
    this.busMarker.renderOrder = 17;
    this.dynamicGroup.add(this.busMarker);

    // --- Trip timing ----------------------------------------------------
    this.trip = {
      startSec: this.hhmmss(route.scheduled_start),
      endSec: this.hhmmss(route.scheduled_end),
      samples: Array.isArray(route.samples) ? route.samples : []
    };

    // --- Plane title ----------------------------------------------------
    const title = createHUDText(`LINE ${route.line || '--'} // TIMETABLE`, {
      size: 0.26,
      color: 0x00e5ff,
      opacity: 0.95,
      align: 'center'
    });
    title.rotation.x = -Math.PI / 2;
    title.position.set(0, this.planeHeight + 0.02, -this.overlayRadius * 0.9);
    title.renderOrder = 15;
    this.dynamicGroup.add(title);

    const sub = createHUDText(`${this.stops.length} STOPS // ${route.path_km.toFixed(1)} KM`, {
      size: 0.14,
      color: 0x70d8ff,
      opacity: 0.85,
      align: 'center'
    });
    sub.rotation.x = -Math.PI / 2;
    sub.position.set(0, this.planeHeight + 0.02, -this.overlayRadius * 0.78);
    sub.renderOrder = 15;
    this.dynamicGroup.add(sub);
  }

  buildRibbonGeometry(points, width, y) {
    if (!points || points.length < 2) return null;
    const positions = [];
    const indices = [];
    const half = width / 2;

    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz;
      const nz = dx;
      positions.push(points[i].x + nx * half, y, points[i].z + nz * half);
      positions.push(points[i].x - nx * half, y, points[i].z - nz * half);
      if (i > 0) {
        const a = (i - 1) * 2;
        const b = a + 1;
        const c = i * 2;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }

  // ---------------------------------------------------------------- live
  hhmmss(str) {
    if (!str) return 0;
    const parts = String(str).split(':').map(Number);
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }

  /** Seconds since the trip's scheduled start for today, plus status. */
  tripClock() {
    if (!this.trip) return { elapsed: 0, status: 'NO TRIP' };
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const elapsed = nowSec - this.trip.startSec;
    const duration = this.trip.endSec - this.trip.startSec;
    if (elapsed < 0) return { elapsed: 0, untilStart: -elapsed, status: 'DEPARTS SOON', duration };
    if (elapsed > duration) return { elapsed: duration, status: 'TRIP COMPLETE', duration };
    return { elapsed, status: 'IN TRANSIT', duration };
  }

  sampleAt(elapsed) {
    const samples = this.trip?.samples || [];
    if (!samples.length) return null;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].t <= elapsed) lo = mid;
      else hi = mid - 1;
    }
    const a = samples[lo];
    const b = samples[Math.min(lo + 1, samples.length - 1)];
    const span = (b.t - a.t) || 1;
    const f = Math.max(0, Math.min(1, (elapsed - a.t) / span));
    return {
      xy: [a.xy[0] + (b.xy[0] - a.xy[0]) * f, a.xy[1] + (b.xy[1] - a.xy[1]) * f],
      heading: Math.atan2(-(b.xy[1] - a.xy[1]), b.xy[0] - a.xy[0]),
      index: lo
    };
  }

  update(deltaTime) {
    if (!this.route || !this.busMarker || !this.trip) return;
    const clock = this.tripClock();
    const s = this.sampleAt(clock.elapsed);

    if (s) {
      const p = this.project(s.xy[0], s.xy[1]);
      this.busMarker.position.set(p.x, this.planeHeight + 0.03, p.z);
      this.busMarker.rotation.y = s.heading;
    }

    const nowSec = this.trip.startSec + clock.elapsed;
    let nextIdx = this.stops.findIndex(st => this.hhmmss(st.est_arrival) >= nowSec);
    if (nextIdx < 0) nextIdx = this.stops.length - 1;

    if (nextIdx !== this.nextStopIndex && this.nextStopRing) {
      const st = this.stops[nextIdx];
      this.nextStopIndex = nextIdx;
      this.nextStopRing.position.set(st.px, this.planeHeight + 0.028, st.pz);
      this.nextStopRing.visible = true;
    }

    // Update the panel chrome at most once per second.
    const sec = Math.floor(clock.elapsed);
    if (sec !== this._lastPanelSec) {
      this._lastPanelSec = sec;
      this.updatePanel(clock, nextIdx);
    }
  }

  // ---------------------------------------------------------------- panel
  renderInfoPanel(route) {
    let panel = document.getElementById('transit-route-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'transit-route-panel';
      document.body.appendChild(panel);
    }

    const rows = this.stops.map((s, i) => `
      <div class="tt-row" id="tt-row-${i}">
        <span class="tt-c1">${String(s.seq).padStart(2, '0')}</span>
        <span class="tt-c2" dir="auto" title="${s.name}">${s.name}</span>
        <span class="tt-c3">${s.arrival}</span>
        <span class="tt-c4">${s.est_arrival}</span>
        <span class="tt-c5">${Number(s.chain_km ?? 0).toFixed(1)}</span>
      </div>
    `).join('');

    panel.style.display = 'flex';
    panel.innerHTML = `
      <div class="tt-head">
        <span class="tt-title">LINE ${route.line || '--'} // TIMETABLE</span>
        <span id="close-route-panel" class="tt-close">&times;</span>
      </div>
      <div class="tt-agency" dir="auto">${route.agency || ''} ${route.city ? '· ' + route.city : ''}</div>
      <div class="tt-desc" dir="auto">${route.route_name || ''}</div>
      <div class="tt-meta">
        <span id="tt-status">--</span>
        <span>${route.scheduled_start}–${route.scheduled_end}</span>
        <span>${route.delay_s ? '+' + route.delay_s + 's' : 'SCHEDULED'}</span>
      </div>
      <div class="tt-progress"><i id="tt-progress-bar"></i></div>
      <div class="tt-cols">
        <span class="tt-c1">#</span><span class="tt-c2">STOP</span>
        <span class="tt-c3">SCHED</span><span class="tt-c4">EST</span>
        <span class="tt-c5">KM</span>
      </div>
      <div class="tt-body">${rows}</div>
    `;

    document.getElementById('close-route-panel').addEventListener('click', () => {
      this.clear();
    });
  }

  updatePanel(clock, nextIdx) {
    const status = document.getElementById('tt-status');
    if (status) {
      let label = clock.status;
      if (clock.status === 'DEPARTS SOON') {
        const m = Math.floor((clock.untilStart || 0) / 60);
        const s = Math.floor((clock.untilStart || 0) % 60);
        label = `DEPARTS IN ${m}:${String(s).padStart(2, '0')}`;
      }
      status.textContent = label;
    }

    const bar = document.getElementById('tt-progress-bar');
    if (bar && clock.duration) {
      bar.style.width = `${Math.min(100, Math.max(0, (clock.elapsed / clock.duration) * 100)).toFixed(1)}%`;
    }

    const prev = document.querySelector('.tt-row.tt-next');
    if (prev) prev.classList.remove('tt-next');
    if (nextIdx >= 0) {
      const row = document.getElementById(`tt-row-${nextIdx}`);
      if (row) {
        row.classList.add('tt-next');
        // Keep the active stop visible inside the scroll box.
        const body = row.parentElement;
        if (body && body.scrollHeight > body.clientHeight) {
          const top = row.offsetTop - body.offsetTop;
          if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - 40) {
            body.scrollTop = Math.max(0, top - 80);
          }
        }
      }
    }
  }
}
