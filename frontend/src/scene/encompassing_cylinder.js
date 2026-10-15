import * as THREE from 'three';

/**
 * Renders a 45° curved cylindrical bar on the map perimeter just above highest terrain.
 * Visualizes the 30-second inactivity countdown with a diagonal striped fill.
 * Floats dynamically at the back edge of the camera view and resets on movement.
 */
export class EncompassingCylinderHUD {
  constructor(scene, config = {}) {
    this.scene = scene;
    this.config = config;

    this.radius = this.config.radiusKm || 10.0;
    this.angleSpan = Math.PI * 0.25; // 45 degrees
    this.barHeight = 0.45; // Height of the bar in km
    this.baseY = 1.15; // Sits just over the highest terrain (~1.05 - 1.1 km)

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.mesh = null;
    this.borderLine = null;
    this.buildBarMesh();
  }

  setRadius(newRadius) {
    this.radius = newRadius;
    this.buildBarMesh();
  }

  buildBarMesh() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.borderLine) {
      this.scene.remove(this.borderLine);
      this.borderLine.geometry.dispose();
    }

    const geo = new THREE.CylinderGeometry(
      this.radius,
      this.radius,
      this.barHeight,
      64,
      1,
      true,
      -this.angleSpan * 0.5,
      this.angleSpan
    );

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(0, this.baseY + this.barHeight * 0.5, 0);
    this.scene.add(this.mesh);

    // Outer wireframe border along top and bottom arc
    const arcPts = [];
    const segments = 48;
    for (let i = 0; i <= segments; i++) {
      const a = -this.angleSpan * 0.5 + (i / segments) * this.angleSpan;
      arcPts.push(Math.sin(a) * this.radius, this.baseY + this.barHeight, Math.cos(a) * this.radius);
    }
    for (let i = segments; i >= 0; i--) {
      const a = -this.angleSpan * 0.5 + (i / segments) * this.angleSpan;
      arcPts.push(Math.sin(a) * this.radius, this.baseY, Math.cos(a) * this.radius);
    }
    arcPts.push(arcPts[0], arcPts[1], arcPts[2]);

    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcPts, 3));
    const borderMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    this.borderLine = new THREE.Line(borderGeo, borderMat);
    this.borderLine.position.set(0, 0, 0);
    this.scene.add(this.borderLine);
  }

  update(cameraYaw, idleProgress, isIdle = false) {
    // Float dynamically at the back edge of the current camera view
    // In our coordinate system, the back horizon is aligned with camera yaw
    const targetAngle = cameraYaw + Math.PI;

    if (this.mesh) {
      this.mesh.rotation.y = targetAngle;
    }
    if (this.borderLine) {
      this.borderLine.rotation.y = targetAngle;
    }

    this.renderStripedTexture(idleProgress, isIdle);
  }

  renderStripedTexture(progress, isIdle) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dark translucent background with neon cyan frame
    ctx.fillStyle = 'rgba(1, 15, 30, 0.75)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = isIdle ? '#ffe600' : '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Inner tick borders
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    // Filled portion width (0 to w - 24)
    const clampedProgress = Math.max(0, Math.min(1.0, progress));
    const fillW = Math.round((w - 24) * clampedProgress);

    if (fillW > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(12, 12, fillW, h - 24);
      ctx.clip();

      // Base fill glow
      ctx.fillStyle = isIdle ? 'rgba(255, 230, 0, 0.25)' : 'rgba(0, 229, 255, 0.25)';
      ctx.fillRect(12, 12, fillW, h - 24);

      // Tactical Diagonal Striped Fill (/// hazard / progress stripes)
      ctx.strokeStyle = isIdle ? '#ffe600' : '#00e5ff';
      ctx.lineWidth = 6;
      const stripeSpacing = 20;
      const timeOffset = (performance.now() * 0.04) % stripeSpacing;

      for (let x = -h; x < w + h; x += stripeSpacing) {
        ctx.beginPath();
        ctx.moveTo(x + timeOffset, 12);
        ctx.lineTo(x + timeOffset + h - 24, h - 12);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Telemetry text overlay inside the bar
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isIdle ? '#ffe600' : '#ffffff';

    const remainingSec = (30 * (1 - clampedProgress)).toFixed(1);
    const label = isIdle 
      ? `[CINEMATIC ORBIT ACTIVE // IDLE ENGAGED]` 
      : `INACTIVITY COUNTDOWN: ${remainingSec}s / 30.0s [AUTO-ORBIT ARMED]`;

    ctx.fillText(label, 24, h * 0.5);

    // Trailing percent tag on right
    ctx.textAlign = 'right';
    ctx.fillStyle = isIdle ? '#ffe600' : '#00e5ff';
    ctx.fillText(`${Math.round(clampedProgress * 100)}%`, w - 24, h * 0.5);

    this.texture.needsUpdate = true;
  }

  animate(deltaTime, cameraYaw, idleElapsedMs, isIdle) {
    const idleProgress = Math.min(1.0, idleElapsedMs / 30000.0);
    this.update(cameraYaw, idleProgress, isIdle);
  }
}
