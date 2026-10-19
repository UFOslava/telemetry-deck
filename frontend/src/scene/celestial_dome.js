import * as THREE from 'three';
import { getPosition, getTimes, getMoonPosition, getMoonTimes } from 'suncalc';

export class CelestialDomeManager {
  constructor(scene, camera, domElement, config = {}) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.config = config;

    this.domeRadius = (this.config.radiusKm || 10.0) * 1.35;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.mouseScreen = { x: 0, y: 0 };

    this.sunMesh = null;
    this.moonMesh = null;
    this.sunVectorLine = null;
    this.moonVectorLine = null;

    this.sunData = null;
    this.moonData = null;

    this.satellites = [];
    this.satelliteMeshes = [];
    this.domeMesh = null;
    this.equatorLine = null;

    this.buildDome();
    this.buildCelestialBodies();
    this.initSatellites();
    this.initInteraction();
  }

  setRadius(radiusKm) {
    this.domeRadius = radiusKm * 1.35;

    // Rescale dome mesh and equator ring
    if (this.domeMesh) {
      this.domeMesh.scale.set(this.domeRadius / 13.5, this.domeRadius / 13.5, this.domeRadius / 13.5);
    }
    if (this.equatorLine) {
      this.equatorLine.scale.set(this.domeRadius / 13.5, 1, this.domeRadius / 13.5);
    }

    this.updateCelestialPositions(new Date());
  }

  buildDome() {
    const baseR = 13.5;
    const domeGeo = new THREE.SphereGeometry(
      baseR,
      32,
      16,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5
    );

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x0e3866,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending
    });

    this.domeMesh = new THREE.Mesh(domeGeo, wireframeMat);
    this.domeMesh.scale.set(this.domeRadius / baseR, this.domeRadius / baseR, this.domeRadius / baseR);
    this.group.add(this.domeMesh);

    // Horizon equator ring
    const ringGeo = new THREE.BufferGeometry();
    const ringPts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(Math.cos(a) * baseR, 0, Math.sin(a) * baseR);
    }
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x154c8a,
      transparent: true,
      opacity: 0.4
    });
    this.equatorLine = new THREE.Line(ringGeo, ringMat);
    this.equatorLine.scale.set(this.domeRadius / baseR, 1, this.domeRadius / baseR);
    this.group.add(this.equatorLine);
  }

  buildCelestialBodies() {
    // Sun
    const sunGeo = new THREE.SphereGeometry(0.55, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.userData = { name: 'SOL (SUN)', type: 'sun' };
    this.group.add(this.sunMesh);

    const sunLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const sunLineMat = new THREE.LineDashedMaterial({
      color: 0xffaa00,
      dashSize: 0.8,
      gapSize: 0.4,
      transparent: true,
      opacity: 0.2
    });
    this.sunVectorLine = new THREE.Line(sunLineGeo, sunLineMat);
    this.group.add(this.sunVectorLine);

    // Moon
    const moonGeo = new THREE.SphereGeometry(0.45, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xe0f7fa });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.moonMesh.userData = { name: 'LUNA (MOON)', type: 'moon' };
    this.group.add(this.moonMesh);

    const moonLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const moonLineMat = new THREE.LineDashedMaterial({
      color: 0x00e5ff,
      dashSize: 0.8,
      gapSize: 0.4,
      transparent: true,
      opacity: 0.2
    });
    this.moonVectorLine = new THREE.Line(moonLineGeo, moonLineMat);
    this.group.add(this.moonVectorLine);
  }

  initSatellites() {
    this.satellites = [
      {
        id: 'SAT-01',
        name: 'ISS (ZARYA)',
        norad: '25544',
        altitudeKm: 418,
        velocityKmS: 7.66,
        color: 0x00e5ff,
        theta: 0.2,
        speed: 0.035,
        inclination: 0.65,
        baseAzm: 0.8
      },
      {
        id: 'SAT-02',
        name: 'STARLINK-4102',
        norad: '52891',
        altitudeKm: 550,
        velocityKmS: 7.58,
        color: 0xffe600,
        theta: 0.85,
        speed: 0.042,
        inclination: -0.45,
        baseAzm: 2.4
      },
      {
        id: 'SAT-03',
        name: 'TIANGONG (CSS)',
        norad: '48274',
        altitudeKm: 390,
        velocityKmS: 7.68,
        color: 0x70d8ff,
        theta: 1.4,
        speed: 0.038,
        inclination: 0.82,
        baseAzm: 4.1
      },
      {
        id: 'SAT-04',
        name: 'NOAA-20',
        norad: '43013',
        altitudeKm: 825,
        velocityKmS: 7.42,
        color: 0xff8f00,
        theta: 2.1,
        speed: 0.026,
        inclination: -0.95,
        baseAzm: 5.2
      },
      {
        id: 'SAT-05',
        name: 'SENTINEL-2B',
        norad: '42063',
        altitudeKm: 786,
        velocityKmS: 7.45,
        color: 0x00ffcc,
        theta: 2.7,
        speed: 0.028,
        inclination: 0.35,
        baseAzm: 1.5
      }
    ];

    const satGeo = new THREE.SphereGeometry(0.22, 12, 12);

    this.satellites.forEach(sat => {
      let mesh;
      if (sat.id === 'SAT-01') {
        // 2) ISS: Remove the sphere, leave only the SVG in 3D space, facing the center of the map
        mesh = this.create3DISSVectorModel(sat);
      } else {
        const mat = new THREE.MeshBasicMaterial({
          color: sat.color,
          transparent: true,
          opacity: 0.85
        });
        mesh = new THREE.Mesh(satGeo, mat);
      }
      mesh.userData = { isSatellite: true, satData: sat };
      this.group.add(mesh);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const lineMat = new THREE.LineDashedMaterial({
        color: sat.color,
        dashSize: 0.6,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.15
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.userData = { isSatVector: true, satId: sat.id };
      this.group.add(line);

      this.satelliteMeshes.push({ mesh, line, sat });
    });
  }

  create3DISSVectorModel(sat) {
    const group = new THREE.Group();

    // Central Truss (horizontal girder)
    const trussPositions = [
      -1.4, 0, 0,   1.4, 0, 0,
      -1.4, 0.08, 0, 1.4, 0.08, 0,
      -1.2, 0, 0, -1.0, 0.08, 0,
      -0.8, 0, 0, -0.6, 0.08, 0,
      0.6, 0, 0, 0.8, 0.08, 0,
      1.0, 0, 0, 1.2, 0.08, 0
    ];
    const trussGeo = new THREE.BufferGeometry();
    trussGeo.setAttribute('position', new THREE.Float32BufferAttribute(trussPositions, 3));
    const trussMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.LineSegments(trussGeo, trussMat));

    // Pressurized Module Core (Zarya, Unity, Destiny, Harmony, Columbus, Kibo)
    const corePositions = [
      -0.2, -0.45, 0,   -0.2, 0.45, 0,
      0.2, -0.45, 0,    0.2, 0.45, 0,
      -0.2, -0.45, 0,   0.2, -0.45, 0,
      -0.2, 0.45, 0,    0.2, 0.45, 0,
      0, -0.45, 0, 0, -0.65, 0,
      -0.12, -0.65, 0, 0.12, -0.65, 0,
      0, 0.45, 0, 0, 0.65, 0,
      -0.12, 0.65, 0, 0.12, 0.65, 0
    ];
    const coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.Float32BufferAttribute(corePositions, 3));
    const coreMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.LineSegments(coreGeo, coreMat));

    // Solar Array Wings (4 huge pairs in tactical golden solar yellow)
    const solarPositions = [];
    const solarPanels = [
      { x0: -1.35, x1: -0.9, y0: 0.2, y1: 0.8 },
      { x0: -1.35, x1: -0.9, y0: -0.8, y1: -0.2 },
      { x0: 0.9, x1: 1.35, y0: 0.2, y1: 0.8 },
      { x0: 0.9, x1: 1.35, y0: -0.8, y1: -0.2 }
    ];

    solarPanels.forEach(p => {
      // Outer perimeter
      solarPositions.push(
        p.x0, p.y0, 0,  p.x1, p.y0, 0,
        p.x1, p.y0, 0,  p.x1, p.y1, 0,
        p.x1, p.y1, 0,  p.x0, p.y1, 0,
        p.x0, p.y1, 0,  p.x0, p.y0, 0
      );
      // Photovoltaic cell divider
      const midX = (p.x0 + p.x1) * 0.5;
      solarPositions.push(midX, p.y0, 0, midX, p.y1, 0);
      const stepY = (p.y1 - p.y0) / 3;
      for (let k = 1; k < 3; k++) {
        const y = p.y0 + k * stepY;
        solarPositions.push(p.x0, y, 0, p.x1, y, 0);
      }
    });

    const solarGeo = new THREE.BufferGeometry();
    solarGeo.setAttribute('position', new THREE.Float32BufferAttribute(solarPositions, 3));
    const solarMat = new THREE.LineBasicMaterial({
      color: 0xffe600,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.LineSegments(solarGeo, solarMat));

    // Tactical target reticle circle around ISS
    const reticlePositions = [];
    const reticleSegments = 24;
    const R_ret = 1.55;
    for (let i = 0; i < reticleSegments; i++) {
      const a1 = (i / reticleSegments) * Math.PI * 2;
      const a2 = ((i + 1) / reticleSegments) * Math.PI * 2;
      reticlePositions.push(
        Math.cos(a1) * R_ret, Math.sin(a1) * R_ret, 0,
        Math.cos(a2) * R_ret, Math.sin(a2) * R_ret, 0
      );
    }
    const retGeo = new THREE.BufferGeometry();
    retGeo.setAttribute('position', new THREE.Float32BufferAttribute(reticlePositions, 3));
    const retMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.LineSegments(retGeo, retMat));

    // Invisible spherical hitbox for smooth raycasting / hover
    const hitGeo = new THREE.SphereGeometry(1.5, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.userData = { isSatellite: true, satData: sat };
    group.add(hitMesh);

    return group;
  }

  updateCelestialPositions(date = new Date()) {
    const lat = this.config.centerLat || 32.6595;
    const lon = this.config.centerLon || 35.1090;
    const deg2rad = Math.PI / 180;

    // Sun Position & Times (suncalc v2 returns altitude & azimuth in DEGREES)
    const sunPos = getPosition(date, lat, lon);
    const sunTimes = getTimes(date, lat, lon);

    this.sunData = {
      pos: sunPos,
      times: sunTimes,
      azimuthDeg: sunPos.azimuth.toFixed(1),
      altitudeDeg: sunPos.altitude.toFixed(1),
      rise: sunTimes.sunrise ? this.formatTime(sunTimes.sunrise) : 'N/A',
      set: sunTimes.sunset ? this.formatTime(sunTimes.sunset) : 'N/A'
    };

    // Moon Position & Times
    const moonPos = getMoonPosition(date, lat, lon);
    const moonTimes = getMoonTimes(date, lat, lon);

    this.moonData = {
      pos: moonPos,
      times: moonTimes,
      azimuthDeg: moonPos.azimuth.toFixed(1),
      altitudeDeg: moonPos.altitude.toFixed(1),
      rise: moonTimes.rise ? this.formatTime(moonTimes.rise) : 'N/A',
      set: moonTimes.set ? this.formatTime(moonTimes.set) : 'N/A'
    };

    // Calculate Cartesian ENU Vector for Sun
    // Azimuth 0 = North (-z), 90 = East (+x), 180 = South (+z), 270 = West (-x)
    if (sunPos.altitude > 0) {
      this.sunMesh.visible = true;
      const altRad = sunPos.altitude * deg2rad;
      const azmRad = sunPos.azimuth * deg2rad;

      const x = this.domeRadius * Math.cos(altRad) * Math.sin(azmRad);
      const y = this.domeRadius * Math.sin(altRad);
      const z = -this.domeRadius * Math.cos(altRad) * Math.cos(azmRad);

      this.sunMesh.position.set(x, y, z);
      this.sunVectorLine.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(x, y, z)]);
      this.sunVectorLine.computeLineDistances();
      this.sunVectorLine.visible = true;
    } else {
      this.sunMesh.visible = false;
      this.sunVectorLine.visible = false;
    }

    // Calculate Cartesian ENU Vector for Moon
    if (moonPos.altitude > 0) {
      this.moonMesh.visible = true;
      const altRad = moonPos.altitude * deg2rad;
      const azmRad = moonPos.azimuth * deg2rad;

      const x = this.domeRadius * Math.cos(altRad) * Math.sin(azmRad);
      const y = this.domeRadius * Math.sin(altRad);
      const z = -this.domeRadius * Math.cos(altRad) * Math.cos(azmRad);

      this.moonMesh.position.set(x, y, z);
      this.moonVectorLine.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(x, y, z)]);
      this.moonVectorLine.computeLineDistances();
      this.moonVectorLine.visible = true;
    } else {
      this.moonMesh.visible = false;
      this.moonVectorLine.visible = false;
    }
  }

  updateSatellites(deltaTime) {
    const R_E = 6371.0;

    this.satelliteMeshes.forEach(({ mesh, line, sat }) => {
      sat.theta = (sat.theta + sat.speed * deltaTime) % (Math.PI * 1.3);

      if (sat.theta <= Math.PI) {
        mesh.visible = true;
        line.visible = true;

        const alt = Math.sin(sat.theta) * 0.95; // radians (0 to ~1.0)
        const azm = sat.baseAzm + sat.inclination * Math.cos(sat.theta);

        const h = sat.altitudeKm;
        const sinAlt = Math.sin(alt);
        const slantRange = Math.sqrt(R_E * R_E * sinAlt * sinAlt + 2 * R_E * h + h * h) - R_E * sinAlt;
        const dimFactor = Math.min(1.0, Math.max(0.12, Math.pow(h / slantRange, 1.35)));
        if (sat.id === 'SAT-01') {
          // 3D vector model of ISS
        } else if (mesh.material) {
          mesh.material.opacity = dimFactor;
        }
        const scale = 0.6 + dimFactor * 0.7;
        mesh.scale.set(scale, scale, scale);

        // ENU placement
        const x = this.domeRadius * Math.cos(alt) * Math.sin(azm);
        const y = this.domeRadius * Math.sin(alt);
        const z = -this.domeRadius * Math.cos(alt) * Math.cos(azm);
        mesh.position.set(x, y, z);

        if (sat.id === 'SAT-01') {
          mesh.lookAt(0, 0, 0);
        }

        line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(x, y, z)]);
        line.computeLineDistances();

        sat.currentAltDeg = (alt * 180 / Math.PI).toFixed(1);
        sat.currentAzmDeg = (((azm * 180 / Math.PI) % 360 + 360) % 360).toFixed(1);
        sat.currentSlantRangeKm = Math.round(slantRange);
        sat.dimFactor = dimFactor;
      } else {
        mesh.visible = false;
        line.visible = false;
      }
    });
  }

  formatTime(date) {
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  initInteraction() {
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouseScreen = { x: e.clientX, y: e.clientY };
    });
  }

  checkHover() {
    if (!this.camera) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const interactables = [];
    if (this.sunMesh && this.sunMesh.visible) interactables.push(this.sunMesh);
    if (this.moonMesh && this.moonMesh.visible) interactables.push(this.moonMesh);
    this.satelliteMeshes.forEach(({ mesh }) => {
      if (mesh.visible) interactables.push(mesh);
    });

    const intersects = this.raycaster.intersectObjects(interactables, false);

    if (this.sunVectorLine) this.sunVectorLine.material.opacity = 0.2;
    if (this.moonVectorLine) this.moonVectorLine.material.opacity = 0.2;
    this.satelliteMeshes.forEach(({ line }) => {
      line.material.opacity = 0.15;
    });

    const popup = document.getElementById('celestial-tooltip');

    if (intersects.length > 0) {
      const hit = intersects[0].object;

      if (hit.userData.isSatellite) {
        const sat = hit.userData.satData;
        const entry = this.satelliteMeshes.find(s => s.sat.id === sat.id);
        if (entry) entry.line.material.opacity = 1.0;

        if (popup) {
          popup.style.display = 'block';
          popup.style.left = `${this.mouseScreen.x + 15}px`;
          popup.style.top = `${this.mouseScreen.y - 40}px`;
          popup.style.borderColor = `#${sat.color.toString(16).padStart(6, '0')}`;
          popup.innerHTML = `
            <div style="font-weight: bold; color: #${sat.color.toString(16).padStart(6, '0')}; margin-bottom: 3px;">
              [LEO SAT] ${sat.name} #${sat.norad}
            </div>
            <div>ALTITUDE: ${sat.altitudeKm} KM | VELOCITY: ${sat.velocityKmS} KM/S</div>
            <div>SLANT RANGE: ${sat.currentSlantRangeKm} KM | ELEV: ${sat.currentAltDeg}°</div>
            <div>AZIMUTH: ${sat.currentAzmDeg}° | BRIGHTNESS: ${Math.round(sat.dimFactor * 100)}%</div>
          `;
        }
      } else {
        const isSun = hit.userData.type === 'sun';
        const data = isSun ? this.sunData : this.moonData;
        const line = isSun ? this.sunVectorLine : this.moonVectorLine;

        if (line) line.material.opacity = 1.0;

        if (popup && data) {
          popup.style.display = 'block';
          popup.style.left = `${this.mouseScreen.x + 15}px`;
          popup.style.top = `${this.mouseScreen.y - 40}px`;
          popup.style.borderColor = isSun ? '#ffaa00' : '#00e5ff';
          popup.innerHTML = `
            <div style="font-weight: bold; color: ${isSun ? '#ffaa00' : '#00e5ff'}; margin-bottom: 3px;">
              ${hit.userData.name}
            </div>
            <div>ALT: ${data.altitudeDeg}° | AZM: ${data.azimuthDeg}°</div>
            <div>RISE: ${data.rise} | SET: ${data.set}</div>
          `;
        }
      }
    } else {
      if (popup) popup.style.display = 'none';
    }
  }

  getISSScreenPosition(width, height) {
    const issEntry = this.satelliteMeshes.find(s => s.sat.id === 'SAT-01');
    if (!issEntry || !issEntry.mesh.visible) return null;

    const v = new THREE.Vector3();
    issEntry.mesh.getWorldPosition(v);
    v.project(this.camera);

    // Behind the camera frustum?
    if (v.z > 1.0) return null;

    const screenX = (v.x * 0.5 + 0.5) * width;
    const screenY = (-(v.y * 0.5) + 0.5) * height;

    return {
      x: screenX,
      y: screenY,
      sat: issEntry.sat,
      altDeg: issEntry.sat.currentAltDeg || '42.0',
      azmDeg: issEntry.sat.currentAzmDeg || '128.5',
      slantKm: issEntry.sat.currentSlantRangeKm || 512,
      visible: true
    };
  }
}

