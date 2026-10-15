import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

export class RouteInspectionPlane {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.planeGroup = new THREE.Group();
    this.scene.add(this.planeGroup);

    this.planeHeight = 2.2; // Elevation plane height in km above ground
    this.selectedBus = null;

    this.routeLine = null;
    this.tetherLines = null;
    this.stopNodes = [];
    this.planeGrid = null;

    this.initPlaneGrid();
  }

  initPlaneGrid() {
    // Semi-transparent elevated tactical projection disk
    const radius = 10.0;
    const segments = 64;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      pts.push(Math.cos(theta) * radius, this.planeHeight, Math.sin(theta) * radius);
    }
    const borderGeo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x || 0, this.planeHeight, p.z || 0)));
    
    // Grid lines on elevated plane
    const gridPositions = [];
    const step = 2.0;
    for (let x = -8; x <= 8; x += step) {
      for (let z = -8; z <= 8; z += step) {
        if (x * x + z * z < 64) {
          gridPositions.push(x, this.planeHeight, -8, x, this.planeHeight, 8);
          gridPositions.push(-8, this.planeHeight, z, 8, this.planeHeight, z);
        }
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending
    });
    this.planeGrid = new THREE.LineSegments(gridGeo, gridMat);
    this.planeGroup.add(this.planeGrid);
    this.planeGroup.visible = false;
  }

  selectBus(bus) {
    this.selectedBus = bus;
    if (!bus || !bus.roadPath) {
      this.clear();
      return;
    }

    this.planeGroup.visible = true;
    this.rebuildElevatedRoute(bus);
    this.renderInfoPanel(bus);
  }

  clear() {
    this.selectedBus = null;
    this.planeGroup.visible = false;
    const panel = document.getElementById('transit-route-panel');
    if (panel) panel.style.display = 'none';
  }

  rebuildElevatedRoute(bus) {
    // Clear old route geometry
    while (this.planeGroup.children.length > 1) { // keep planeGrid
      const obj = this.planeGroup.children[1];
      this.planeGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    const path = bus.roadPath;
    const elevatedPts = [];
    const tethers = [];

    path.forEach((pt) => {
      elevatedPts.push(new THREE.Vector3(pt.x, this.planeHeight, pt.z));
      // Tethers from ground to elevated plane
      tethers.push(pt.x, pt.y, pt.z);
      tethers.push(pt.x, this.planeHeight, pt.z);
    });

    // Elevated Route Ribbon
    const routeGeo = new THREE.BufferGeometry().setFromPoints(elevatedPts);
    const routeMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const line = new THREE.Line(routeGeo, routeMat);
    this.planeGroup.add(line);

    // Connecting Guide Tethers
    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute('position', new THREE.Float32BufferAttribute(tethers, 3));
    const tetherMat = new THREE.LineDashedMaterial({
      color: 0x00e5ff,
      dashSize: 0.3,
      gapSize: 0.2,
      transparent: true,
      opacity: 0.35
    });
    const tetherObj = new THREE.LineSegments(tetherGeo, tetherMat);
    tetherObj.computeLineDistances();
    this.planeGroup.add(tetherObj);

    // Stop nodes along the route with 3D vector stroke text
    const stopCount = 5;
    const stopGeo = new THREE.SphereGeometry(0.12, 10, 10);
    const stopMat = new THREE.MeshBasicMaterial({ color: 0xffe600 });

    for (let s = 0; s < stopCount; s++) {
      const idx = Math.floor((s / (stopCount - 1)) * (path.length - 1));
      const p = path[idx];
      const sphere = new THREE.Mesh(stopGeo, stopMat);
      sphere.position.set(p.x, this.planeHeight, p.z);
      this.planeGroup.add(sphere);

      const stopLabel = createHUDText(`STOP 0${s + 1}`, {
        size: 0.11,
        color: 0xffe600,
        opacity: 0.9,
        align: 'center'
      });
      stopLabel.position.set(p.x, this.planeHeight + 0.22, p.z);
      stopLabel.rotation.x = -Math.PI * 0.35; // Tilted slightly towards camera
      this.planeGroup.add(stopLabel);
    }
  }

  renderInfoPanel(bus) {
    let panel = document.getElementById('transit-route-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'transit-route-panel';
      document.body.appendChild(panel);
    }

    panel.style.display = 'block';
    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #00e5ff; padding-bottom: 6px; margin-bottom: 8px;">
        <span style="font-weight: bold; color: #00e5ff; letter-spacing: 1px;">[ROUTE INSPECTION]</span>
        <span id="close-route-panel" style="cursor: pointer; color: #ff6a00; font-size: 14px;">&times;</span>
      </div>
      <div style="font-size: 13px; font-weight: bold; color: #ffe600; margin-bottom: 4px;">
        ${bus.callsign}
      </div>
      <div style="font-size: 10px; color: #70d8ff; margin-bottom: 6px;">
        OPERATOR: SUPERBUS / EGGED | LINE ${bus.line}
      </div>
      <div style="font-size: 10px; line-height: 1.6; color: #e0f7fa;">
        <div>SPEED: ${Math.round(bus.speedKmh)} km/h</div>
        <div>STATUS: ON-TIME (GPS SYNC)</div>
        <div style="margin-top: 6px; font-weight: bold; color: #00e5ff;">UPCOMING STOPS:</div>
        <div>1. Yokneam Central Mall - 2 min</div>
        <div>2. HaZayit / Rabin Blvd - 6 min</div>
        <div>3. Yokneam Hi-Tech Park - 11 min</div>
        <div>4. Route 70 Interchange - 17 min</div>
      </div>
    `;

    document.getElementById('close-route-panel').addEventListener('click', () => {
      this.clear();
    });
  }
}
