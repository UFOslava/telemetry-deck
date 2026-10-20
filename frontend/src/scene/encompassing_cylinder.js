import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

/**
 * Encompassing 360° Multi-Segment Outer Cylinder HUD (High-Performance Vector Edition)
 * 
 * 100% Vector Lines, Frames, Vector Text and SVG Graphics (Zero CanvasTextures!).
 * Spins smoothly around the map independently of the camera.
 * 
 * Dimensions:
 *  - 4x taller: barHeight = 2.1 km
 *  - Position x2 higher from origin height: baseY = 2.3 km (spans Y = 2.3 to 4.4 km)
 * 
 * Divided into 8 distinct 45° segments (Math.PI * 0.25):
 *  0. Inactivity Timeout Countdown Bar (hazard stripes)
 *  1. Big Real-Time Clock in centerpoint timezone (Asia/Jerusalem)
 *  2. Current Date & Tactical Epoch
 *  3. Weather with 3D Vector SVG Sun/Cloud icon and Temperature Range
 *  4. Secondary Inactivity / Mission Timer
 *  5. UTC Zulu Global Clock
 *  6. Carmel Ridge Regional Microclimate
 *  7. Radar Anchor & Coordinates Status
 */
export class EncompassingCylinderHUD {
  constructor(scene, config = {}) {
    this.scene = scene;
    this.config = config;

    this.radius = this.config.radiusKm || 10.0;
    this.numSegments = 8;
    this.angleSpan = (Math.PI * 2) / this.numSegments; // 45 degrees = PI / 4

    // 4x taller and x2 higher from map origin height
    this.barHeight = 2.1; // km (was 0.52)
    this.baseY = 2.3;     // km (was 1.15)

    this.spinSpeed = this.config.cylinderRotationSpeed !== undefined ? this.config.cylinderRotationSpeed : 0.035; // rad per second - steady independent spin around map
    this.rotationAngle = 0;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Weather state
    this.weatherData = {
      location: 'Yokneam Illit / Carmel Ridge',
      temperature: 24,
      temp_min: 16,
      temp_max: 28,
      condition: 'CLEAR SKY',
      icon: 'sunny',
      humidity: 48,
      wind_kmh: 14,
      wind_dir: 'NW',
      timezone: 'Asia/Jerusalem'
    };
    this.fetchWeather();
    setInterval(() => this.fetchWeather(), 300000); // 5 min refresh

    // Dynamic slot tracking to avoid recreating meshes unnecessarily
    this.dynamicNodes = {};
    this.lastTimeStr = '';
    this.lastZuluStr = '';
    this.lastCountdownSec = -1;

    this.buildVectorHUD();
  }

  async fetchWeather() {
    try {
      const res = await fetch('/api/weather');
      if (res.ok) {
        this.weatherData = await res.json();
        this.updateWeatherContent();
      }
    } catch (e) {
      // Keep cached weather data
    }
  }

  setRadius(newRadius) {
    this.radius = newRadius;
    this.buildVectorHUD();
  }

  buildVectorHUD() {
    // Clear old 3D vector objects
    while (this.group.children.length > 0) {
      const obj = this.group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.dynamicNodes = {};
    this.lastTimeStr = '';
    this.lastZuluStr = '';
    this.lastCountdownSec = -1;

    const R = this.radius;
    const yBot = this.baseY;
    const yTop = this.baseY + this.barHeight;
    const yMid = this.baseY + this.barHeight * 0.5;
    const yHdr = this.baseY + this.barHeight * 0.82;
    const yFtr = this.baseY + this.barHeight * 0.18;

    const framePositions = [];
    const span = this.angleSpan * 0.94; // slight gap between segments
    const arcSegments = 24;

    for (let i = 0; i < this.numSegments; i++) {
      const phi = i * this.angleSpan;
      const startAngle = phi - span * 0.5;

      // Arc points for top, bottom, header, and footer dividers
      for (let s = 0; s < arcSegments; s++) {
        const a1 = startAngle + (s / arcSegments) * span;
        const a2 = startAngle + ((s + 1) / arcSegments) * span;

        const x1 = Math.sin(a1) * R;
        const z1 = Math.cos(a1) * R;
        const x2 = Math.sin(a2) * R;
        const z2 = Math.cos(a2) * R;

        // Top arc
        framePositions.push(x1, yTop, z1, x2, yTop, z2);
        // Bottom arc
        framePositions.push(x1, yBot, z1, x2, yBot, z2);
        // Header line
        framePositions.push(x1, yHdr, z1, x2, yHdr, z2);
        // Footer line
        framePositions.push(x1, yFtr, z1, x2, yFtr, z2);
      }

      // Left & right radial border posts
      const aLeft = startAngle;
      const aRight = startAngle + span;
      framePositions.push(
        Math.sin(aLeft) * R, yBot, Math.cos(aLeft) * R,
        Math.sin(aLeft) * R, yTop, Math.cos(aLeft) * R,
        Math.sin(aRight) * R, yBot, Math.cos(aRight) * R,
        Math.sin(aRight) * R, yTop, Math.cos(aRight) * R
      );
    }

    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(framePositions, 3));
    const frameMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    this.group.add(new THREE.LineSegments(frameGeo, frameMat));

    // Build the 8 static & dynamic vector content screens
    for (let i = 0; i < this.numSegments; i++) {
      this.buildSegmentContent(i);
    }
  }

  buildSegmentContent(segIdx) {
    const phi = segIdx * this.angleSpan;
    const segGroup = new THREE.Group();
    segGroup.rotation.y = phi;
    this.group.add(segGroup);

    // In local space, the panel is placed at (0, y, R * 0.995) facing inward toward (0, y, 0)
    const R_inner = this.radius * 0.995;
    const yHdr = this.baseY + this.barHeight * 0.88;
    const yMid = this.baseY + this.barHeight * 0.52;
    const ySub = this.baseY + this.barHeight * 0.32;
    const yFtr = this.baseY + this.barHeight * 0.10;

    const addText = (text, y, size = 0.22, color = 0x00e5ff) => {
      const mesh = createHUDText(text, { size, color, align: 'center', opacity: 0.95 });
      mesh.position.set(0, y, R_inner);
      mesh.rotation.y = Math.PI; // Face inward toward center of the map
      segGroup.add(mesh);
      return mesh;
    };

    switch (segIdx) {
      case 0: { // 0: Inactivity Countdown Screen
        addText('// INACTIVITY COUNTDOWN //', yHdr, 0.20, 0x00e5ff);
        this.dynamicNodes.countdownGroup = new THREE.Group();
        this.dynamicNodes.countdownGroup.rotation.y = Math.PI;
        this.dynamicNodes.countdownGroup.position.set(0, yMid, R_inner);
        segGroup.add(this.dynamicNodes.countdownGroup);

        addText('[AUTO-ORBIT ARMED // IDLE 30S]', yFtr, 0.16, 0x70d8ff);
        break;
      }

      case 1: { // 1: Big Real-Time Clock Screen (Asia/Jerusalem)
        addText('// REAL-TIME CLOCK //', yHdr, 0.20, 0x00e5ff);
        this.dynamicNodes.clockGroup = new THREE.Group();
        this.dynamicNodes.clockGroup.rotation.y = Math.PI;
        this.dynamicNodes.clockGroup.position.set(0, yMid, R_inner);
        segGroup.add(this.dynamicNodes.clockGroup);

        addText('LOCAL // ASIA/JERUSALEM [UTC+03:00]', ySub, 0.18, 0x70d8ff);
        addText('TIMEZONE: IDT // ISRAEL TIME', yFtr, 0.16, 0xffe600);
        break;
      }

      case 2: { // 2: Operational Date Screen
        const now = new Date();
        let dateStr = 'MON 19 OCT 2026';
        try {
          dateStr = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
          }).format(now).toUpperCase();
        } catch (e) { }

        addText('// OPERATIONAL CALENDAR //', yHdr, 0.20, 0x00e5ff);
        addText(dateStr, yMid, 0.42, 0xffe600);
        addText('DAY OF YEAR: 292 // TACTICAL CYCLE 26.4', ySub, 0.18, 0x70d8ff);
        addText('TELEMETRY EPOCH: ACTIVE', yFtr, 0.16, 0x00e5ff);
        break;
      }

      case 3: { // 3: Weather with 3D Vector SVG Sun/Cloud Icon and Temp Range
        addText('// METEOROLOGICAL TELEMETRY //', yHdr, 0.20, 0x00e5ff);
        this.dynamicNodes.weatherGroup = new THREE.Group();
        this.dynamicNodes.weatherGroup.rotation.y = Math.PI;
        this.dynamicNodes.weatherGroup.position.set(0, yMid, R_inner);
        segGroup.add(this.dynamicNodes.weatherGroup);

        this.updateWeatherContent();
        addText('YOKNEAM // HUM: 48%  WIND: 14 KM/H NW', yFtr, 0.16, 0x70d8ff);
        break;
      }

      case 4: { // 4: Secondary Inactivity / Mission Timer
        addText('// MISSION ELAPSED TIME //', yHdr, 0.20, 0x00e5ff);
        this.dynamicNodes.countdownGroup2 = new THREE.Group();
        this.dynamicNodes.countdownGroup2.rotation.y = Math.PI;
        this.dynamicNodes.countdownGroup2.position.set(0, yMid, R_inner);
        segGroup.add(this.dynamicNodes.countdownGroup2);

        addText('[CINEMATIC MONITORING ACTIVE]', yFtr, 0.16, 0x70d8ff);
        break;
      }

      case 5: { // 5: UTC Zulu Global Clock Screen
        addText('// UNIVERSAL TIME (ZULU) //', yHdr, 0.20, 0x00e5ff);
        this.dynamicNodes.zuluGroup = new THREE.Group();
        this.dynamicNodes.zuluGroup.rotation.y = Math.PI;
        this.dynamicNodes.zuluGroup.position.set(0, yMid, R_inner);
        segGroup.add(this.dynamicNodes.zuluGroup);

        addText('GLOBAL UTC MASTER SYNC', ySub, 0.18, 0x70d8ff);
        addText('ZERO DRIFT // TIME PROTOCOL', yFtr, 0.16, 0x00ffcc);
        break;
      }

      case 6: { // 6: Carmel Ridge Regional Microclimate
        addText('// CARMEL RIDGE WEATHER //', yHdr, 0.20, 0x00e5ff);
        addText('RIDGE: 22 C  VALLEY: 26 C', yMid, 0.32, 0xffe600);
        addText('BAROMETER: 1014 HPA // DEW: 13 C', ySub, 0.18, 0x70d8ff);
        addText('MICROCLIMATE: FAVORABLE', yFtr, 0.16, 0x00e5ff);
        break;
      }

      case 7: { // 7: Radar Anchor & Status
        addText('// RADAR ANCHOR STATUS //', yHdr, 0.20, 0x00e5ff);
        addText('YOKNEAM JCT // 32.6595 N, 35.1090 E', yMid, 0.28, 0x00e5ff);
        addText('RADIUS: 10.0 KM | GRID: 2.5 KM', ySub, 0.18, 0x70d8ff);
        addText('SURVEILLANCE: ACTIVE // ISS TRACKED', yFtr, 0.16, 0x00ffcc);
        break;
      }
    }
  }

  // 3D Vector SVG Sun Icon in 3D lines
  create3DVectorSunIcon() {
    const group = new THREE.Group();
    const radius = 0.35;
    const pts = [];
    const segs = 24;

    // Sun circle loop
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      pts.push(
        Math.cos(a1) * radius, Math.sin(a1) * radius, 0,
        Math.cos(a2) * radius, Math.sin(a2) * radius, 0
      );
    }

    // 8 Solar Flares
    const rIn = radius * 1.25;
    const rOut = radius * 1.85;
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      pts.push(
        Math.cos(a) * rIn, Math.sin(a) * rIn, 0,
        Math.cos(a) * rOut, Math.sin(a) * rOut, 0
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe600,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.LineSegments(geo, mat));
    return group;
  }

  updateWeatherContent() {
    const g = this.dynamicNodes.weatherGroup;
    if (!g) return;

    // Clear old weather items
    while (g.children.length > 0) {
      const obj = g.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    // Add 3D vector SVG sun icon on the left
    const sunIcon = this.create3DVectorSunIcon();
    sunIcon.position.set(-1.8, 0.15, 0);
    g.add(sunIcon);

    // Weather temp & range
    const t = this.weatherData.temperature || 24;
    const tMin = this.weatherData.temp_min || 16;
    const tMax = this.weatherData.temp_max || 28;

    const mainText = createHUDText(`TEMP: ${t} C`, { size: 0.40, color: 0xffe600, align: 'left' });
    mainText.position.set(-0.8, 0.25, 0);
    g.add(mainText);

    const rangeText = createHUDText(`RANGE: ${tMin} C - ${tMax} C`, { size: 0.24, color: 0x00e5ff, align: 'left' });
    rangeText.position.set(-0.8, -0.25, 0);
    g.add(rangeText);
  }

  animate(deltaTime, idleElapsedMs, isIdle) {
    // 5) Make the outer cylinder spin separately from the camera around the map!
    this.rotationAngle += this.spinSpeed * deltaTime;
    this.group.rotation.y = this.rotationAngle;

    const now = new Date();

    // 1. Update Clock once per second (Asia/Jerusalem)
    let timeStr = '';
    try {
      timeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(now);
    } catch (e) {
      timeStr = now.toTimeString().substring(0, 8);
    }

    if (timeStr !== this.lastTimeStr && this.dynamicNodes.clockGroup) {
      this.lastTimeStr = timeStr;
      while (this.dynamicNodes.clockGroup.children.length > 0) {
        const obj = this.dynamicNodes.clockGroup.children.pop();
        if (obj.geometry) obj.geometry.dispose();
      }
      const clockMesh = createHUDText(timeStr, { size: 0.58, color: 0x00e5ff, align: 'center' });
      this.dynamicNodes.clockGroup.add(clockMesh);
    }

    // 2. Update Zulu Clock once per second
    const zHours = now.getUTCHours().toString().padStart(2, '0');
    const zMins = now.getUTCMinutes().toString().padStart(2, '0');
    const zSecs = now.getUTCSeconds().toString().padStart(2, '0');
    const zuluStr = `${zHours}:${zMins}:${zSecs} Z`;

    if (zuluStr !== this.lastZuluStr && this.dynamicNodes.zuluGroup) {
      this.lastZuluStr = zuluStr;
      while (this.dynamicNodes.zuluGroup.children.length > 0) {
        const obj = this.dynamicNodes.zuluGroup.children.pop();
        if (obj.geometry) obj.geometry.dispose();
      }
      const zuluMesh = createHUDText(zuluStr, { size: 0.52, color: 0x00ffcc, align: 'center' });
      this.dynamicNodes.zuluGroup.add(zuluMesh);
    }

    // 3. Update Inactivity Countdown (update at 4 Hz to keep CPU at zero)
    const clampedProgress = Math.max(0, Math.min(1.0, idleElapsedMs / 30000.0));
    const remainingSec = Math.max(0, 30.0 * (1 - clampedProgress));
    const roundedSec = remainingSec.toFixed(1);

    if (roundedSec !== this.lastCountdownSec) {
      this.lastCountdownSec = roundedSec;
      const label = isIdle ? '[IDLE ROTATION]' : `${roundedSec}s / 30.0s`;
      const color = isIdle ? 0xffe600 : 0x00e5ff;

      const updateGroup = (grp) => {
        if (!grp) return;
        while (grp.children.length > 0) {
          const obj = grp.children.pop();
          if (obj.geometry) obj.geometry.dispose();
        }
        const textMesh = createHUDText(label, { size: 0.44, color, align: 'center' });
        grp.add(textMesh);
      };

      updateGroup(this.dynamicNodes.countdownGroup);
      updateGroup(this.dynamicNodes.countdownGroup2);
    }
  }
}
