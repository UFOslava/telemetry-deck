import * as THREE from 'three';

/**
 * Manages 3D holographic road network, subterranean mountain tunnels,
 * fat traffic jam ribbons (3x width), and continuous transit routes
 */
export class RoadNetworkManager {
  constructor(scene, config = {}) {
    this.scene = scene;
    this.config = {
      roadColor: 0xffe600,
      roadOpacity: 0.95,
      railwayColor: 0xffffff,
      railwayOpacity: 0.9,
      ...config
    };

    this.roadGroup = new THREE.Group();
    this.scene.add(this.roadGroup);

    this.congestionGroup = new THREE.Group();
    this.tunnelGroup = new THREE.Group();
    this.roadGroup.add(this.congestionGroup);
    this.roadGroup.add(this.tunnelGroup);

    this.continuousRoutes = [];
    this.railwayPaths = [];
    this.tunnelSegments = [];
  }

  updateStyle(options = {}) {
    if (options.roadColor !== undefined) this.config.roadColor = options.roadColor;
    if (options.roadOpacity !== undefined) this.config.roadOpacity = options.roadOpacity;
    
    this.roadGroup.traverse(child => {
      if (child.isLineSegments && child.userData.isRoad) {
        child.material.color.set(this.config.roadColor);
        child.material.opacity = child.userData.isMajor 
          ? this.config.roadOpacity 
          : this.config.roadOpacity * 0.55;
        child.material.needsUpdate = true;
      }
    });
  }

  buildRoads(osmData, elevationSampler = null) {
    // Clear old geometry
    const toRemove = [];
    this.roadGroup.children.forEach(c => {
      if (c.userData.isRoad || c === this.congestionGroup || c === this.tunnelGroup) toRemove.push(c);
    });
    toRemove.forEach(c => {
      if (c !== this.congestionGroup && c !== this.tunnelGroup) {
        this.roadGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
    });

    while (this.congestionGroup.children.length > 0) {
      const obj = this.congestionGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    while (this.tunnelGroup.children.length > 0) {
      const obj = this.tunnelGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    const elements = osmData.elements || [];
    const R_EARTH_KM = 6371.0;
    const rad = Math.PI / 180;
    const lat0 = (this.config.centerLat || 32.6595) * rad;
    const lon0 = (this.config.centerLon || 35.1090) * rad;
    const maxRadius = this.config.radiusKm || 10.0;

    const majorRoadPositions = [];
    const minorRoadPositions = [];
    const tunnelPositions = [];

    // Congestion lines (thick ribbons)
    const severeCongestionSegments = [];
    const moderateCongestionSegments = [];

    const routeGroups = {
      'Route 70': [],
      'Highway 6': [],
      'Route 66': [],
      'Route 722': [],
      'Yokneam City': []
    };

    elements.forEach(elem => {
      if (elem.type !== 'way' || !elem.geometry || elem.geometry.length < 2) return;

      const layerName = (elem.layer || '').toLowerCase();
      const highway = elem.tags?.highway || '';
      const ref = elem.tags?.ref || elem.tags?.name || '';
      const isTunnel = elem.tags?.tunnel === 'yes' || elem.tags?.layer === '-1' || layerName.includes('tunnel');
      const isMajor = highway === 'motorway' || highway === 'trunk' || highway === 'primary' || layerName.includes('motorway') || layerName.includes('major');
      const pathSegment = [];

      for (let i = 0; i < elem.geometry.length - 1; i++) {
        const p1 = elem.geometry[i];
        const p2 = elem.geometry[i + 1];

        const phi1 = p1.lat * rad;
        const lam1 = p1.lon * rad;
        const x1 = R_EARTH_KM * (lam1 - lon0) * Math.cos((phi1 + lat0) * 0.5);
        const z1 = -R_EARTH_KM * (phi1 - lat0);

        const phi2 = p2.lat * rad;
        const lam2 = p2.lon * rad;
        const x2 = R_EARTH_KM * (lam2 - lon0) * Math.cos((phi2 + lat0) * 0.5);
        const z2 = -R_EARTH_KM * (phi2 - lat0);

        const r1 = Math.sqrt(x1 * x1 + z1 * z1);
        const r2 = Math.sqrt(x2 * x2 + z2 * z2);

        if (r1 <= maxRadius && r2 <= maxRadius) {
          let y1, y2;

          if (isTunnel) {
            // Subterranean tunnel passes through inside the mountain at ~85m elevation
            y1 = (85.0 / 1000.0) * 3.0; // matching elevationScale
            y2 = (85.0 / 1000.0) * 3.0;

            tunnelPositions.push(x1, y1, z1, x2, y2, z2);
          } else {
            y1 = (elevationSampler ? elevationSampler(p1.lat, p1.lon) : 0.05) + 0.04;
            y2 = (elevationSampler ? elevationSampler(p2.lat, p2.lon) : 0.05) + 0.04;

            if (isMajor) {
              majorRoadPositions.push(x1, y1, z1, x2, y2, z2);
            } else {
              minorRoadPositions.push(x1, y1, z1, x2, y2, z2);
            }

            // Real-Time Traffic Jam Classification:
            // Route 70 main interchange: Severe Jam (Red, 3x-4x thick ribbon)
            // Highway 6 merge: Moderate Congestion (Orange, 2.5x thick ribbon)
            const midX = (x1 + x2) * 0.5;
            const midZ = (z1 + z2) * 0.5;
            const distToJunction = Math.sqrt(midX * midX + midZ * midZ);

            if (distToJunction < 2.0 && (ref.includes('70') || highway === 'trunk' || layerName.includes('motorway'))) {
              severeCongestionSegments.push({ x1, y1: y1 + 0.03, z1, x2, y2: y2 + 0.03, z2 });
            } else if (distToJunction >= 2.0 && distToJunction < 4.5 && (ref.includes('6') || ref.includes('70') || isMajor)) {
              moderateCongestionSegments.push({ x1, y1: y1 + 0.02, z1, x2, y2: y2 + 0.02, z2 });
            }
          }

          if (pathSegment.length === 0) pathSegment.push(new THREE.Vector3(x1, y1, z1));
          pathSegment.push(new THREE.Vector3(x2, y2, z2));
        }
      }

      if (pathSegment.length >= 2) {
        if (ref.includes('70')) routeGroups['Route 70'].push(pathSegment);
        else if (ref.includes('66')) routeGroups['Route 66'].push(pathSegment);
        else if (ref.includes('722')) routeGroups['Route 722'].push(pathSegment);
        else if (ref.includes('6') || layerName.includes('motorway')) routeGroups['Highway 6'].push(pathSegment);
        else if (isMajor) routeGroups['Yokneam City'].push(pathSegment);
      }
    });

    // Build Continuous Chained Routes for smooth vehicle pacing
    this.continuousRoutes = this.chainSegmentsIntoRoutes(routeGroups);

    // Standard Surface Roads (Yellow)
    if (majorRoadPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(majorRoadPositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: this.config.roadColor,
        transparent: true,
        opacity: this.config.roadOpacity,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.LineSegments(geo, mat);
      line.userData = { isRoad: true, isMajor: true };
      this.roadGroup.add(line);
    }

    if (minorRoadPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(minorRoadPositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: this.config.roadColor,
        transparent: true,
        opacity: this.config.roadOpacity * 0.55,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.LineSegments(geo, mat);
      line.userData = { isRoad: true, isMajor: false };
      this.roadGroup.add(line);
    }

    // Subterranean Yokneam Tunnel Vectors (burrowing through mountain, without portal markers)
    if (tunnelPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(tunnelPositions, 3));
      const mat = new THREE.LineDashedMaterial({
        color: 0x00e5ff,
        dashSize: 0.25,
        gapSize: 0.15,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthTest: false // Visible through mountain topography!
      });
      const tunnelLine = new THREE.LineSegments(geo, mat);
      tunnelLine.computeLineDistances();
      this.tunnelGroup.add(tunnelLine);
    }

    // Build FAT Glowing Ribbons for Traffic Jams (3x to 4x width)
    this.buildFatTrafficRibbons(severeCongestionSegments, 0xff2244, 0.08, 'severe'); // Red, 4x
    this.buildFatTrafficRibbons(moderateCongestionSegments, 0xff8f00, 0.05, 'moderate'); // Orange, 2.5x
  }

  buildFatTrafficRibbons(segments, colorHex, halfWidth, severity) {
    if (segments.length === 0) return;

    const vertices = [];
    const normals = [];

    segments.forEach(seg => {
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.001) return;

      // Perpendicular vector in x-z plane
      const px = (-dz / len) * halfWidth;
      const pz = (dx / len) * halfWidth;

      // Quad vertices (2 triangles per road segment)
      // v1: p1 - perp, v2: p1 + perp, v3: p2 + perp, v4: p2 - perp
      const v1 = [seg.x1 - px, seg.y1, seg.z1 - pz];
      const v2 = [seg.x1 + px, seg.y1, seg.z1 + pz];
      const v3 = [seg.x2 + px, seg.y2, seg.z2 + pz];
      const v4 = [seg.x2 - px, seg.y2, seg.z2 - pz];

      // Triangle 1: v1, v2, v3
      vertices.push(...v1, ...v2, ...v3);
      // Triangle 2: v1, v3, v4
      vertices.push(...v1, ...v3, ...v4);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: severity === 'severe' ? 0.95 : 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { isCongestion: true, severity };
    this.congestionGroup.add(mesh);
  }

  chainSegmentsIntoRoutes(routeGroups) {
    const compiledRoutes = [];

    Object.entries(routeGroups).forEach(([routeName, segments]) => {
      if (segments.length === 0) return;

      const allPoints = [];
      segments.forEach(seg => {
        seg.forEach(p => allPoints.push(p.clone()));
      });

      allPoints.sort((a, b) => a.z - b.z);

      const cleanPath = [];
      allPoints.forEach(p => {
        if (cleanPath.length === 0) {
          cleanPath.push(p);
        } else {
          const last = cleanPath[cleanPath.length - 1];
          const d = Math.sqrt((p.x - last.x) ** 2 + (p.z - last.z) ** 2);
          if (d > 0.08) {
            cleanPath.push(p);
          }
        }
      });

      if (cleanPath.length >= 4) {
        let totalKm = 0;
        for (let i = 0; i < cleanPath.length - 1; i++) {
          const dx = cleanPath[i + 1].x - cleanPath[i].x;
          const dz = cleanPath[i + 1].z - cleanPath[i].z;
          totalKm += Math.sqrt(dx * dx + dz * dz);
        }

        compiledRoutes.push({
          name: routeName,
          points: cleanPath,
          lengthKm: Math.max(2.0, totalKm)
        });
      }
    });

    return compiledRoutes;
  }

  buildRailways(osmRailData, elevationSampler = null) {
    const elements = osmRailData.elements || [];
    const R_EARTH_KM = 6371.0;
    const rad = Math.PI / 180;
    const lat0 = (this.config.centerLat || 32.6595) * rad;
    const lon0 = (this.config.centerLon || 35.1090) * rad;
    const maxRadius = this.config.radiusKm || 10.0;

    const railPositions = [];
    const sleeperPositions = [];
    const railPoints = [];

    elements.forEach(elem => {
      if (elem.type !== 'way' || !elem.geometry || elem.geometry.length < 2) return;

      for (let i = 0; i < elem.geometry.length - 1; i++) {
        const p1 = elem.geometry[i];
        const p2 = elem.geometry[i + 1];

        const phi1 = p1.lat * rad;
        const lam1 = p1.lon * rad;
        const x1 = R_EARTH_KM * (lam1 - lon0) * Math.cos((phi1 + lat0) * 0.5);
        const z1 = -R_EARTH_KM * (phi1 - lat0);

        const phi2 = p2.lat * rad;
        const lam2 = p2.lon * rad;
        const x2 = R_EARTH_KM * (lam2 - lon0) * Math.cos((phi2 + lat0) * 0.5);
        const z2 = -R_EARTH_KM * (phi2 - lat0);

        const r1 = Math.sqrt(x1 * x1 + z1 * z1);
        const r2 = Math.sqrt(x2 * x2 + z2 * z2);

        if (r1 <= maxRadius && r2 <= maxRadius) {
          const y1 = (elevationSampler ? elevationSampler(p1.lat, p1.lon) : 0.05) + 0.06;
          const y2 = (elevationSampler ? elevationSampler(p2.lat, p2.lon) : 0.05) + 0.06;

          railPositions.push(x1, y1, z1, x2, y2, z2);

          const dx = x2 - x1;
          const dz = z2 - z1;
          const len = Math.sqrt(dx * dx + dz * dz);
          if (len > 0.001) {
            const px = (-dz / len) * 0.06;
            const pz = (dx / len) * 0.06;
            sleeperPositions.push(x1 - px, y1, z1 - pz, x1 + px, y1, z1 + pz);
          }

          railPoints.push(new THREE.Vector3(x1, y1, z1));
          railPoints.push(new THREE.Vector3(x2, y2, z2));
        }
      }
    });

    if (railPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
      });
      const railLine = new THREE.LineSegments(geo, mat);
      railLine.userData = { isRail: true };
      this.roadGroup.add(railLine);
    }

    if (sleeperPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sleeperPositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x70d8ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });
      const sleeperLine = new THREE.LineSegments(geo, mat);
      sleeperLine.userData = { isRail: true };
      this.roadGroup.add(sleeperLine);
    }

    if (railPoints.length >= 4) {
      railPoints.sort((a, b) => a.x - b.x);
      const cleanRail = [];
      railPoints.forEach(p => {
        if (cleanRail.length === 0) cleanRail.push(p);
        else {
          const last = cleanRail[cleanRail.length - 1];
          const d = Math.sqrt((p.x - last.x) ** 2 + (p.z - last.z) ** 2);
          if (d > 0.1) cleanRail.push(p);
        }
      });

      let totalRailKm = 0;
      for (let i = 0; i < cleanRail.length - 1; i++) {
        const dx = cleanRail[i + 1].x - cleanRail[i].x;
        const dz = cleanRail[i + 1].z - cleanRail[i].z;
        totalRailKm += Math.sqrt(dx * dx + dz * dz);
      }

      this.railwayPaths = [{
        name: 'Jezreel Valley Line (HaEmek)',
        points: cleanRail,
        lengthKm: Math.max(5.0, totalRailKm)
      }];
    }
  }

  animate(deltaTime) {
    // Pulsating glow on severe traffic jam ribbons
    const time = performance.now() * 0.003;
    const pulseFactor = 0.8 + 0.2 * Math.sin(time * 3);

    this.congestionGroup.children.forEach(child => {
      if (child.userData.severity === 'severe') {
        child.material.opacity = pulseFactor;
      }
    });
  }
}
