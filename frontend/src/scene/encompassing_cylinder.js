import * as THREE from 'three';

/**
 * Encompassing 360° Multi-Segment Outer Cylinder HUD
 * 
 * Spins smoothly around the map independently of the camera.
 * Divided into 8 distinct 45° segments (Math.PI * 0.25):
 *  1. Inactivity Timeout Countdown Bar (hazard stripes)
 *  2. Big Real-Time Clock in centerpoint timezone (Asia/Jerusalem)
 *  3. Current Date & Tactical Epoch
 *  4. Weather with SVG vector icon and Temperature Range
 *  5. Secondary Timeout Bar / Mission Countdown
 *  6. UTC Zulu Global Clock
 *  7. Regional Weather & Ridge Microclimate
 *  8. Radar Anchor & Coordinates Status
 */
export class EncompassingCylinderHUD {
  constructor(scene, config = {}) {
    this.scene = scene;
    this.config = config;

    this.radius = this.config.radiusKm || 10.0;
    this.numSegments = 8;
    this.angleSpan = (Math.PI * 2) / this.numSegments; // 45 degrees = PI / 4
    this.barHeight = 0.52; // Height in km
    this.baseY = 1.15;     // Elevates above highest terrain

    this.spinSpeed = 0.035; // rad per second - steady independent spin around map
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

    this.segments = [];
    this.buildSegments();
  }

  async fetchWeather() {
    try {
      const res = await fetch('/api/weather');
      if (res.ok) {
        this.weatherData = await res.json();
      }
    } catch (e) {
      // Keep existing weather data
    }
  }

  setRadius(newRadius) {
    this.radius = newRadius;
    this.buildSegments();
  }

  buildSegments() {
    // Clear old geometry
    while (this.group.children.length > 0) {
      const obj = this.group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
    this.segments = [];

    for (let i = 0; i < this.numSegments; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      // Cylinder slice of exactly 45 degrees
      const geo = new THREE.CylinderGeometry(
        this.radius,
        this.radius,
        this.barHeight,
        48,
        1,
        true,
        -this.angleSpan * 0.48, // Slight gap between 45° segments
        this.angleSpan * 0.96
      );

      const segmentMesh = new THREE.Mesh(geo, mat);
      segmentMesh.position.set(0, this.baseY + this.barHeight * 0.5, 0);

      const segAngle = i * this.angleSpan;
      segmentMesh.rotation.y = segAngle;
      this.group.add(segmentMesh);

      // Outer border wireframe for each segment
      const arcPts = [];
      const borderSegments = 32;
      const span = this.angleSpan * 0.96;
      const startAngle = -span * 0.5;
      for (let s = 0; s <= borderSegments; s++) {
        const a = startAngle + (s / borderSegments) * span;
        arcPts.push(Math.sin(a) * this.radius, this.baseY + this.barHeight, Math.cos(a) * this.radius);
      }
      for (let s = borderSegments; s >= 0; s--) {
        const a = startAngle + (s / borderSegments) * span;
        arcPts.push(Math.sin(a) * this.radius, this.baseY, Math.cos(a) * this.radius);
      }
      arcPts.push(arcPts[0], arcPts[1], arcPts[2]);

      const borderGeo = new THREE.BufferGeometry();
      borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcPts, 3));
      const borderMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
      });
      const borderLine = new THREE.Line(borderGeo, borderMat);
      borderLine.rotation.y = segAngle;
      this.group.add(borderLine);

      this.segments.push({
        index: i,
        canvas,
        ctx,
        texture,
        mesh: segmentMesh
      });
    }
  }

  // Draw tactical weather SVG icon onto Canvas2D context
  drawWeatherSVGIcon(ctx, iconType, cx, cy, radius, color = '#ffe600') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (iconType === 'sunny' || iconType === 'clear') {
      // Central sun disc
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.48, 0, Math.PI * 2);
      ctx.stroke();

      // Radiant solar flares / rays (8 rays)
      const rayCount = 8;
      const rInner = radius * 0.65;
      const rOuter = radius * 0.95;
      for (let r = 0; r < rayCount; r++) {
        const angle = (r / rayCount) * Math.PI * 2;
        const x1 = cx + Math.cos(angle) * rInner;
        const y1 = cy + Math.sin(angle) * rInner;
        const x2 = cx + Math.cos(angle) * rOuter;
        const y2 = cy + Math.sin(angle) * rOuter;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else {
      // Cloud with sun
      ctx.beginPath();
      ctx.arc(cx - 10, cy - 6, radius * 0.35, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx - 8, cy + 6, radius * 0.35, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(cx + 4, cy - 4, radius * 0.45, Math.PI * 1.0, Math.PI * 2.0);
      ctx.arc(cx + 18, cy + 8, radius * 0.35, Math.PI * 1.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  renderTimeoutSegment(seg, idleProgress, isIdle) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = isIdle ? '#ffe600' : '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Inner frame
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    const clampedProgress = Math.max(0, Math.min(1.0, idleProgress));
    const fillW = Math.round((w - 24) * clampedProgress);

    if (fillW > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(12, 12, fillW, h - 24);
      ctx.clip();

      ctx.fillStyle = isIdle ? 'rgba(255, 230, 0, 0.25)' : 'rgba(0, 229, 255, 0.25)';
      ctx.fillRect(12, 12, fillW, h - 24);

      // Diagonal hazard stripes
      ctx.strokeStyle = isIdle ? '#ffe600' : '#00e5ff';
      ctx.lineWidth = 6;
      const stripeSpacing = 22;
      const timeOffset = (performance.now() * 0.04) % stripeSpacing;

      for (let x = -h; x < w + h; x += stripeSpacing) {
        ctx.beginPath();
        ctx.moveTo(x + timeOffset, 12);
        ctx.lineTo(x + timeOffset + h - 24, h - 12);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.font = 'bold 24px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isIdle ? '#ffe600' : '#ffffff';

    const remainingSec = (30 * (1 - clampedProgress)).toFixed(1);
    const label = isIdle 
      ? `[CINEMATIC ORBIT ACTIVE // IDLE ENGAGED]` 
      : `INACTIVITY COUNTDOWN: ${remainingSec}s / 30.0s [AUTO-ORBIT ARMED]`;

    ctx.fillText(label, 24, h * 0.5);

    ctx.textAlign = 'right';
    ctx.fillStyle = isIdle ? '#ffe600' : '#00e5ff';
    ctx.fillText(`${Math.round(clampedProgress * 100)}%`, w - 24, h * 0.5);

    texture.needsUpdate = true;
  }

  renderClockSegment(seg, now) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Get time in centerpoint timezone (Asia/Jerusalem)
    let timeStr = '';
    let tzName = 'ASIA/JERUSALEM (UTC+03:00)';
    try {
      const options = {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      timeStr = new Intl.DateTimeFormat('en-GB', options).format(now);
    } catch (e) {
      timeStr = now.toTimeString().substring(0, 8);
    }

    // Big Real-Time Clock
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 54px "Courier New", monospace';
    ctx.fillText(timeStr, 28, h * 0.44);

    // Subtitle
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#70d8ff';
    ctx.fillText(`LOCAL TIME // ${tzName}`, 30, h * 0.78);

    // Right badge
    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#ffe600';
    ctx.fillText('[CENTERPOINT CHRONO]', w - 28, h * 0.5);

    texture.needsUpdate = true;
  }

  renderDateSegment(seg, now) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Format Date in centerpoint timezone
    let dateStr = '';
    try {
      const options = {
        timeZone: 'Asia/Jerusalem',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      };
      dateStr = new Intl.DateTimeFormat('en-GB', options).format(now).toUpperCase();
    } catch (e) {
      dateStr = now.toDateString().toUpperCase();
    }

    // Calculate Day of Year
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const diff = now - startOfYear;
    const oneDay = 1000 * 60 * 60 * 24;
    const doy = Math.floor(diff / oneDay);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 44px "Courier New", monospace';
    ctx.fillText(dateStr, 28, h * 0.44);

    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#70d8ff';
    ctx.fillText(`DAY OF YEAR: ${doy.toString().padStart(3, '0')} // TACTICAL EPOCH: 2026.8`, 30, h * 0.78);

    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('[OPERATIONAL CALENDAR]', w - 28, h * 0.5);

    texture.needsUpdate = true;
  }

  renderWeatherSegment(seg) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;
    const data = this.weatherData;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Draw Vector Weather SVG Icon on Canvas
    this.drawWeatherSVGIcon(ctx, data.icon || 'sunny', 65, h * 0.5, 36, '#ffe600');

    // Temperature & Range
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 44px "Courier New", monospace';
    ctx.fillText(`${data.temperature}°C`, 125, h * 0.42);

    // Temp range
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(`[LO: ${data.temp_min}°C  HI: ${data.temp_max}°C]`, 265, h * 0.42);

    // Condition & Meteorological readouts
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#e0f7fa';
    ctx.fillText(`YOKNEAM // ${data.condition} | HUM: ${data.humidity}% | WIND: ${data.wind_kmh} KM/H ${data.wind_dir}`, 125, h * 0.78);

    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#70d8ff';
    ctx.fillText('[METEOROLOGICAL TELEMETRY]', w - 28, h * 0.5);

    texture.needsUpdate = true;
  }

  renderZuluClockSegment(seg, now) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    const utcHours = now.getUTCHours().toString().padStart(2, '0');
    const utcMins = now.getUTCMinutes().toString().padStart(2, '0');
    const utcSecs = now.getUTCSeconds().toString().padStart(2, '0');
    const zuluStr = `${utcHours}:${utcMins}:${utcSecs} Z`;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 50px "Courier New", monospace';
    ctx.fillText(zuluStr, 28, h * 0.44);

    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#70d8ff';
    ctx.fillText('COORDINATED UNIVERSAL TIME (UTC) // GLOBAL FLEET BASELINE', 30, h * 0.78);

    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#ffe600';
    ctx.fillText('[ZULU MASTER SYNC]', w - 28, h * 0.5);

    texture.needsUpdate = true;
  }

  renderAnchorSegment(seg) {
    const { ctx, canvas, texture } = seg;
    const w = canvas.width;
    const h = canvas.height;
    const lat = (this.config.centerLat || 32.6595).toFixed(4);
    const lon = (this.config.centerLon || 35.1090).toFixed(4);
    const rad = (this.config.radiusKm || 10.0).toFixed(1);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(1, 15, 30, 0.85)';
    ctx.fillRect(4, 4, w - 8, h - 8);

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 36px "Courier New", monospace';
    ctx.fillText(`ANCHOR: YOKNEAM JCT`, 28, h * 0.42);

    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#70d8ff';
    ctx.fillText(`GEO: (${lat}° N, ${lon}° E) | RANGE: ${rad} KM | STATUS: NOMINAL`, 30, h * 0.78);

    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#ffe600';
    ctx.fillText('[SURVEILLANCE RADAR]', w - 28, h * 0.5);

    texture.needsUpdate = true;
  }

  animate(deltaTime, idleElapsedMs, isIdle) {
    // 5) Make the timeout bar and outer cylinder spin separately from the camera around the map!
    this.rotationAngle += this.spinSpeed * deltaTime;
    this.group.rotation.y = this.rotationAngle;

    const idleProgress = Math.min(1.0, idleElapsedMs / 30000.0);
    const now = new Date();

    if (this.segments.length >= 8) {
      // 0: Timeout Bar
      this.renderTimeoutSegment(this.segments[0], idleProgress, isIdle);
      // 1: Big Real Time Clock in Centerpoint Timezone
      this.renderClockSegment(this.segments[1], now);
      // 2: Current Date & Epoch
      this.renderDateSegment(this.segments[2], now);
      // 3: Weather with SVG Icon & Temp Range
      this.renderWeatherSegment(this.segments[3]);
      // 4: Secondary Timeout Bar (180 deg opposite)
      this.renderTimeoutSegment(this.segments[4], idleProgress, isIdle);
      // 5: Zulu Global Clock
      this.renderZuluClockSegment(this.segments[5], now);
      // 6: Weather repeat or Ridge Microclimate
      this.renderWeatherSegment(this.segments[6]);
      // 7: Radar Anchor & Status
      this.renderAnchorSegment(this.segments[7]);
    }
  }
}
