import * as THREE from 'three';
import { createHUDText, FONT_MODE } from './vector_font.js';

/**
 * Spatial 3D Vector Flags Manager (Option 1)
 * Renders pure 3D vector wireframe frames, dark translucent backings,
 * and pure 3D vector stroke line glyphs in WebGL world space (Zero raster flicker, zero 2D SVG text).
 */
export class SpatialFlagsManager {
  constructor(scene, camera, svgOverlay = null, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.svgOverlay = svgOverlay;
    this.onSelect = options.onSelect || null;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.entities = [];
    this.flagsMap = new Map(); // id -> { rootGroup, callsignMesh, speedMesh, lineMesh, tachoLine, backingMesh }
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);

    this.initInteraction();
  }

  initInteraction() {
    window.addEventListener('click', (e) => {
      // Only process clicks on the main canvas
      if (e.target.tagName !== 'CANVAS') return;

      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hitboxes = [];
      this.flagsMap.forEach(rec => {
        if (rec.hitboxMesh && rec.flagRoot.visible) {
          hitboxes.push(rec.hitboxMesh);
        }
      });

      const intersects = this.raycaster.intersectObjects(hitboxes, false);
      if (intersects.length > 0) {
        const ent = intersects[0].object.userData.entity;
        if (ent && this.onSelect) {
          this.onSelect(ent);
        }
      }
    });
  }

  updateEntities(entities) {
    this.entities = entities;
    this.rebuild3DFrames();
  }

  rebuild3DFrames() {
    // Clear old 3D vector frames
    while (this.group.children.length > 0) {
      const obj = this.group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.flagsMap.clear();

    const backingMat = new THREE.MeshBasicMaterial({
      color: 0x010f1e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const fw = 1.6;
    const fh = 0.65;
    const hw = fw * 0.5;
    const hh = fh * 0.5;
    const c = 0.12; // corner bracket size

    this.entities.forEach(ent => {
      const isTrain = ent.type === 'train';
      const frameColor = isTrain ? 0xffffff : (ent.line === '180' ? 0xffe600 : 0x00e5ff);
      const speed = Math.round(ent.speedKmh || 60);
      const badge = ent.callsign || ent.id;

      const flagRoot = new THREE.Group();
      this.group.add(flagRoot);

      // 1. 3D Translucent Backing Plane
      const planeGeo = new THREE.PlaneGeometry(fw, fh);
      const backingMesh = new THREE.Mesh(planeGeo, backingMat);
      backingMesh.position.set(0, 0, -0.005);
      flagRoot.add(backingMesh);

      // Enlarged Selection Hitbox (60% larger area) for effortless clicking/tapping
      const hitGeo = new THREE.PlaneGeometry(fw * 1.6, fh * 1.8);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitboxMesh = new THREE.Mesh(hitGeo, hitMat);
      hitboxMesh.position.set(0, 0, 0.05);
      hitboxMesh.userData = { entity: ent };
      flagRoot.add(hitboxMesh);

      // 2. 3D Vector Wireframe Border & Corner Brackets
      const borderPts = [
        -hw, -hh, 0,  hw, -hh, 0,
         hw, -hh, 0,  hw,  hh, 0,
         hw,  hh, 0, -hw,  hh, 0,
        -hw,  hh, 0, -hw, -hh, 0,

        // Inner corner brackets
        -hw + c, -hh + c, 0, -hw, -hh + c, 0,
        -hw + c, -hh + c, 0, -hw + c, -hh, 0,
         hw - c,  hh - c, 0,  hw,  hh - c, 0,
         hw - c,  hh - c, 0,  hw - c,  hh, 0
      ];
      const frameGeo = new THREE.BufferGeometry();
      frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
      const frameMat = new THREE.LineBasicMaterial({
        color: frameColor,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      const lineFrame = new THREE.LineSegments(frameGeo, frameMat);
      flagRoot.add(lineFrame);

      // 3. Option 1: 3D Vector Stroke Text (HUD Glyphs in WebGL)
      // Callsign line: [BUS 180]
      const callsignMesh = createHUDText(`[${badge}]`, {
        size: 0.11,
        color: frameColor,
        opacity: 1.0,
        align: 'left'
      });
      callsignMesh.position.set(-hw + 0.1, hh - 0.18, 0.01);
      flagRoot.add(callsignMesh);

      // Speed readout: SPD: 60 KM/H
      const speedMesh = createHUDText(`SPD: ${speed} KM/H`, {
        size: 0.085,
        color: 0xe0f7fa,
        opacity: 0.9,
        align: 'left'
      });
      speedMesh.position.set(-hw + 0.1, hh - 0.35, 0.01);
      flagRoot.add(speedMesh);

      // Route info: BUS // LINE 180
      const routeText = isTrain ? 'RAIL // HAEMEK' : `BUS // LINE ${ent.line}`;
      const lineMesh = createHUDText(routeText, {
        size: 0.075,
        color: 0x70d8ff,
        opacity: 0.85,
        align: 'left'
      });
      lineMesh.position.set(-hw + 0.1, hh - 0.50, 0.01);
      flagRoot.add(lineMesh);

      // 4. Tachometer Velocity Gauge Bar in 3D lines
      const tachoW = 0.38;
      const tachoX = hw - tachoW - 0.08;
      const tachoY = hh - 0.48;
      const tachoPts = [
        tachoX, tachoY, 0.01,
        tachoX + tachoW, tachoY, 0.01,
        tachoX + tachoW, tachoY - 0.04, 0.01,
        tachoX, tachoY - 0.04, 0.01,
        tachoX, tachoY, 0.01,
        tachoX, tachoY - 0.04, 0.01
      ];
      const tachoGeo = new THREE.BufferGeometry();
      tachoGeo.setAttribute('position', new THREE.Float32BufferAttribute(tachoPts, 3));
      const tachoMat = new THREE.LineBasicMaterial({
        color: frameColor,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      const tachoLine = new THREE.Line(tachoGeo, tachoMat);
      flagRoot.add(tachoLine);

      // 5. Diagonal Guide Struts connecting Drop-Pin to 3D Flag
      const strutGeo = new THREE.BufferGeometry();
      const strutMat = new THREE.LineBasicMaterial({
        color: frameColor,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
      });
      const strutLines = new THREE.LineSegments(strutGeo, strutMat);
      this.group.add(strutLines);

      this.flagsMap.set(ent.id, {
        flagRoot,
        backingMesh,
        hitboxMesh,
        callsignMesh,
        speedMesh,
        lineMesh,
        tachoLine,
        strutLines,
        hw,
        hh
      });
    });
  }

  update3DPositions(cameraYaw) {
    this.entities.forEach(ent => {
      const record = this.flagsMap.get(ent.id);
      if (!record) return;

      const flagOffset = 1.05;
      const fx = ent.x + Math.sin(cameraYaw + 0.5) * flagOffset;
      const fy = ent.y + 0.42;
      const fz = ent.z + Math.cos(cameraYaw + 0.5) * flagOffset;

      // Position and billboard flag frame to camera yaw
      record.flagRoot.position.set(fx, fy, fz);
      record.flagRoot.rotation.set(0, cameraYaw, 0);

      // Update dynamic speed readout
      const speed = Math.round(ent.speedKmh || 60);
      if (record.speedMesh.setText) {
        record.speedMesh.setText(`SPD: ${speed} KM/H`);
      }

      // Update diagonal struts from pin to 3D frame in world space
      const strutPts = [
        ent.x, ent.y, ent.z, fx - record.hw * Math.cos(cameraYaw), fy - 0.1, fz + record.hw * Math.sin(cameraYaw),
        ent.x, ent.y, ent.z, fx - record.hw * Math.cos(cameraYaw), fy + 0.1, fz + record.hw * Math.sin(cameraYaw)
      ];
      record.strutLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(strutPts, 3));
    });
  }

  // Legacy SVG method no longer needed since everything is 3D WebGL vector stroke text!
  renderVectorSVG() {
    return '';
  }
}
