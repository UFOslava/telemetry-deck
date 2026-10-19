import * as THREE from 'three';
import { setupCamera, CameraController } from './scene/camera.js';
import { setupBloom } from './scene/bloom.js';
import { createPolarGrid, renderPerimeterCompassLabels } from './scene/polar_grid.js';
import { buildContourMesh } from './scene/contours.js';
import { RoadNetworkManager } from './scene/roads.js';
import { TrainStationManager } from './scene/train_stations.js';
import { RouteInspectionPlane } from './scene/route_plane.js';
import { CelestialDomeManager } from './scene/celestial_dome.js';
import { TelemetryPinsManager } from './scene/telemetry_pins.js';
import { EncompassingCylinderHUD } from './scene/encompassing_cylinder.js';
import { SpatialFlagsManager } from './scene/telemetry_flags.js';
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
  initialCameraPitch: 58.0
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
  idleRotationSpeed: currentConfig.idleRotationSpeed,
  idleTimeoutMs: currentConfig.idleTimeoutMs,
  distance: currentConfig.radiusKm * 1.95,
  pitch: ((currentConfig.initialCameraPitch !== undefined ? currentConfig.initialCameraPitch : 58) * Math.PI) / 180
});

// Postprocessing Bloom (Essential for 3D holographic sheen)
const composer = setupBloom(renderer, scene, camera, window.innerWidth, window.innerHeight);

// Procedural Polar Grid with 3D North Compass Arrow
let polarGrid = createPolarGrid(currentConfig.radiusKm, currentConfig.radiusKm / 4, 12);
scene.add(polarGrid);

// Encompassing 45° Curved Cylinder Bar (Visualizes 30s inactivity countdown with striped fill)
const cylinderHUD = new EncompassingCylinderHUD(scene, currentConfig);

// Virtual Celestial Dome (Sun, Moon, LEO Satellites)
const celestialManager = new CelestialDomeManager(scene, camera, renderer.domElement, currentConfig);
celestialManager.updateCelestialPositions(new Date());

// Road & Railway Network Manager (with subterranean Yokneam tunnels & fat 3x traffic jam ribbons)
const roadManager = new RoadNetworkManager(scene, currentConfig);

// Train Station Manager (Exact surveyed Kfar Yehoshua coordinates & 30m countdown flag)
const stationManager = new TrainStationManager(scene, camera, svgOverlay, currentConfig);

// 3D Spatial Vector Flags Manager (True 3D vector wireframes + translucent backing in WebGL, Option 1 zero-flicker vector text)
const spatialFlagsManager = new SpatialFlagsManager(scene, camera, svgOverlay, {
  onSelect: (entity) => {
    if (entity.type === 'transit') {
      routeInspectionPlane.selectBus(entity);
    }
  }
});

// Elevated Bus Route Inspection Plane (elevated 1.5x higher with 40% background dimming)
const routeInspectionPlane = new RouteInspectionPlane(scene, camera, {
  onSelect: (bus) => {
    // Fade terrain contours and roads below by 40% (multiplier = 0.6)
    if (contoursMesh) {
      contoursMesh.material.opacity = currentConfig.contourOpacity * 0.6;
      contoursMesh.material.needsUpdate = true;
    }
    roadManager.setDimmed(true);

    // 4) Add encompassing perimeter circle to the grid view, and limit the grid within!
    if (bus && bus.roadPath && bus.roadPath.length > 0) {
      let maxDist = 0;
      bus.roadPath.forEach(pt => {
        const d = Math.hypot(pt.x, pt.z);
        if (d > maxDist) maxDist = d;
      });
      // Comfortable tactical bounding perimeter
      const encompassingR = Math.min(currentConfig.radiusKm, Math.max(2.2, maxDist + 0.45));
      scene.remove(polarGrid);
      polarGrid = createPolarGrid(encompassingR, Math.max(0.5, encompassingR / 4), 12, { isEncompassing: true });
      scene.add(polarGrid);
    }
  },
  onClear: () => {
    // Restore normal opacity
    if (contoursMesh) {
      contoursMesh.material.opacity = currentConfig.contourOpacity;
      contoursMesh.material.needsUpdate = true;
    }
    roadManager.setDimmed(false);

    // Restore full polar grid
    scene.remove(polarGrid);
    polarGrid = createPolarGrid(currentConfig.radiusKm, currentConfig.radiusKm / 4, 12);
    scene.add(polarGrid);
  }
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
  const isInspecting = routeInspectionPlane && routeInspectionPlane.selectedBus;
  const effectiveConfig = {
    ...currentConfig,
    contourOpacity: isInspecting ? currentConfig.contourOpacity * 0.6 : currentConfig.contourOpacity
  };
  contoursMesh = buildContourMesh(elevationData, effectiveConfig);
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
  spatialFlagsManager.updateEntities(entities);

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
      spatialFlagsManager.updateEntities(data.entities);
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
  composer.setSize(w, h);
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

  celestialManager.updateSatellites(delta);

  // Smooth physical transit simulation along road vectors
  pinsManager.updateSimulation(delta, roadManager, sampleElevation);

  // Update 3D vector wireframe flags & vector stroke HUD text in WebGL world space (Option 1)
  spatialFlagsManager.update3DPositions(cameraController.yaw);
  stationManager.update3DPositions(cameraController.yaw);

  celestialManager.checkHover();

  // Render 3D WebGL scene through UnrealBloomPass
  composer.render();

  // 7) Make an ISS SVG icon follow ISS direction when it's above the horizon
  const issData = celestialManager.getISSScreenPosition(window.innerWidth, window.innerHeight);
  let svgContent = '';
  if (issData) {
    const sx = Math.round(issData.x);
    const sy = Math.round(issData.y);
    if (sx >= 10 && sx <= window.innerWidth - 10 && sy >= 10 && sy <= window.innerHeight - 10) {
      svgContent += `
        <g class="iss-target-tag" style="cursor: pointer; pointer-events: auto;">
          <!-- Target reticle -->
          <circle cx="${sx}" cy="${sy}" r="18" fill="rgba(0, 229, 255, 0.08)" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="3,2" />
          <circle cx="${sx}" cy="${sy}" r="4" fill="none" stroke="#ffe600" stroke-width="1.2" />
          <circle cx="${sx}" cy="${sy}" r="1.5" fill="#ffe600" />
          
          <!-- Detailed ISS Vector SVG Icon -->
          <!-- Central Truss Structure -->
          <line x1="${sx - 14}" y1="${sy}" x2="${sx + 14}" y2="${sy}" stroke="#e0f7fa" stroke-width="1.8" />
          
          <!-- Pressurized Core Module -->
          <rect x="${sx - 3}" y="${sy - 6}" width="6" height="12" fill="#020916" stroke="#00e5ff" stroke-width="1" rx="1" />
          <line x1="${sx}" y1="${sy - 8}" x2="${sx}" y2="${sy + 8}" stroke="#00e5ff" stroke-width="1" />

          <!-- Left Solar Arrays (Port) -->
          <rect x="${sx - 16}" y="${sy - 12}" width="5" height="10" fill="#020916" stroke="#ffe600" stroke-width="0.8" />
          <line x1="${sx - 13.5}" y1="${sy - 12}" x2="${sx - 13.5}" y2="${sy - 2}" stroke="#ffe600" stroke-width="0.5" />
          <rect x="${sx - 16}" y="${sy + 2}" width="5" height="10" fill="#020916" stroke="#ffe600" stroke-width="0.8" />
          <line x1="${sx - 13.5}" y1="${sy + 2}" x2="${sx - 13.5}" y2="${sy + 12}" stroke="#ffe600" stroke-width="0.5" />

          <!-- Right Solar Arrays (Starboard) -->
          <rect x="${sx + 11}" y="${sy - 12}" width="5" height="10" fill="#020916" stroke="#ffe600" stroke-width="0.8" />
          <line x1="${sx + 13.5}" y1="${sy - 12}" x2="${sx + 13.5}" y2="${sy - 2}" stroke="#ffe600" stroke-width="0.5" />
          <rect x="${sx + 11}" y="${sy + 2}" width="5" height="10" fill="#020916" stroke="#ffe600" stroke-width="0.8" />
          <line x1="${sx + 13.5}" y1="${sy + 2}" x2="${sx + 13.5}" y2="${sy + 12}" stroke="#ffe600" stroke-width="0.5" />

          <!-- Tactical HUD Tag Readout -->
          <line x1="${sx + 16}" y1="${sy - 12}" x2="${sx + 36}" y2="${sy - 26}" stroke="#00e5ff" stroke-width="1" opacity="0.8" />
          <rect x="${sx + 36}" y="${sy - 38}" width="124" height="25" fill="rgba(1, 15, 30, 0.9)" stroke="#00e5ff" stroke-width="1" rx="2" />
          <text x="${sx + 42}" y="${sy - 27}" fill="#ffe600" font-size="9" font-family="'Courier New', monospace" font-weight="bold">ISS (ZARYA) [LEO]</text>
          <text x="${sx + 42}" y="${sy - 17}" fill="#00e5ff" font-size="8" font-family="'Courier New', monospace">ALT 418KM | ${issData.altDeg}° EL</text>
        </g>
      `;
    }
  }
  svgOverlay.innerHTML = svgContent;

  const camReadout = document.getElementById('camera-mode-readout');
  if (camReadout) {
    camReadout.textContent = cameraController.isIdle
      ? 'CAMERA: IDLE ROTATION ACTIVE'
      : `CAMERA: INACTIVITY TIMER (${(cameraController.getIdleElapsed() / 1000).toFixed(1)}s / 30s)`;
  }
}

animate();
