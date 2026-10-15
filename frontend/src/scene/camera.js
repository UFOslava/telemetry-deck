import * as THREE from 'three';

export class CameraController {
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.domElement = domElement;

    // Config options
    this.idleRotationSpeed = options.idleRotationSpeed || 0.0015; // rad per frame
    this.idleTimeoutMs = options.idleTimeoutMs || 30000;          // 30 seconds
    this.pitch = options.pitch || (60 * Math.PI / 180);           // 60 degrees
    this.distance = options.distance || 19.5;                     // Tactical distance for 10km radius
    this.center = new THREE.Vector3(0, 0, 0);

    // Dynamic state
    this.yaw = options.yaw || (-Math.PI / 4); // South-West orientation
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetDistance = this.distance;

    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };
    this.lastInteractionTime = performance.now();
    this.isIdle = true;

    this.initEventListeners();
    this.updateCameraTransform();
  }

  initEventListeners() {
    const onPointerDown = (e) => {
      if (e.target.closest('#settings-modal') || e.target.closest('#hud-controls')) return;
      this.isDragging = true;
      this.isIdle = false;
      this.lastInteractionTime = performance.now();
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
      this.lastInteractionTime = performance.now();

      // Sensitivity
      this.yaw -= deltaX * 0.008;
      this.pitch = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, this.pitch + deltaY * 0.008));
    };

    const onPointerUp = () => {
      this.isDragging = false;
      this.lastInteractionTime = performance.now();
    };

    const onWheel = (e) => {
      if (e.target.closest('#settings-modal')) return;
      this.lastInteractionTime = performance.now();
      this.isIdle = false;
      this.distance = Math.max(5.0, Math.min(45.0, this.distance + e.deltaY * 0.02));
    };

    this.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.domElement.addEventListener('wheel', onWheel, { passive: true });
  }

  update(deltaTime) {
    const now = performance.now();
    const elapsedSinceInteraction = now - this.lastInteractionTime;

    if (!this.isDragging && elapsedSinceInteraction >= this.idleTimeoutMs) {
      this.isIdle = true;
    }

    if (this.isIdle && !this.isDragging) {
      // Gentle idle rotation
      this.yaw += this.idleRotationSpeed;
    }

    this.updateCameraTransform();
  }

  getIdleElapsed() {
    return performance.now() - this.lastInteractionTime;
  }

  updateCameraTransform() {
    // Spherical to Cartesian
    const cy = Math.cos(this.pitch);
    const sy = Math.sin(this.pitch);

    const x = this.distance * cy * Math.sin(this.yaw);
    const y = this.distance * sy;
    const z = this.distance * cy * Math.cos(this.yaw);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.center);
  }
}

export function setupCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  return camera;
}
