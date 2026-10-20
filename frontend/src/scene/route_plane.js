import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

/**
 * Bus route inspection overlay.
 *
 * This is an elevated projection layer above the terrain:
 *   - The flat map size matches the main map compass size (overlayRadius = radiusKm),
 *   - Its own amber encompassing circle + tick ring,
 *   - A Cartesian grid clipped to the circle,
 *   - Route and stations overlay their exact real-world coordinates directly above the map,
 *   - Stations cast vertical drop-pins down to the main map terrain, stopping at the correct height values,
 *   - A radial dim veil darkens the terrain and roads below by ~40-50%.
 */
export class RouteInspectionPlane {
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.selectedBus = null;
    this.onSelect = options.onSelect || null;
    this.onClear = options.onClear || null;

    this.radiusKm = options.radiusKm || 10.0;
    // Flat map size matches the main map compass size
    this.overlayRadius = this.radiusKm;
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

  setRadius(radiusKm) {
    this.radiusKm = radiusKm;
    this.overlayRadius = radiusKm;
    while (this.staticGroup.children.length > 0) {
      const obj = this.staticGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.buildStaticLayer();
    if (this.selectedBus) {
      this.clearDynamic();
      this.buildFlattenedRoute(this.selectedBus);
    }
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
        uOpacity: { value: 0.45 }
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
          float a = uOpacity * (1.0 - smoothstep(0.40, 1.0, d));
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

    // Faint surface so the projection reads as a separate pane matching compass size
    const fillGeo = new THREE.CircleGeometry(R, 128);
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

    // Amber encompassing ring matching main compass perimeter
    const ringGeo = new THREE.RingGeometry(R - 0.05, R + 0.05, 128);
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

    // Tick band around compass perimeter
    const tickPositions = [];
    const ticks = 72;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const long = i % 18 === 0;
      const r0 = R + 0.05;
      const r1 = R + (long ? 0.40 : 0.20);
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

    // Centre crosshair
    positions.push(-0.4, y, 0, 0.4, y, 0);
    positions.push(0, y, -0.4, 0, y, 0.4);

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
    if (typeof document !== 'undefined') {
      const panel = document.getElementById('transit-route-panel');
      if (panel) panel.style.display = 'none';
    }
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
  buildFlattenedRoute(bus) {
    const y_plane = this.planeHeight + 0.02;
    // Overlay real world locations precisely without artificial shifting or scaling
    const pts = bus.roadPath;
    if (!pts || pts.length < 2) return;

    // 1. Glow underlay + crisp flat route ribbon on the elevated plane
    const glowGeo = this.buildRibbonGeometry(pts, 0.28, y_plane + 0.001);
    if (glowGeo) {
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.20,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      glow.renderOrder = 12;
      this.dynamicGroup.add(glow);
    }

    const routeGeo = this.buildRibbonGeometry(pts, 0.12, y_plane + 0.002);
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

    // 2. Stations and vertical drop-pins: evenly spaced by arc length
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    const total = cumulative[cumulative.length - 1] || 1;
    const stopCount = 6;

    const tetherPoints = [];

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

      // Exact terrain elevation on the main map
      const y_ground = (p.groundY !== undefined ? p.groundY : p.y) || 0.05;

      // Elevated station dot
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 16),
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
      dot.position.set(p.x, y_plane + 0.006, p.z);
      dot.renderOrder = 14;
      this.dynamicGroup.add(dot);

      // Elevated station outer ring
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.10, 0.15, 24),
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
      ring.position.set(p.x, y_plane + 0.005, p.z);
      ring.renderOrder = 14;
      this.dynamicGroup.add(ring);

      // Station label on elevated plane
      const label = createHUDText(`ST 0${s + 1}`, {
        size: 0.18,
        color: 0xffe600,
        opacity: 0.9,
        align: 'center'
      });
      label.rotation.x = -Math.PI / 2;
      label.position.set(p.x + nx * 0.35, y_plane + 0.012, p.z + nz * 0.35);
      label.renderOrder = 15;
      this.dynamicGroup.add(label);

      // 3. Drop-Pin line connecting elevated station down to the main map terrain:
      tetherPoints.push(p.x, y_plane, p.z);
      tetherPoints.push(p.x, y_ground, p.z);

      // Ground Target Foot on the main map terrain, stopping precisely at y_ground:
      const groundRing = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.14, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffe600,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      groundRing.rotation.x = -Math.PI / 2;
      groundRing.position.set(p.x, y_ground + 0.004, p.z);
      groundRing.renderOrder = 14;
      this.dynamicGroup.add(groundRing);

      const groundDot = new THREE.Mesh(
        new THREE.CircleGeometry(0.04, 16),
        new THREE.MeshBasicMaterial({
          color: 0xe0f7fa,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      groundDot.rotation.x = -Math.PI / 2;
      groundDot.position.set(p.x, y_ground + 0.005, p.z);
      groundDot.renderOrder = 14;
      this.dynamicGroup.add(groundDot);

      // Reticle crosshair on ground foot
      const crossSize = 0.20;
      const crossPositions = [
        p.x - crossSize, y_ground + 0.006, p.z,   p.x + crossSize, y_ground + 0.006, p.z,
        p.x, y_ground + 0.006, p.z - crossSize,   p.x, y_ground + 0.006, p.z + crossSize
      ];
      const crossGeo = new THREE.BufferGeometry();
      crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossPositions, 3));
      const crossMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const crossLines = new THREE.LineSegments(crossGeo, crossMat);
      crossLines.renderOrder = 14;
      this.dynamicGroup.add(crossLines);

      this.stops.push({
        label: `ST 0${s + 1}`,
        km: ((s / (stopCount - 1)) * (bus.pathLengthKm || 0)).toFixed(1),
        elevM: Math.round((y_ground / 3.0) * 1000)
      });
    }

    // Vertical drop-pin lines
    if (tetherPoints.length > 0) {
      const tetherGeo = new THREE.BufferGeometry();
      tetherGeo.setAttribute('position', new THREE.Float32BufferAttribute(tetherPoints, 3));
      const tetherMat = new THREE.LineDashedMaterial({
        color: 0xffe600,
        dashSize: 0.18,
        gapSize: 0.10,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const tethers = new THREE.LineSegments(tetherGeo, tetherMat);
      tethers.computeLineDistances();
      tethers.renderOrder = 14;
      tethers.userData = { isStationTethers: true };
      this.dynamicGroup.add(tethers);
    }

    // Route identity title flat at northern edge of compass
    const title = createHUDText(`LINE ${bus.line || '--'} // ${bus.callsign || 'BUS'}`, {
      size: 0.24,
      color: 0x00e5ff,
      opacity: 0.95,
      align: 'center'
    });
    title.rotation.x = -Math.PI / 2;
    title.position.set(0, this.planeHeight + 0.02, -this.overlayRadius * 0.90);
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
    if (typeof document === 'undefined') return;
    let panel = document.getElementById('transit-route-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'transit-route-panel';
      document.body.appendChild(panel);
    }

    const stopRows = this.stops
      .map(s => `<div>${s.label} (${s.elevM}m elev) - ${s.km} km</div>`)
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
