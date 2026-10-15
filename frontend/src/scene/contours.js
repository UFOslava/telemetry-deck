import * as THREE from 'three';
import { contours } from 'd3-contour';

/**
 * Generates 3D neon topographic contour line segments from elevation grid data
 */
export function buildContourMesh(elevationData, config = {}) {
  const {
    centerLat = 32.6595,
    centerLon = 35.1090,
    radiusKm = 10.0,
    stepMeters = 25.0,
    elevationScale = 3.0, // Vertical exaggeration
    contourOpacity = 0.42, // Dimmed by 50%
    color = 0x00e5ff
  } = config;

  const { elevations, bounds, shape, min_elevation, max_elevation } = elevationData;
  const height = shape[0];
  const width = shape[1];
  const flat = elevations.flat();

  // Generate thresholds
  const thresholds = [];
  for (let e = Math.ceil(min_elevation / stepMeters) * stepMeters; e <= max_elevation; e += stepMeters) {
    thresholds.push(e);
  }

  // d3-contour extraction (~70ms)
  const generator = contours().size([width, height]).thresholds(thresholds);
  const multiPolygons = generator(flat);

  const R_EARTH_KM = 6371.0;
  const rad = Math.PI / 180;
  const lat0 = centerLat * rad;
  const lon0 = centerLon * rad;

  const positions = [];
  const colors = [];

  const baseColor = new THREE.Color(color);
  const highColor = new THREE.Color(0x80ffff);

  multiPolygons.forEach((multiPoly) => {
    const isoval = multiPoly.value;
    const normElevation = (isoval - min_elevation) / Math.max(1, max_elevation - min_elevation);
    const elevY = (isoval / 1000.0) * elevationScale; // Metric elevation in km * scale

    const levelColor = baseColor.clone().lerp(highColor, normElevation * 0.7);

    multiPoly.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        // Convert ring coordinates into 3D line segments
        for (let i = 0; i < ring.length - 1; i++) {
          const [px1, py1] = ring[i];
          const [px2, py2] = ring[i + 1];

          // Linear interpolation to lat/lon
          const lat1 = bounds.lat_max - (py1 / height) * (bounds.lat_max - bounds.lat_min);
          const lon1 = bounds.lon_min + (px1 / width) * (bounds.lon_max - bounds.lon_min);

          const lat2 = bounds.lat_max - (py2 / height) * (bounds.lat_max - bounds.lat_min);
          const lon2 = bounds.lon_min + (px2 / width) * (bounds.lon_max - bounds.lon_min);

          // Local Tangent Plane (ENU)
          const phi1 = lat1 * rad;
          const lam1 = lon1 * rad;
          const x1 = R_EARTH_KM * (lam1 - lon0) * Math.cos((phi1 + lat0) * 0.5);
          const z1 = -R_EARTH_KM * (phi1 - lat0);

          const phi2 = lat2 * rad;
          const lam2 = lon2 * rad;
          const x2 = R_EARTH_KM * (lam2 - lon0) * Math.cos((phi2 + lat0) * 0.5);
          const z2 = -R_EARTH_KM * (phi2 - lat0);

          // Circular radius clipping
          const r1 = Math.sqrt(x1 * x1 + z1 * z1);
          const r2 = Math.sqrt(x2 * x2 + z2 * z2);

          if (r1 <= radiusKm && r2 <= radiusKm) {
            positions.push(x1, elevY, z1);
            positions.push(x2, elevY, z2);

            colors.push(levelColor.r, levelColor.g, levelColor.b);
            colors.push(levelColor.r, levelColor.g, levelColor.b);
          }
        }
      });
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: contourOpacity,
    blending: THREE.AdditiveBlending
  });

  return new THREE.LineSegments(geometry, material);
}
