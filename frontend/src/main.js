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

// Viewport configuration
let currentConfig = {
  centerLat: 32.6595,
  centerLon: 35.1090,
  radiusKm: 10.0,
  stepMeters: 25.0,
  contourOpacity: 0.42,
  roadColor: 0xffe600,
  roadOpacity: 0.95,
  idleTimeoutMs: 30000,
  idleRotationSpeed: 0.0015
};

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
  pitch: 58 * Math.PI / 180
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

// Elevated Bus Route Inspection Plane
const routeInspectionPlane = new RouteInspectionPlane(scene, camera);

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
    const res = await fetch('http://localhost:8000/api/traffic/flow');
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
const wsUrl = `${wsProtocol}//${window.location.hostname}:8000/ws/telemetry`;

const telemetry = new TelemetryStream(
  wsUrl,
  (data) => {
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

// Settings Modal & Live Sliders
const modal = document.getElementById('settings-modal');
const contourOpSlider = document.getElementById('cfg-contour-op');
const contourOpVal = document.getElementById('val-contour-op');
const roadOpSlider = document.getElementById('cfg-road-op');
const roadOpVal = document.getElementById('val-road-op');
const roadColorSelect = document.getElementById('cfg-road-color');

contourOpSlider.addEventListener('input', (e) => {
  contourOpVal.textContent = `${e.target.value}%`;
});

roadOpSlider.addEventListener('input', (e) => {
  roadOpVal.textContent = `${e.target.value}%`;
  roadManager.updateStyle({ roadOpacity: parseInt(e.target.value, 10) / 100 });
});

roadColorSelect.addEventListener('change', (e) => {
  roadManager.updateStyle({ roadColor: parseInt(e.target.value, 16) });
});

document.getElementById('open-settings-btn').addEventListener('click', () => {
  modal.classList.add('active');
});
document.getElementById('close-settings-btn').addEventListener('click', () => {
  modal.classList.remove('active');
});
document.getElementById('save-settings-btn').addEventListener('click', () => {
  currentConfig.centerLat = parseFloat(document.getElementById('cfg-lat').value);
  currentConfig.centerLon = parseFloat(document.getElementById('cfg-lon').value);
  currentConfig.radiusKm = parseFloat(document.getElementById('cfg-radius').value);
  currentConfig.stepMeters = parseFloat(document.getElementById('cfg-step').value);
  currentConfig.contourOpacity = parseInt(contourOpSlider.value, 10) / 100.0;
  currentConfig.roadColor = parseInt(roadColorSelect.value, 16);
  currentConfig.roadOpacity = parseInt(roadOpSlider.value, 10) / 100.0;
  currentConfig.idleTimeoutMs = parseInt(document.getElementById('cfg-idle-timeout').value, 10) * 1000;
  currentConfig.idleRotationSpeed = parseFloat(document.getElementById('cfg-idle-speed').value);

  cameraController.idleTimeoutMs = currentConfig.idleTimeoutMs;
  cameraController.idleRotationSpeed = currentConfig.idleRotationSpeed;

  cameraController.distance = currentConfig.radiusKm * 1.95;
  cylinderHUD.setRadius(currentConfig.radiusKm);
  celestialManager.setRadius(currentConfig.radiusKm);

  scene.remove(polarGrid);
  polarGrid = createPolarGrid(currentConfig.radiusKm, currentConfig.radiusKm / 4, 12);
  scene.add(polarGrid);

  roadManager.config.radiusKm = currentConfig.radiusKm;
  if (tomtomRoadsData) roadManager.buildRoads(tomtomRoadsData, sampleElevation);
  if (osmRailData) roadManager.buildRailways(osmRailData, sampleElevation);
  stationManager.config.radiusKm = currentConfig.radiusKm;
  stationManager.buildStations(sampleElevation);

  rebuildContours();
  initTransitVehicles();

  document.getElementById('radar-subtext').textContent = 
    `ANCHOR: (${currentConfig.centerLat.toFixed(4)}° N, ${currentConfig.centerLon.toFixed(4)}° E) | R: ${currentConfig.radiusKm.toFixed(1)} KM`;

  modal.classList.remove('active');
});

// Deselect route on ESC key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    routeInspectionPlane.clear();
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

  // Animate the 45° curved perimeter bar (visualizes 30s inactivity countdown with striped fill)
  cylinderHUD.animate(delta, cameraController.yaw, cameraController.getIdleElapsed(), cameraController.isIdle);

  celestialManager.updateSatellites(delta);

  // Smooth physical transit simulation along road vectors
  pinsManager.updateSimulation(delta, roadManager, sampleElevation);

  // Update 3D vector wireframe flags & vector stroke HUD text in WebGL world space (Option 1)
  spatialFlagsManager.update3DPositions(cameraController.yaw);
  stationManager.update3DPositions(cameraController.yaw);

  celestialManager.checkHover();

  // Render 3D WebGL scene through UnrealBloomPass
  composer.render();

  // Clear 2D SVG overlay since all text is now rendered in pure 3D WebGL lines (Option 1)
  svgOverlay.innerHTML = '';

  const camReadout = document.getElementById('camera-mode-readout');
  if (camReadout) {
    camReadout.textContent = cameraController.isIdle
      ? 'CAMERA: IDLE ROTATION ACTIVE'
      : `CAMERA: INACTIVITY TIMER (${(cameraController.getIdleElapsed() / 1000).toFixed(1)}s / 30s)`;
  }
}

animate();
