import * as THREE from 'three';

export function createCurvedHUD(radius = 52) {
  const group = new THREE.Group();

  // Upper perimeter arc from -45 to +45 deg or across top horizon
  const arcPoints = [];
  const segments = 64;
  const startAngle = Math.PI * 0.25;
  const endAngle = Math.PI * 0.75;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    arcPoints.push(new THREE.Vector3(Math.cos(angle) * radius, 0.5, Math.sin(angle) * radius));
  }

  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMat = new THREE.LineBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.5
  });

  group.add(new THREE.Line(arcGeo, arcMat));
  return group;
}
