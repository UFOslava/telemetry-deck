import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

/**
 * Bus route inspection overlay.
 *
 * This is a PROJECTION LAYER above the terrain, deliberately separate from the
 * main terrain compass circle (polar_grid.js):
 *   - its own amber encompassing circle + tick ring,
 *   - a Cartesian grid clipped to that circle,
 *   - a flattened, centred route ribbon with stations, all at one Y height,
 *   - a radial dim veil that darkens the map/elements underneath.
 *
 * Nothing here touches the main polar grid.
 */
export class RouteInspectionPlane {
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.selectedBus = null;
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

    this.stops = [];
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
    const fillGeo = new THREE.CircleGeometry(R, 96);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x001018,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = y - 0.015;
    fill.renderOrder = 10;
    this.staticGroup.add(fill);

    // Amber encompassing ring (distinct from the cyan main compass circle).
    const ringGeo = new THREE.RingGeometry(R - 0.04, R + 0.04, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8f00,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
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
    const tickMat = new THREE.LineBasicMaterial({
      color: 0xff8f00,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const tickMesh = new THREE.LineSegments(tickGeo, tickMat);
    tickMesh.renderOrder = 11;
    this.staticGroup.add(tickMesh);
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
    const mat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const grid = new THREE.LineSegments(geo, mat);
    grid.renderOrder = 11;
    this.staticGroup.add(grid);
  }

  // --------------------------------------------------------------- public
  selectBus(bus) {
    if (!bus || !Array.isArray(bus.roadPath) || bus.roadPath.length < 2) {
      this.clear();
      return;
    }

    this.selectedBus = bus;
    this.clearDynamic();
    this.buildFlattenedRoute(bus);
    this.group.visible = true;
    this.renderInfoPanel(bus);
    if (this.onSelect) this.onSelect(bus);
  }

  clear() {
    const wasSelected = !!this.selectedBus;
    this.selectedBus = null;
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
  }

  // ------------------------------------------------------------- geometry
  fitRoute(path) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const centred = path.map(p => ({ x: p.x - cx, z: p.z - cz }));
    let maxR = 0;
    for (const p of centred) {
      const r = Math.hypot(p.x, p.z);
      if (r > maxR) maxR = r;
    }
    // Fill the inspection circle instead of leaving the route floating in it.
    const fit = (this.overlayRadius * 0.82) / Math.max(maxR, 0.0001);
    return centred.map(p => ({ x: p.x * fit, z: p.z * fit }));
  }

  buildFlattenedRoute(bus) {
    const y = this.planeHeight + 0.02;
    const pts = this.fitRoute(bus.roadPath);

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
      const route = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      route.renderOrder = 13;
      this.dynamicGroup.add(route);
    }

    // Stations: evenly spaced by arc length, flat on the same plane.
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    const total = cumulative[cumulative.length - 1] || 1;
    const stopCount = 6;

    for (let s = 0; s < stopCount; s++) {
      const target = (s / (stopCount - 1)) * total;
      let i = 1;
      while (i < cumulative.length - 1 && cumulative[i] < target) i++;
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz;
      const nz = tx;

      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 16),
        new THREE.MeshBasicMaterial({
          color: 0xe0f7fa,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(p.x, y + 0.006, p.z);
      dot.renderOrder = 14;
      this.dynamicGroup.add(dot);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.13, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffe600,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, y + 0.005, p.z);
      ring.renderOrder = 14;
      this.dynamicGroup.add(ring);

      const label = createHUDText(`ST 0${s + 1}`, {
        size: 0.16,
        color: 0xffe600,
        opacity: 0.9,
        align: 'center'
      });
      label.rotation.x = -Math.PI / 2;
      label.position.set(p.x + nx * 0.3, y + 0.012, p.z + nz * 0.3);
      label.renderOrder = 15;
      this.dynamicGroup.add(label);

      this.stops.push({ label: `ST 0${s + 1}`, km: ((s / (stopCount - 1)) * (bus.pathLengthKm || 0)).toFixed(1) });
    }

    // Route identity, flat at the top of the circle.
    const title = createHUDText(`LINE ${bus.line || '--'} // ${bus.callsign || 'BUS'}`, {
      size: 0.24,
      color: 0x00e5ff,
      opacity: 0.95,
      align: 'center'
    });
    title.rotation.x = -Math.PI / 2;
    title.position.set(0, this.planeHeight + 0.02, -this.overlayRadius * 0.88);
    title.renderOrder = 15;
    this.dynamicGroup.add(title);
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

  // ---------------------------------------------------------------- panel
  renderInfoPanel(bus) {
    let panel = document.getElementById('transit-route-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'transit-route-panel';
      document.body.appendChild(panel);
    }

    const stopRows = this.stops
      .map(s => `<div>${s.label} - ${s.km} km</div>`)
      .join('');

    panel.style.display = 'block';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #00e5ff;padding-bottom:6px;margin-bottom:8px;">
        <span style="font-weight:bold;color:#00e5ff;letter-spacing:1px;">[ROUTE INSPECTION]</span>
        <span id="close-route-panel" style="cursor:pointer;color:#ff6a00;font-size:16px;">&times;</span>
      </div>
      <div style="font-size:13px;font-weight:bold;color:#ffe600;margin-bottom:4px;">
        ${bus.callsign || 'BUS'}
      </div>
      <div style="font-size:10px;color:#70d8ff;margin-bottom:6px;">
        OPERATOR: SUPERBUS / EGGED | LINE ${bus.line || '--'}
      </div>
      <div style="font-size:10px;line-height:1.6;color:#e0f7fa;">
        <div>SPEED: ${Math.round(bus.speedKmh || 0)} km/h</div>
        <div>ROUTE LENGTH: ${(bus.pathLengthKm || 0).toFixed(1)} km</div>
        <div>STATUS: ON-TIME (GPS SYNC)</div>
        <div style="margin-top:6px;font-weight:bold;color:#00e5ff;">STATIONS:</div>
        ${stopRows}
      </div>
    `;

    document.getElementById('close-route-panel').addEventListener('click', () => {
      this.clear();
    });
  }
}
