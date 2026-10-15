import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

export class TrainStationManager {
  constructor(scene, camera, svgOverlay = null, config = {}) {
    this.scene = scene;
    this.camera = camera;
    this.svgOverlay = svgOverlay;
    this.config = config;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Exact surveyed coordinates from OSM rail siding 432811340
    this.stations = [
      {
        id: 'STN-YOKNEAM',
        name: 'YOKNEAM - KFAR YEHOSHUA',
        hebrewName: 'תחנת הרכבת יקנעם - כפר יהושע',
        lat: 32.6804, // Corrected exact platform coordinates
        lon: 35.1266,
        line: 'Jezreel Valley Line (HaEmek)',
        // Hourly scheduled departures (both directions)
        scheduleMinutes: [
          { minute: 18, trainNum: 'TR-084', dest: 'HAIFA HOF HACARMEL', platform: '1' },
          { minute: 42, trainNum: 'TR-085', dest: 'BEIT SHE\'AN', platform: '2' }
        ]
      }
    ];

    this.stationObjects = [];
  }

  buildStations(elevationSampler = null) {
    while (this.group.children.length > 0) {
      const obj = this.group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.stationObjects = [];

    const R_EARTH_KM = 6371.0;
    const rad = Math.PI / 180;
    const lat0 = (this.config.centerLat || 32.6595) * rad;
    const lon0 = (this.config.centerLon || 35.1090) * rad;
    const maxRadius = this.config.radiusKm || 10.0;

    this.stations.forEach(stn => {
      const phi = stn.lat * rad;
      const lam = stn.lon * rad;
      const x = R_EARTH_KM * (lam - lon0) * Math.cos((phi + lat0) * 0.5);
      const z = -R_EARTH_KM * (phi - lat0);

      const dist = Math.sqrt(x * x + z * z);
      if (dist <= maxRadius) {
        const yGround = (elevationSampler ? elevationSampler(stn.lat, stn.lon) : 0.05) + 0.05;

        // 1. Tactical Station Reticle on Tracks (Diamond)
        const size = 0.45;
        const pts = [
          new THREE.Vector3(x, yGround, z - size),
          new THREE.Vector3(x + size, yGround, z),
          new THREE.Vector3(x, yGround, z + size),
          new THREE.Vector3(x - size, yGround, z),
          new THREE.Vector3(x, yGround, z - size)
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending
        });
        const reticle = new THREE.Line(geo, mat);
        this.group.add(reticle);

        // 2. Vertical drop pin beacon (Center Pivot)
        const beaconHeight = 1.35;
        const beaconPts = [
          new THREE.Vector3(x, yGround, z),
          new THREE.Vector3(x, yGround + beaconHeight, z)
        ];
        const beaconGeo = new THREE.BufferGeometry().setFromPoints(beaconPts);
        const beaconMat = new THREE.LineBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.9
        });
        const beacon = new THREE.Line(beaconGeo, beaconMat);
        this.group.add(beacon);

        // Terminal Beacon Head Sphere
        const sphereGeo = new THREE.SphereGeometry(0.15, 12, 12);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.set(x, yGround + beaconHeight, z);
        this.group.add(sphere);

        // 3. Option 1: 3D Vector Stroke Flag Banner in WebGL world space
        const flagGroup = new THREE.Group();
        this.group.add(flagGroup);

        const flagW = 3.2;
        const flagH = 1.15;
        const hw = flagW * 0.5;
        const hh = flagH * 0.5;

        // Translucent Backing Plane
        const backingGeo = new THREE.PlaneGeometry(flagW, flagH);
        const backingMat = new THREE.MeshBasicMaterial({
          color: 0x010f1e,
          transparent: true,
          opacity: 0.88,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const backingMesh = new THREE.Mesh(backingGeo, backingMat);
        backingMesh.position.set(0, 0, -0.005);
        flagGroup.add(backingMesh);

        // Wireframe border & bracket accents
        const borderPts = [
          -hw, -hh, 0,  hw, -hh, 0,
           hw, -hh, 0,  hw,  hh, 0,
           hw,  hh, 0, -hw,  hh, 0,
          -hw,  hh, 0, -hw, -hh, 0,
          // Header divider
          -hw, hh - 0.32, 0, hw, hh - 0.32, 0,
          // Middle row divider
          -hw, -0.05, 0, hw, -0.05, 0
        ];
        const frameGeo = new THREE.BufferGeometry();
        frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
        const frameMat = new THREE.LineBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending
        });
        const lineFrame = new THREE.LineSegments(frameGeo, frameMat);
        flagGroup.add(lineFrame);

        // 3D Vector Text Header
        const headerMesh = createHUDText(`[STN] ${stn.name}`, {
          size: 0.12,
          color: 0xffffff,
          opacity: 1.0,
          align: 'left'
        });
        headerMesh.position.set(-hw + 0.12, hh - 0.22, 0.01);
        flagGroup.add(headerMesh);

        // Dynamic Rows for Departures
        const rowObjects = [];
        [0, 1].forEach((rowIdx) => {
          const rowY = rowIdx === 0 ? 0.08 : -0.42;

          // Train ID & Dest text
          const trainText = createHUDText(`TR-08${4 + rowIdx} -> HAIFA`, {
            size: 0.09,
            color: 0xffe600,
            opacity: 0.95,
            align: 'left'
          });
          trainText.position.set(-hw + 0.12, rowY + 0.12, 0.01);
          flagGroup.add(trainText);

          // Subtext: Dest
          const destText = createHUDText(rowIdx === 0 ? 'HAIFA HOF HACARMEL' : 'BEIT SHE\'AN', {
            size: 0.075,
            color: 0x70d8ff,
            opacity: 0.85,
            align: 'left'
          });
          destText.position.set(-hw + 0.12, rowY - 0.02, 0.01);
          flagGroup.add(destText);

          // 30m Countdown Bar Container (Right side)
          const barW = 1.15;
          const barH = 0.20;
          const barX = hw - barW - 0.12;
          const barBoxPts = [
            barX, rowY + 0.02, 0.01, barX + barW, rowY + 0.02, 0.01,
            barX + barW, rowY + 0.02, 0.01, barX + barW, rowY - barH + 0.02, 0.01,
            barX + barW, rowY - barH + 0.02, 0.01, barX, rowY - barH + 0.02, 0.01,
            barX, rowY - barH + 0.02, 0.01, barX, rowY + 0.02, 0.01
          ];
          const barBoxGeo = new THREE.BufferGeometry();
          barBoxGeo.setAttribute('position', new THREE.Float32BufferAttribute(barBoxPts, 3));
          const barBoxMat = new THREE.LineBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending
          });
          const barBoxMesh = new THREE.LineSegments(barBoxGeo, barBoxMat);
          flagGroup.add(barBoxMesh);

          // Draining fill lines (hatch pattern inside the bar)
          const fillGeo = new THREE.BufferGeometry();
          const fillMat = new THREE.LineBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending
          });
          const fillMesh = new THREE.LineSegments(fillGeo, fillMat);
          flagGroup.add(fillMesh);

          // Countdown readout inside the bar
          const countdownMesh = createHUDText(`-24:18`, {
            size: 0.08,
            color: 0xffe600,
            opacity: 1.0,
            align: 'right'
          });
          countdownMesh.position.set(barX + barW - 0.05, rowY - 0.10, 0.02);
          flagGroup.add(countdownMesh);

          rowObjects.push({
            trainText,
            destText,
            barX,
            barW,
            barH,
            rowY,
            fillMesh,
            countdownMesh
          });
        });

        // Guide tether connecting drop-pin top to flag banner
        const tetherPts = [
          x, yGround + beaconHeight, z,
          x + 0.6, yGround + beaconHeight + 0.2, z
        ];
        const tetherGeo = new THREE.BufferGeometry();
        tetherGeo.setAttribute('position', new THREE.Float32BufferAttribute(tetherPts, 3));
        const tetherMat = new THREE.LineBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.85
        });
        const tetherLine = new THREE.Line(tetherGeo, tetherMat);
        this.group.add(tetherLine);

        this.stationObjects.push({
          station: stn,
          pinPos: new THREE.Vector3(x, yGround + beaconHeight, z),
          flagGroup,
          rowObjects,
          tetherLine,
          flagW,
          flagH
        });
      }
    });
  }

  getUpcomingTrains(stn, now = new Date()) {
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();
    const currentTotalSec = currentMin * 60 + currentSec;

    const upcoming = [];

    [0, 1].forEach(hourOffset => {
      const h = (currentHour + hourOffset) % 24;
      stn.scheduleMinutes.forEach(sched => {
        const schedTotalSec = (hourOffset * 60 + sched.minute) * 60;
        const remainingSec = schedTotalSec - currentTotalSec;

        if (remainingSec > 0 && remainingSec <= 1800) {
          const depHourStr = h.toString().padStart(2, '0');
          const depMinStr = sched.minute.toString().padStart(2, '0');
          const remMin = Math.floor(remainingSec / 60);
          const remSec = remainingSec % 60;
          const fraction = Math.max(0, Math.min(1, remainingSec / 1800.0));

          upcoming.push({
            trainNum: sched.trainNum,
            dest: sched.dest,
            platform: sched.platform,
            depTime: `${depHourStr}:${depMinStr}`,
            remainingStr: `${remMin.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`,
            fraction: fraction,
            remainingSec: remainingSec
          });
        }
      });
    });

    upcoming.sort((a, b) => a.remainingSec - b.remainingSec);

    if (upcoming.length === 0) {
      const nextMin = (currentMin < 18) ? 18 : (currentMin < 42 ? 42 : 18);
      const nextHour = (currentMin >= 42) ? (currentHour + 1) % 24 : currentHour;
      const sched = (nextMin === 18) ? stn.scheduleMinutes[0] : stn.scheduleMinutes[1];
      const diffMin = ((nextHour - currentHour + 24) % 24) * 60 + (nextMin - currentMin);
      upcoming.push({
        trainNum: sched.trainNum,
        dest: sched.dest,
        platform: sched.platform,
        depTime: `${nextHour.toString().padStart(2, '0')}:${nextMin.toString().padStart(2, '0')}`,
        remainingStr: `${diffMin}m`,
        fraction: 0.12,
        remainingSec: diffMin * 60
      });
    }

    return upcoming;
  }

  update3DPositions(cameraYaw) {
    const now = new Date();

    this.stationObjects.forEach(obj => {
      const pin = obj.pinPos;
      const upcoming = this.getUpcomingTrains(obj.station, now);

      // Offset the 3D flag banner from the drop-pin
      const flagOffset = 2.0;
      const fx = pin.x + Math.sin(cameraYaw + 0.6) * flagOffset;
      const fy = pin.y + 0.65;
      const fz = pin.z + Math.cos(cameraYaw + 0.6) * flagOffset;

      obj.flagGroup.position.set(fx, fy, fz);
      obj.flagGroup.rotation.set(0, cameraYaw, 0);

      // Update tether line from pin to flag
      const tetherPts = [
        pin.x, pin.y, pin.z,
        fx - (obj.flagW * 0.5) * Math.cos(cameraYaw), fy, fz + (obj.flagW * 0.5) * Math.sin(cameraYaw)
      ];
      obj.tetherLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(tetherPts, 3));

      // Update departure rows & draining countdown bar in 3D lines
      obj.rowObjects.forEach((row, idx) => {
        const train = upcoming[idx] || upcoming[0];
        if (!train) return;

        // Train text
        if (row.trainText.setText) {
          row.trainText.setText(`${train.trainNum} [P${train.platform}]`);
        }
        if (row.destText.setText) {
          row.destText.setText(`-> ${train.dest}`);
        }

        // Countdown text
        if (row.countdownMesh.setText) {
          row.countdownMesh.setText(`-${train.remainingStr}`);
        }

        // Draining progress bar hatch lines
        const frac = Math.max(0.04, Math.min(1.0, train.fraction));
        const activeW = (row.barW - 0.04) * frac;
        const numHatches = Math.floor(activeW * 18);
        const hatchPts = [];

        for (let h = 0; h < numHatches; h++) {
          const hx = row.barX + 0.02 + (h / 18);
          hatchPts.push(
            hx, row.rowY + 0.01, 0.015,
            hx, row.rowY - row.barH + 0.03, 0.015
          );
        }

        row.fillMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(hatchPts, 3));
      });
    });
  }

  // Legacy 2D label method - returns empty string since everything is in 3D WebGL lines
  render2DLabels() {
    return '';
  }
}
