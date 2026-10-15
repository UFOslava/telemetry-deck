import fs from 'fs';
import { performance } from 'perf_hooks';
import { contours } from 'd3-contour';

// Load saved elevation json
const raw = fs.readFileSync('../backend/app/data/yokneam_elevation_256.json', 'utf8');
const data = JSON.parse(raw);

const flatElevations = data.elevations.flat();
const width = data.shape[1];
const height = data.shape[0];
const step = 25.0;

const minE = data.min_elevation;
const maxE = data.max_elevation;
const thresholds = [];
for (let e = Math.ceil(minE / step) * step; e <= maxE; e += step) {
  thresholds.push(e);
}

console.log(`Grid: ${width}x${height} (${flatElevations.length} points)`);
console.log(`Elevation range: ${minE.toFixed(1)}m to ${maxE.toFixed(1)}m, ${thresholds.length} thresholds`);

// Benchmark d3-contour
const t0 = performance.now();
const contourGenerator = contours()
  .size([width, height])
  .thresholds(thresholds);

const results = contourGenerator(flatElevations);
const t1 = performance.now();

let totalCoordinates = 0;
results.forEach(multiPoly => {
  multiPoly.coordinates.forEach(poly => {
    poly.forEach(ring => {
      totalCoordinates += ring.length;
    });
  });
});

console.log(`\n=== JavaScript (d3-contour) Benchmark ===`);
console.log(`Runtime: ${(t1 - t0).toFixed(2)} ms`);
console.log(`Generated contours count: ${results.length}`);
console.log(`Total vertices extracted: ${totalCoordinates}`);
