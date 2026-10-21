import * as THREE from 'three';
import { setupCamera, CameraController } from './scene/camera.js';
import { setupBloom, updateComposerSize } from './scene/bloom.js';
import { createPolarGrid, renderPerimeterCompassLabels } from './scene/polar_grid.js';
import { buildContourMesh } from './scene/contours.js';
import { RoadNetworkManager } from './scene/roads.js';
import { TrainStationManager } from './scene/train_stations.js';
import { RouteInspectionPlane } from './scene/route_plane.js';
import { CelestialDomeManager } from './scene/celestial_dome.js';
import { TelemetryPinsManager } from './scene/telemetry_pins.js';
import { EncompassingCylinderHUD } from './scene/encompassing_cylinder.js';
import { TelemetryStream } from './network/data_stream.js';

const container = document.getElementById('viewport-container');
const svgOverlay = document.getElementById('hud-overlay');

// Same-origin API: nginx (prod) and the vite dev server both proxy /api and /ws
// to the backend, so requests are relative and work on any host/port (kiosk + LAN).
const API_BASE = '';

// Default tactical parameters (fallback when no on-disk settings exist)
const DEFAULT_CONFIG = {
  centerLat: 32.6595,
  centerLon: 35.1090,
  radiusKm: 10.0,
  stepMeters: 25.0,
  contourOpacity: 0.42,
  roadColor: 0xffe600,
  roadOpacity: 0.95,
  idleTimeoutMs: 30000,
  idleRotationSpeed: 0.0015,
  cameraRotationSpeed: 0.0015,
  cylinderRotationSpeed: 0.035,
  initialCameraPitch: 58.0,
  aaMode: 'fxaa',
  issTrackingMode: 'realtime'
};

// Kiosk / headless: load tactical parameters FROM DISK at boot (served by the backend
// from config/settings.json) so the deck runs with no mouse/keyboard.
async function loadConfigFromDisk() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      console.log('[settings] loaded from disk:', cfg);
      return { ...DEFAULT_CONFIG, ...cfg };
    }
  } catch (e) {
    console.warn('[settings] disk load failed; using defaults:', e);
  }
  return { ...DEFAULT_CONFIG };
}

// Top-level await: resolve settings BEFORE any scene managers are constructed.
let currentConfig = await loadConfigFromDisk();

// Reflect loaded settings in the HUD + settings modal
document.getElementById('radar-subtext').textContent =
  `ANCHOR: (${currentConfig.centerLat.toFixed(4)}° N, ${currentConfig.centerLon.toFixed(4)}° E) | R: ${currentConfig.radiusKm.toFixed(1)} KM`;


// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ReinhardToneMapping;
container.appendChild(renderer.domElement);

// Scene & Camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01050d);

const camera = setupCamera(window.innerWidth, window.innerHeight);
const cameraController = new CameraController(camera, renderer.domElement, {
  cameraRotationSpeed: currentConfig.cameraRotationSpeed !== undefined ? currentConfig.cameraRotationSpeed : currentConfig.idleRotationSpeed,
  idleRotationSpeed: currentConfig.cameraRotationSpeed !== undefined ? currentConfig.cameraRotationSpeed : currentConfig.idleRotationSpeed,
  idleTimeoutMs: currentConfig.idleTimeoutMs,
  distance: currentConfig.radiusKm * 1.95,
  pitch: ((currentConfig.initialCameraPitch !== undefined ? currentConfig.initialCameraPitch : 58) * Math.PI) / 180
});

// Postprocessing Bloom & Anti-Aliasing (Feature: 2 modes - FXAA & MSAA 4x)
const composer = setupBloom(
  renderer,
  scene,
  camera,
  window.innerWidth,
  window.innerHeight,
  currentConfig.aaMode || 'fxaa'
);

// Procedural Polar Grid with 3D North Compass Arrow
let polarGrid = createPolarGrid(currentConfig.radiusKm, currentConfig.radiusKm / 4, 12);
scene.add(polarGrid);

// Encompassing 45° Curved Cylinder Bar (100% Vector Edition, 4x taller, x2 higher)
const cylinderHUD = new EncompassingCylinderHUD(scene, currentConfig);

// Virtual Celestial Dome (Sun, Moon, LEO Satellites, 3D ISS Vector Model)
const celestialManager = new CelestialDomeManager(scene, camera, renderer.domElement, currentConfig);
celestialManager.updateCelestialPositions(new Date());

// Road & Railway Network Manager (with subterranean Yokneam tunnels & fat 3x traffic jam ribbons)
const roadManager = new RoadNetworkManager(scene, currentConfig);

// Train Station Manager (Exact surveyed Kfar Yehoshua coordinates & 30m countdown flag)
const stationManager = new TrainStationManager(scene, camera, svgOverlay, currentConfig);

// Bus route inspection overlay: its own circle/grid/route pane above the map.
// It does not touch the main terrain compass circle (polarGrid).
const routeInspectionPlane = new RouteInspectionPlane(scene, camera, {
  radiusKm: currentConfig.radiusKm,
  // Lift the whole view (camera + look-at) onto the overlay plane, and return
  // to the map origin when the route is deselected.
  onSelect: () => cameraController.focusPlane(routeInspectionPlane.planeHeight + 0.15),
  onClear: () => cameraController.clearViewOffset()
});

// Contours Layer (4-quadrant stitched DEM)
let contoursMesh = null;
let elevationData = null;
let tomtomRoadsData = null;
let osmRailData = null;
let activeTransitEntities = [];

function sampleElevation(lat, lon) {
  if (!elevationData || !elevationData.bounds) return 0.05;
  const b = elevationData.bounds;
  const h = elevationData.shape[0];
  const w = elevationData.shape[1];

  const py = Math.floor(((b.lat_max - lat) / (b.lat_max - b.lat_min)) * h);
  const px = Math.floor(((lon - b.lon_min) / (b.lon_max - b.lon_min)) * w);

  if (py >= 0 && py < h && px >= 0 && px < w) {
    const elevM = elevationData.elevations[py][px];
    return (elevM / 1000.0) * 3.0;
  }
  return 0.05;
}

function rebuildContours() {
  if (!elevationData) return;
  if (contoursMesh) {
    scene.remove(contoursMesh);
    contoursMesh.geometry.dispose();
    contoursMesh.material.dispose();
  }
  contoursMesh = buildContourMesh(elevationData, currentConfig);
  scene.add(contoursMesh);
}

// Telemetry Drop-Pins Manager
const pinsManager = new TelemetryPinsManager(scene, camera, svgOverlay, {
  onSelect: (entity) => {
    if (entity.type === 'transit' && entity.lineData) {
      routeInspectionPlane.selectRoute(entity.lineData);
    }
  }
});

async function loadLayers() {
  try {
    // 1. Stitched 512x512 elevation (all 4 quadrants)
    const elevRes = await fetch('/data/yokneam_elevation_512.json');
    elevationData = await elevRes.json();
    rebuildContours();

    // 2. TomTom Maps Vector Roads only (Subterranean Tunnels & Fat Traffic Jam Ribbons)
    const roadsRes = await fetch('/data/tomtom_roads.json');
    tomtomRoadsData = await roadsRes.json();
    roadManager.buildRoads(tomtomRoadsData, sampleElevation);

    // 3. OpenStreetMap Railways (Jezreel Valley Line)
    const railRes = await fetch('/data/yokneam_railways.json');
    osmRailData = await railRes.json();
    roadManager.buildRailways(osmRailData, sampleElevation);

    // 4. Train Stations (3D Vector Stroke Flag & 30m Countdown Bar)
    stationManager.buildStations(sampleElevation);

    // 5. Load the one real line we support today (line 16) and keep the
    //    simulated bus fleet out of the deck entirely.
    await initTransitVehicles();

    // 6. Fetch live TomTom traffic flow from backend
    fetchTrafficFlow();
  } catch (err) {
    console.warn("Error loading layers:", err);
  }
}

async function fetchTrafficFlow() {
  try {
    const res = await fetch(`${API_BASE}/api/traffic/flow`);
    if (res.ok) {
      const data = await res.json();
      console.log("[Traffic Flow] Loaded traffic data from backend:", data);
    }
  } catch (e) {
    // Backend serves cached traffic
  }
}

function hhmmss(str) {
  const p = String(str || "00:00:00").split(':').map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

let line16Data = null;
let line16Entity = null;

/** Position of the line-16 bus for the current time of day, from the trip samples. */
function line16SampleNow() {
  if (!line16Data || !Array.isArray(line16Data.samples) || !line16Data.samples.length) return null;
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const startSec = hhmmss(line16Data.scheduled_start);
  const endSec = hhmmss(line16Data.scheduled_end);
  const elapsed = Math.max(0, Math.min(endSec - startSec, nowSec - startSec));

  const samples = line16Data.samples;
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
    x: a.xy[0] + (b.xy[0] - a.xy[0]) * f,
    z: a.xy[1] + (b.xy[1] - a.xy[1]) * f,
    groundY: a.ground_y + (b.ground_y - a.ground_y) * f,
    v: a.v + (b.v - a.v) * f
  };
}

function updateLine16Position() {
  if (!line16Entity) return;
  const s = line16SampleNow();
  if (!s) return;
  line16Entity.x = s.x;
  line16Entity.z = s.z;
  line16Entity.groundY = s.groundY;
  line16Entity.y = s.groundY + 0.12;
  line16Entity.speedKmh = s.v;
}

/**
 * Load the real GTFS line-16 trip (route shape, stops, timetable, simulation
 * samples). The simulated multi-line bus fleet is intentionally gone: until the
 * area query is enabled, line 16 is the only bus on the deck.
 */
async function initTransitVehicles() {
  const entities = [];
  const railPaths = roadManager.railwayPaths;

  // Rail stays as a separate feature (not a bus line).
  if (railPaths.length > 0) {
    const rail = railPaths[0];
    const pt = rail.points[Math.floor(rail.points.length * 0.4)];
    entities.push({
      id: 'RAIL01',
      callsign: 'TRAIN-084',
      type: 'train',
      line: 'HAEMEK',
      roadPath: rail.points,
      pathLengthKm: rail.lengthKm,
      pathProgress: 0.4,
      direction: 1,
      speedKmh: 105,
      x: pt.x,
      y: pt.y + 0.16,
      z: pt.z,
      groundY: pt.y
    });
  }

  try {
    const res = await fetch('/data/line16_test.json', { cache: 'no-store' });
    if (res.ok) {
      line16Data = await res.json();
      const s0 = line16Data.samples?.[0];
      const first = s0 ? { x: s0.xy[0], z: s0.xy[1], y: s0.y, groundY: s0.ground_y } : { x: 0, y: 0.1, z: 0, groundY: 0 };
      line16Entity = {
        id: 'BUS16',
        callsign: `BUS ${line16Data.line}`,
        type: 'transit',
        line: line16Data.line,
        roadPath: line16Data.path.map(([x, z], i) => ({ x, z, y: line16Data.path_y?.[i] ?? 0 })),
        pathLengthKm: line16Data.path_km,
        pathProgress: 0,
        direction: 1,
        speedKmh: s0?.v || 0,
        x: first.x,
        z: first.z,
        y: first.y,
        groundY: first.groundY,
        scheduleDriven: true,
        lineData: line16Data
      };
      entities.push(line16Entity);
      updateLine16Position();
    } else {
      console.warn('[transit] line 16 data missing:', res.status);
    }
  } catch (err) {
    console.warn('[transit] line 16 load failed:', err);
  }

  activeTransitEntities = entities;
  pinsManager.setEntities(entities);

  const countReadout = document.getElementById('target-count-readout');
  if (countReadout) {
    const buses = entities.filter(e => e.type === 'transit').length;
    countReadout.textContent = `TRANSIT: ${buses} BUS LINE${buses === 1 ? '' : 'S'} (GTFS) | RAIL: ${entities.length - buses}`;
  }
}

loadLayers();

// Periodic traffic refresh (every 5 minutes / 300s)
setInterval(fetchTrafficFlow, 300000);

// WebSocket telemetry listener
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${location.host}/ws/telemetry`;

const telemetry = new TelemetryStream(
  wsUrl,
  (data) => {
    if (data.type === 'settings_updated') {
      console.log('[telemetry] settings updated broadcast received; reloading deck...');
      window.location.reload();
      return;
    }
    if (data.type === 'telemetry' && Array.isArray(data.entities)) {
      activeTransitEntities = data.entities;
      pinsManager.setEntities(data.entities);
    }
  },
  (status) => {
    const pill = document.getElementById('status-pill');
    if (pill) {
      pill.textContent = status === 'connected' ? 'TRAFFIC: TOMTOM + WS' : 'TRAFFIC: 5M CAPPED';
      pill.style.borderColor = status === 'connected' ? '#00e5ff' : '#ff8f00';
      pill.style.color = status === 'connected' ? '#00e5ff' : '#ff8f00';
    }
  }
);
telemetry.connect();

// Kiosk/self-refresh: reload when the deployed image version changes.
let deckVersion = null;
async function checkDeckVersion() {
  try {
    const res = await fetch(`${API_BASE}/api/version`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!deckVersion) { deckVersion = data.version; return; }
    if (data.version && data.version !== deckVersion) {
      window.location.href = `${window.location.pathname}?v=${Date.now()}`;
    }
  } catch (e) {
    // Backend is restarting during a deploy; retry on the next tick.
  }
}
checkDeckVersion();
setInterval(checkDeckVersion, 60000);

// Window Resize Handling
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updateComposerSize(composer, renderer, w, h);
}
window.addEventListener('resize', onResize);

// Settings redirect button
document.getElementById('open-settings-btn')?.addEventListener('click', () => {
  window.location.href = '/settings';
});

// LAN settings QR (backend builds the URL from the request host)
const qrImg = document.getElementById('settings-qr');
if (qrImg) {
  qrImg.src = `${API_BASE}/api/qr/settings`;
  qrImg.addEventListener('error', () => {
    const block = document.getElementById('settings-qr-block');
    if (block) block.style.display = 'none';
  });
}

// Deselect route on ESC key or clicking in the empty spot
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    routeInspectionPlane.clear();
  }
});

let pointerDownPos = { x: 0, y: 0 };
window.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  if (dist < 6) { // Click, not a drag
    if (e.target.closest('#transit-route-panel') ||
        e.target.closest('.hud-target-tag') ||
        e.target.closest('.hud-btn') ||
        e.target.closest('#celestial-tooltip') ||
        e.target.closest('.iss-target-tag')) {
      return;
    }
    if (routeInspectionPlane && routeInspectionPlane.selectedBus) {
      routeInspectionPlane.clear();
    }
  }
});

// Periodic celestial position update
setInterval(() => {
  celestialManager.updateCelestialPositions(new Date());
}, 30000);

// Render Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  cameraController.update(delta);
  roadManager.animate(delta);

  // 5) Animate the 8-segment 45° outer cylinder spinning separately from the camera around the map
  cylinderHUD.animate(delta, cameraController.getIdleElapsed(), cameraController.isIdle);

  celestialManager.updateCelestialPositions(new Date());
  celestialManager.updateSatellites(delta);

  // Schedule-driven bus position first, then rebuild the pin meshes.
  updateLine16Position();
  routeInspectionPlane.update(delta);
  pinsManager.updateSimulation(delta, roadManager, sampleElevation);

  celestialManager.checkHover();

  // Render 3D WebGL scene through UnrealBloomPass
  composer.render();

  // Clear 2D SVG overlay (all text and ISS are now purely 3D WebGL vectors)
  svgOverlay.innerHTML = '';

  const camReadout = document.getElementById('camera-mode-readout');
  if (camReadout) {
    camReadout.textContent = cameraController.isIdle
      ? 'CAMERA: IDLE ROTATION ACTIVE'
      : `CAMERA: INACTIVITY TIMER (${(cameraController.getIdleElapsed() / 1000).toFixed(1)}s / 30s)`;
  }
}

// Dev-only inspection hook (used by headless UI checks; absent in prod builds).
if (import.meta.env.DEV) {
  window.__deckDebug = {
    selectBus: (i = 0) => {
      const buses = activeTransitEntities.filter(e => e.type === 'transit' && e.lineData);
      if (!buses.length) return null;
      const bus = buses[i % buses.length];
      routeInspectionPlane.selectRoute(bus.lineData);
      return bus.callsign;
    },
    clear: () => routeInspectionPlane.clear(),
    cameraOffset: () => ({
      current: cameraController.offset.toArray().map(v => +v.toFixed(3)),
      target: cameraController.targetOffset.toArray().map(v => +v.toFixed(3))
    }),
    state: () => {
      const d = routeInspectionPlane.dynamicGroup;
      const ribbon = d.children.find(o => o.isMesh && o.geometry?.attributes?.position?.count > 4);
      let maxR = 0;
      const ys = new Set();
      if (ribbon) {
        const a = ribbon.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i += 3) {
          maxR = Math.max(maxR, Math.hypot(a[i], a[i + 2]));
          ys.add(a[i + 1].toFixed(3));
        }
      }
      return {
        selected: routeInspectionPlane.route ? `LINE ${routeInspectionPlane.route.line}` : null,
        stops: routeInspectionPlane.stops.length,
        stopNames: routeInspectionPlane.stops.slice(0, 4).map(s => s.name),
        tripStatus: routeInspectionPlane.trip ? routeInspectionPlane.tripClock().status : null,
        busMarker: routeInspectionPlane.busMarker
          ? routeInspectionPlane.busMarker.position.toArray().map(v => +v.toFixed(3))
          : null,
        overlayVisible: routeInspectionPlane.group.visible,
        staticChildren: routeInspectionPlane.staticGroup.children.length,
        dynamicChildren: d.children.length,
        planeHeight: routeInspectionPlane.planeHeight,
        overlayRadius: routeInspectionPlane.overlayRadius,
        routeMaxRadius: +maxR.toFixed(3),
        routeYValues: [...ys],
        cameraOffset: {
          current: cameraController.offset.toArray().map(v => +v.toFixed(3)),
          target: cameraController.targetOffset.toArray().map(v => +v.toFixed(3))
        },
        qrVisible: !!document.getElementById('settings-qr')?.complete,
        polarGridInScene: scene.children.includes(polarGrid),
        polarGridChildren: polarGrid.children.length,
        busCount: activeTransitEntities.filter(e => e.type === 'transit').length,
        roadRoutes: roadManager.continuousRoutes.length,
        railPaths: roadManager.railwayPaths.length,
        entities: activeTransitEntities.length
      };
    }
  };

  const params = new URLSearchParams(window.location.search);
  if (params.has('inspect')) {
    const idx = parseInt(params.get('inspect'), 10) || 0;
    const timer = setInterval(() => {
      const buses = activeTransitEntities.filter(e => e.type === 'transit' && e.lineData);
      if (!buses.length) return;
      clearInterval(timer);
      routeInspectionPlane.selectRoute(buses[idx % buses.length].lineData);
      const el = document.createElement('div');
      el.id = 'debug-state';
      el.style.display = 'none';
      document.body.appendChild(el);
      const writeState = () => {
        el.textContent = JSON.stringify(window.__deckDebug.state());
      };
      writeState();
      setInterval(writeState, 500);
      // Dev-only: verify the reverse camera transition headlessly.
      if (params.has('clearafter')) {
        setTimeout(() => routeInspectionPlane.clear(), parseInt(params.get('clearafter'), 10) || 3000);
      }
    }, 250);
  }
}

animate();
