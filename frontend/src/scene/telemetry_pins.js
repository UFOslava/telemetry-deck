import * as THREE from 'three';

export class TelemetryPinsManager {
  constructor(scene, camera, svgOverlay, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.svgOverlay = svgOverlay;
    this.onSelect = options.onSelect || null;
    
    this.pinsGroup = new THREE.Group();
    this.scene.add(this.pinsGroup);
    
    this.entities = [];
    this.selectedEntity = null;
    this.flightMat = new THREE.MeshBasicMaterial({ color: 0xff6a00 });
    this.transitMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    this.trainMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.tetherMat = new THREE.LineBasicMaterial({
      color: 0xff8f00,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    this.sphereGeo = new THREE.SphereGeometry(0.18, 12, 12);
    this.hitGeo = new THREE.SphereGeometry(0.55, 8, 8);
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.initInteraction();
  }

  initInteraction() {
    window.addEventListener('click', (e) => {
      if (e.target.tagName !== 'CANVAS') return;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hitboxes = this.pinsGroup.children.filter(c => c.userData && c.userData.entity);
      const intersects = this.raycaster.intersectObjects(hitboxes, false);
      if (intersects.length > 0) {
        const ent = intersects[0].object.userData.entity;
        if (ent && this.onSelect) {
          this.onSelect(ent);
        }
      }
    });
  }

  setEntities(entities) {
    this.entities = entities;
    this.rebuild3DMeshes();
  }

  rebuild3DMeshes() {
    while (this.pinsGroup.children.length > 0) {
      const obj = this.pinsGroup.children.pop();
      if (obj.geometry && obj.geometry !== this.sphereGeo && obj.geometry !== this.hitGeo) obj.geometry.dispose();
    }

    const tethers = [];

    this.entities.forEach(ent => {
      let mat = this.flightMat;
      if (ent.type === 'transit') mat = this.transitMat;
      if (ent.type === 'train') mat = this.trainMat;

      const sphere = new THREE.Mesh(this.sphereGeo, mat);
      sphere.position.set(ent.x, ent.y, ent.z);
      this.pinsGroup.add(sphere);

      // Selection hitbox around the drop pin
      const hitMesh = new THREE.Mesh(this.hitGeo, this.hitMat);
      hitMesh.position.set(ent.x, ent.y, ent.z);
      hitMesh.userData = { entity: ent };
      this.pinsGroup.add(hitMesh);

      // Vertical Drop-Pin line to ground (ent.groundY or 0)
      const ground = ent.groundY || 0;
      tethers.push(ent.x, ent.y, ent.z);
      tethers.push(ent.x, ground, ent.z);
    });

    if (tethers.length > 0) {
      const tetherGeo = new THREE.BufferGeometry();
      tetherGeo.setAttribute('position', new THREE.Float32BufferAttribute(tethers, 3));
      const tetherLines = new THREE.LineSegments(tetherGeo, this.tetherMat);
      this.pinsGroup.add(tetherLines);
    }
  }

  updateSimulation(deltaTime, roadManager = null, elevationSampler = null) {
    this.entities.forEach(ent => {
      if (ent.type === 'flight') {
        // High altitude airspace dead-reckoning
        if (ent.vx !== undefined && ent.vz !== undefined) {
          ent.x += ent.vx * deltaTime;
          ent.z += ent.vz * deltaTime;

          const r = Math.sqrt(ent.x * ent.x + ent.z * ent.z);
          if (r > 10.5) {
            ent.x = -ent.x * 0.95;
            ent.z = -ent.z * 0.95;
          }
        }
      } else if (ent.roadPath && ent.roadPath.length >= 2) {
        // Smooth physical pacing along multi-kilometer route
        const pathLen = ent.pathLengthKm || 8.0;
        // Pacing factor: 2.5x real-time speed for realistic visible movement
        const deltaProg = ((ent.speedKmh || 60) / 3600.0) * deltaTime * 2.5 / pathLen;
        
        ent.direction = ent.direction || 1;
        ent.pathProgress = (ent.pathProgress || 0) + deltaProg * ent.direction;

        // Smooth turnaround at terminus without sudden teleporting or snapping
        if (ent.pathProgress >= 1.0) {
          ent.pathProgress = 1.0;
          ent.direction = -1;
        } else if (ent.pathProgress <= 0.0) {
          ent.pathProgress = 0.0;
          ent.direction = 1;
        }

        const path = ent.roadPath;
        const totalSegments = path.length - 1;
        const exactIdx = ent.pathProgress * totalSegments;
        const idx = Math.min(totalSegments - 1, Math.floor(exactIdx));
        const frac = exactIdx - idx;

        const p1 = path[idx];
        const p2 = path[Math.min(idx + 1, totalSegments)];

        ent.x = p1.x + (p2.x - p1.x) * frac;
        ent.z = p1.z + (p2.z - p1.z) * frac;
        ent.groundY = p1.y + (p2.y - p1.y) * frac;
        ent.y = ent.groundY + (ent.type === 'train' ? 0.16 : 0.12);
      }
    });

    this.rebuild3DMeshes();
  }

  render2DOverlays(width, height) {
    if (!this.svgOverlay) return;

    let svgContent = '';
    const tempVec = new THREE.Vector3();

    this.entities.forEach((ent, idx) => {
      tempVec.set(ent.x, ent.y, ent.z);
      tempVec.project(this.camera);

      if (tempVec.z > 1.0) return;

      const screenX = (tempVec.x * 0.5 + 0.5) * width;
      const screenY = (-(tempVec.y * 0.5) + 0.5) * height;

      if (screenX < 0 || screenX > width || screenY < 0 || screenY > height) return;

      const tagOffsetDist = 55;
      const angle = (idx % 2 === 0 ? 0.35 : -0.35) * Math.PI;
      const tagX = screenX + Math.cos(angle) * tagOffsetDist;
      const tagY = screenY - Math.sin(angle) * tagOffsetDist - 15;

      let color = '#ff8f00'; // Flights: Amber
      if (ent.type === 'transit') color = '#00e5ff'; // Buses: Cyan
      if (ent.type === 'train') color = '#ffffff';   // Trains: Ice White

      const badge = ent.callsign || ent.id;
      let info = '';
      if (ent.type === 'flight') {
        info = `FL${Math.round(ent.altitude / 100)} | ${Math.round(ent.speed)}kt`;
      } else if (ent.type === 'train') {
        info = `RAIL HAEMEK | ${Math.round(ent.speedKmh)}km/h`;
      } else {
        info = `LINE ${ent.line} | ${Math.round(ent.speedKmh)}km/h`;
      }

      svgContent += `
        <g class="hud-target-tag" data-id="${ent.id}" style="cursor: pointer; pointer-events: auto;">
          <line x1="${screenX}" y1="${screenY}" x2="${tagX}" y2="${tagY + 12}" stroke="${color}" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.8" />
          <circle cx="${screenX}" cy="${screenY}" r="3" fill="none" stroke="${color}" stroke-width="1.5" />
          <circle cx="${screenX}" cy="${screenY}" r="1" fill="${color}" />
          <rect x="${tagX}" y="${tagY}" width="112" height="26" fill="rgba(1, 15, 30, 0.88)" stroke="${color}" stroke-width="1" rx="2" />
          <text x="${tagX + 6}" y="${tagY + 11}" fill="${color}" font-size="9" font-family="'Courier New', monospace" font-weight="bold">${badge}</text>
          <text x="${tagX + 6}" y="${tagY + 21}" fill="#e0f7fa" font-size="8" font-family="'Courier New', monospace" opacity="0.9">${info}</text>
        </g>
      `;
    });

    this.svgOverlay.innerHTML = svgContent;

    // Attach click events
    if (this.onSelect) {
      this.svgOverlay.querySelectorAll('.hud-target-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = tag.getAttribute('data-id');
          const entity = this.entities.find(ent => ent.id === id);
          if (entity) this.onSelect(entity);
        });
      });
    }
  }
}
