import * as THREE from 'three';
import { createHUDText } from './vector_font.js';

export function createPolarGrid(maxRadius = 10.0, ringInterval = 2.5, spokeCount = 12) {
  const group = new THREE.Group();

  const mutedNavy = 0x0e3866;
  const mediumCobalt = 0x154c8a;
  const brightCyan = 0x00e5ff;

  const innerGridMat = new THREE.LineBasicMaterial({
    color: mutedNavy,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending
  });

  const primaryGridMat = new THREE.LineBasicMaterial({
    color: mediumCobalt,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending
  });

  const perimeterMat = new THREE.LineBasicMaterial({
    color: brightCyan,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending
  });

  // Concentric Rings
  const numRings = Math.round(maxRadius / ringInterval);
  for (let i = 1; i <= numRings; i++) {
    const r = i * ringInterval;
    const isPerimeter = i === numRings;
    const segments = 128;
    const positions = [];

    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(theta) * r, 0, Math.sin(theta) * r);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = isPerimeter ? perimeterMat : (i % 2 === 0 ? primaryGridMat : innerGridMat);
    group.add(new THREE.Line(geo, mat));

    // Add perimeter ticks (every 5 degrees = 72 ticks)
    if (isPerimeter) {
      const tickPositions = [];
      const totalTicks = 72; // every 5 degrees
      for (let t = 0; t < totalTicks; t++) {
        const theta = (t / totalTicks) * Math.PI * 2;
        let tickLen = 0.15;
        if (t % 6 === 0) tickLen = 0.45; // Every 30 deg
        else if (t % 2 === 0) tickLen = 0.28; // Every other minor tick (10 deg)

        const x1 = Math.cos(theta) * maxRadius;
        const z1 = Math.sin(theta) * maxRadius;
        const x2 = Math.cos(theta) * (maxRadius + tickLen);
        const z2 = Math.sin(theta) * (maxRadius + tickLen);
        tickPositions.push(x1, 0, z1, x2, 0, z2);
      }
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
      group.add(new THREE.LineSegments(tickGeo, perimeterMat));
    }
  }

  // Radial Spokes (every 30 degrees)
  const spokePositions = [];
  for (let i = 0; i < spokeCount; i++) {
    const theta = (i / spokeCount) * Math.PI * 2;
    spokePositions.push(
      0, 0, 0,
      Math.cos(theta) * maxRadius, 0, Math.sin(theta) * maxRadius
    );
  }
  const spokeGeo = new THREE.BufferGeometry();
  spokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(spokePositions, 3));
  group.add(new THREE.LineSegments(spokeGeo, innerGridMat));

  // Compass Arrow pointing to True North (-z in ENU)
  const arrowGeo = new THREE.BufferGeometry();
  const tipZ = -(maxRadius + 1.25);
  const baseZ = -(maxRadius + 0.15);
  const halfW = 0.38;
  const arrowPts = [
    0, 0.05, tipZ,
    -halfW, 0.05, baseZ,
    0, 0.05, tipZ,
    halfW, 0.05, baseZ,
    -halfW, 0.05, baseZ,
    0, 0.05, baseZ - 0.2,
    halfW, 0.05, baseZ,
    0, 0.05, baseZ - 0.2
  ];
  arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrowPts, 3));
  const arrowMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending
  });
  group.add(new THREE.LineSegments(arrowGeo, arrowMat));

  // Center crosshair
  const crossLen = 0.6;
  const crossPositions = [
    -crossLen, 0, 0, crossLen, 0, 0,
    0, 0, -crossLen, 0, 0, crossLen
  ];
  const crossGeo = new THREE.BufferGeometry();
  crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossPositions, 3));
  group.add(new THREE.LineSegments(crossGeo, perimeterMat));

  // 3D Vector Stroke Compass Degree & Direction Labels (Option 1)
  // Lays flat along the perimeter ring in WebGL world space
  const totalTicks = 72; // every 5 degrees
  for (let t = 0; t < totalTicks; t++) {
    // Every other minor tick (every 10 degrees)
    if (t % 2 !== 0) continue;

    const angleDeg = t * 5;
    // In ENU: 0 deg (North) is at (0, -R), 90 deg (East) is at (+R, 0), 180 deg (South) is at (0, +R), 270 deg (West) is at (-R, 0)
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    const rLabel = maxRadius + 0.85;
    const x = Math.cos(angleRad) * rLabel;
    const z = Math.sin(angleRad) * rLabel;

    let label = `${angleDeg.toString().padStart(3, '0')}°`;
    let color = 0x00e5ff;
    let size = 0.16;
    let opacity = 0.7;

    if (angleDeg === 0) {
      label = '000° N';
      color = 0xffffff;
      size = 0.24;
      opacity = 1.0;
    } else if (angleDeg === 90) {
      label = '090° E';
      color = 0xffffff;
      size = 0.24;
      opacity = 1.0;
    } else if (angleDeg === 180) {
      label = '180° S';
      color = 0xffffff;
      size = 0.24;
      opacity = 1.0;
    } else if (angleDeg === 270) {
      label = '270° W';
      color = 0xffffff;
      size = 0.24;
      opacity = 1.0;
    } else if (angleDeg === 45) {
      label = 'NE';
      color = 0x00e5ff;
      size = 0.20;
      opacity = 0.95;
    } else if (angleDeg === 135) {
      label = 'SE';
      color = 0x00e5ff;
      size = 0.20;
      opacity = 0.95;
    } else if (angleDeg === 225) {
      label = 'SW';
      color = 0x00e5ff;
      size = 0.20;
      opacity = 0.95;
    } else if (angleDeg === 315) {
      label = 'NW';
      color = 0x00e5ff;
      size = 0.20;
      opacity = 0.95;
    } else if (angleDeg % 30 !== 0) {
      // Minor 10-degree increments
      size = 0.12;
      opacity = 0.55;
    }

    const labelMesh = createHUDText(label, {
      size: size,
      color: color,
      opacity: opacity,
      align: 'center'
    });

    labelMesh.position.set(x, 0.05, z);
    // Lie flat on X-Z plane and orient facing outwards radially
    labelMesh.rotation.x = -Math.PI * 0.5;
    labelMesh.rotation.z = -angleRad - Math.PI * 0.5;

    group.add(labelMesh);
  }

  return group;
}

/**
 * Legacy SVG label function - returns empty string since compass is rendered in 3D WebGL lines
 */
export function renderPerimeterCompassLabels() {
  return '';
}
