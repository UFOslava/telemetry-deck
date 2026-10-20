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
  radiusKm: currentConfig.radiusKm
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
    if (entity.type === 'transit') {
      routeInspectionPlane.selectBus(entity);
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

    // 5. Seed smooth transit fleet along continuous multi-kilometer routes
    initTransitVehicles();

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

function initTransitVehicles() {
  const routes = roadManager.continuousRoutes;
  const railPaths = roadManager.railwayPaths;
  const entities = [];

  if (routes.length > 0) {
    const busLineConfigs = [
      { line: '180', name: 'BUS 180 (Route 70 Express)', speed: 65, routeName: 'Route 70' },
      { line: '188', name: 'BUS 188 (Route 70 Local)',   speed: 55, routeName: 'Route 70' },
      { line: '157', name: 'BUS 157 (Highway 6 North)',  speed: 80, routeName: 'Highway 6' },
      { line: '160', name: 'BUS 160 (Highway 6 South)',  speed: 75, routeName: 'Highway 6' },
      { line: '50',  name: 'BUS 50 (Yokneam Tech)',      speed: 42, routeName: 'Yokneam City' },
      { line: '19',  name: 'BUS 19 (Yokneam Illit)',     speed: 38, routeName: 'Yokneam City' },
      { line: '301', name: 'BUS 301 (Route 66 Regional)',speed: 68, routeName: 'Route 66' },
      { line: '722', name: 'BUS 722 (Kfar Yehoshua)',    speed: 60, routeName: 'Route 722' }
    ];

    busLineConfigs.forEach((cfg, i) => {
      let matchedRoute = routes.find(r => r.name === cfg.routeName) || routes[i % routes.length];
      const initialProgress = ((i * 0.28) % 0.85) + 0.05;
      const initialIdx = Math.floor(initialProgress * (matchedRoute.points.length - 1));
      const pt = matchedRoute.points[initialIdx];

      entities.push({
        id: `TR${(i + 1).toString().padStart(2, '0')}`,
        callsign: cfg.name,
        type: 'transit',
        line: cfg.line,
        roadPath: matchedRoute.points,
        pathLengthKm: matchedRoute.lengthKm,
        pathProgress: initialProgress,
        direction: i % 2 === 0 ? 1 : -1,
        speedKmh: cfg.speed,
        x: pt.x,
        y: pt.y + 0.12,
        z: pt.z,
        groundY: pt.y
      });
    });
  }

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

  activeTransitEntities = entities;
  pinsManager.setEntities(entities);

  const countReadout = document.getElementById('target-count-readout');
  if (countReadout) {
    countReadout.textContent = `TRANSIT: ${entities.length} ACTIVE (3D VECTOR FLAGS)`;
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

  // Smooth physical transit simulation along road vectors
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
      const buses = activeTransitEntities.filter(e => e.type === 'transit');
      if (!buses.length) return null;
      const bus = buses[i % buses.length];
      routeInspectionPlane.selectBus(bus);
      return bus.callsign;
    },
    clear: () => routeInspectionPlane.clear(),
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
        selected: routeInspectionPlane.selectedBus?.callsign || null,
        overlayVisible: routeInspectionPlane.group.visible,
        staticChildren: routeInspectionPlane.staticGroup.children.length,
        dynamicChildren: d.children.length,
        planeHeight: routeInspectionPlane.planeHeight,
        overlayRadius: routeInspectionPlane.overlayRadius,
        routeMaxRadius: +maxR.toFixed(3),
        routeYValues: [...ys],
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
      const buses = activeTransitEntities.filter(e => e.type === 'transit');
      if (!buses.length) return;
      clearInterval(timer);
      routeInspectionPlane.selectBus(buses[idx % buses.length]);
      const el = document.createElement('div');
      el.id = 'debug-state';
      el.style.display = 'none';
      el.textContent = JSON.stringify(window.__deckDebug.state());
      document.body.appendChild(el);
    }, 250);
  }
}

animate();
