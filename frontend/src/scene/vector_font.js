import * as THREE from 'three';

/**
 * Tactical Vector Stroke Font Engine (Option 1)
 * Pure 3D line-segment HUD glyphs rendered in WebGL world space.
 * Includes preparation hooks for Option 2 (3D Solid Shape / Quad-extruded ribbons).
 */

export const FONT_MODE = {
  STROKE: 'stroke', // Option 1: Lightweight 3D LineSegments (Zero texture memory, crisp at any distance)
  SOLID: 'solid'    // Option 2: 3D Triangulated Quad Ribbons (Thick laser/neon geometry)
};

export let ACTIVE_FONT_MODE = FONT_MODE.SOLID; // Option 2 active

export function setFontMode(mode) {
  if (mode === FONT_MODE.STROKE || mode === FONT_MODE.SOLID) {
    ACTIVE_FONT_MODE = mode;
  }
}

// Normalized stroke polyline definitions: [ [x0, y0, x1, y1, ...], [another_stroke, ...] ]
// Coordinates are in [0, 1] range: (0,0) bottom-left, (1,1) top-right.
const GLYPH_STROKES = {
  '0': [
    [0.1, 0, 0.9, 0, 0.9, 1, 0.1, 1, 0.1, 0],
    [0.2, 0.2, 0.8, 0.8] // diagonal slash
  ],
  '1': [
    [0.2, 0.75, 0.5, 1, 0.5, 0],
    [0.2, 0, 0.8, 0]
  ],
  '2': [
    [0.1, 0.8, 0.3, 1, 0.7, 1, 0.9, 0.8, 0.9, 0.55, 0.1, 0, 0.9, 0]
  ],
  '3': [
    [0.1, 0.9, 0.8, 1, 0.9, 0.8, 0.9, 0.55, 0.4, 0.55],
    [0.9, 0.55, 0.9, 0.2, 0.7, 0, 0.1, 0]
  ],
  '4': [
    [0.8, 0, 0.8, 1, 0.1, 0.35, 0.95, 0.35]
  ],
  '5': [
    [0.85, 1, 0.15, 1, 0.15, 0.55, 0.75, 0.55, 0.9, 0.35, 0.8, 0, 0.15, 0]
  ],
  '6': [
    [0.8, 0.9, 0.2, 0.6, 0.1, 0.3, 0.1, 0.2, 0.3, 0, 0.7, 0, 0.9, 0.2, 0.9, 0.4, 0.7, 0.55, 0.1, 0.55]
  ],
  '7': [
    [0.1, 1, 0.9, 1, 0.35, 0]
  ],
  '8': [
    [0.3, 0.55, 0.1, 0.75, 0.3, 1, 0.7, 1, 0.9, 0.75, 0.7, 0.55, 0.3, 0.55, 0.1, 0.25, 0.3, 0, 0.7, 0, 0.9, 0.25, 0.7, 0.55]
  ],
  '9': [
    [0.9, 0.45, 0.3, 0.45, 0.1, 0.6, 0.1, 0.8, 0.3, 1, 0.7, 1, 0.9, 0.8, 0.9, 0.2, 0.7, 0, 0.3, 0]
  ],
  'A': [
    [0.1, 0, 0.5, 1, 0.9, 0],
    [0.25, 0.4, 0.75, 0.4]
  ],
  'B': [
    [0.1, 0, 0.1, 1, 0.7, 1, 0.85, 0.8, 0.7, 0.55, 0.1, 0.55],
    [0.7, 0.55, 0.9, 0.3, 0.7, 0, 0.1, 0]
  ],
  'C': [
    [0.9, 0.8, 0.7, 1, 0.3, 1, 0.1, 0.8, 0.1, 0.2, 0.3, 0, 0.7, 0, 0.9, 0.2]
  ],
  'D': [
    [0.1, 0, 0.1, 1, 0.6, 1, 0.9, 0.7, 0.9, 0.3, 0.6, 0, 0.1, 0]
  ],
  'E': [
    [0.9, 1, 0.1, 1, 0.1, 0, 0.9, 0],
    [0.1, 0.52, 0.7, 0.52]
  ],
  'F': [
    [0.1, 0, 0.1, 1, 0.9, 1],
    [0.1, 0.55, 0.7, 0.55]
  ],
  'G': [
    [0.9, 0.8, 0.7, 1, 0.3, 1, 0.1, 0.8, 0.1, 0.2, 0.3, 0, 0.7, 0, 0.9, 0.2, 0.9, 0.5, 0.5, 0.5]
  ],
  'H': [
    [0.1, 0, 0.1, 1],
    [0.9, 0, 0.9, 1],
    [0.1, 0.5, 0.9, 0.5]
  ],
  'I': [
    [0.2, 1, 0.8, 1],
    [0.5, 1, 0.5, 0],
    [0.2, 0, 0.8, 0]
  ],
  'J': [
    [0.8, 1, 0.8, 0.25, 0.65, 0, 0.35, 0, 0.15, 0.2, 0.15, 0.35]
  ],
  'K': [
    [0.1, 0, 0.1, 1],
    [0.9, 1, 0.1, 0.45, 0.9, 0]
  ],
  'L': [
    [0.1, 1, 0.1, 0, 0.9, 0]
  ],
  'M': [
    [0.1, 0, 0.1, 1, 0.5, 0.4, 0.9, 1, 0.9, 0]
  ],
  'N': [
    [0.1, 0, 0.1, 1, 0.9, 0, 0.9, 1]
  ],
  'O': [
    [0.3, 0, 0.1, 0.2, 0.1, 0.8, 0.3, 1, 0.7, 1, 0.9, 0.8, 0.9, 0.2, 0.7, 0, 0.3, 0]
  ],
  'P': [
    [0.1, 0, 0.1, 1, 0.7, 1, 0.9, 0.8, 0.7, 0.5, 0.1, 0.5]
  ],
  'Q': [
    [0.3, 0, 0.1, 0.2, 0.1, 0.8, 0.3, 1, 0.7, 1, 0.9, 0.8, 0.9, 0.2, 0.7, 0, 0.3, 0],
    [0.6, 0.3, 0.95, -0.05]
  ],
  'R': [
    [0.1, 0, 0.1, 1, 0.7, 1, 0.9, 0.8, 0.7, 0.55, 0.1, 0.55],
    [0.55, 0.55, 0.9, 0]
  ],
  'S': [
    [0.85, 0.85, 0.6, 1, 0.3, 1, 0.1, 0.8, 0.2, 0.55, 0.8, 0.45, 0.9, 0.2, 0.7, 0, 0.3, 0, 0.15, 0.15]
  ],
  'T': [
    [0.1, 1, 0.9, 1],
    [0.5, 1, 0.5, 0]
  ],
  'U': [
    [0.1, 1, 0.1, 0.2, 0.3, 0, 0.7, 0, 0.9, 0.2, 0.9, 1]
  ],
  'V': [
    [0.1, 1, 0.5, 0, 0.9, 1]
  ],
  'W': [
    [0.1, 1, 0.25, 0, 0.5, 0.6, 0.75, 0, 0.9, 1]
  ],
  'X': [
    [0.1, 0, 0.9, 1],
    [0.1, 1, 0.9, 0]
  ],
  'Y': [
    [0.1, 1, 0.5, 0.55, 0.9, 1],
    [0.5, 0.55, 0.5, 0]
  ],
  'Z': [
    [0.1, 1, 0.9, 1, 0.1, 0, 0.9, 0]
  ],
  '-': [
    [0.1, 0.5, 0.9, 0.5]
  ],
  '+': [
    [0.1, 0.5, 0.9, 0.5],
    [0.5, 0.15, 0.5, 0.85]
  ],
  ':': [
    [0.45, 0.65, 0.55, 0.65],
    [0.45, 0.35, 0.55, 0.35]
  ],
  '.': [
    [0.4, 0.05, 0.6, 0.05]
  ],
  ',': [
    [0.55, 0.15, 0.4, -0.1]
  ],
  '/': [
    [0.15, 0, 0.85, 1]
  ],
  '\\': [
    [0.15, 1, 0.85, 0]
  ],
  '[': [
    [0.75, 1, 0.25, 1, 0.25, 0, 0.75, 0]
  ],
  ']': [
    [0.25, 1, 0.75, 1, 0.75, 0, 0.25, 0]
  ],
  '(': [
    [0.7, 1, 0.35, 0.75, 0.35, 0.25, 0.7, 0]
  ],
  ')': [
    [0.3, 1, 0.65, 0.75, 0.65, 0.25, 0.3, 0]
  ],
  '°': [ // Degree symbol
    [0.4, 0.95, 0.7, 0.95, 0.7, 0.7, 0.4, 0.7, 0.4, 0.95]
  ],
  '%': [
    [0.15, 0, 0.85, 1],
    [0.2, 0.9, 0.4, 0.9, 0.4, 0.7, 0.2, 0.7, 0.2, 0.9],
    [0.6, 0.3, 0.8, 0.3, 0.8, 0.1, 0.6, 0.1, 0.6, 0.3]
  ],
  '>': [
    [0.15, 0.85, 0.85, 0.5, 0.15, 0.15]
  ],
  '<': [
    [0.85, 0.85, 0.15, 0.5, 0.85, 0.15]
  ],
  '=': [
    [0.15, 0.65, 0.85, 0.65],
    [0.15, 0.35, 0.85, 0.35]
  ],
  '#': [
    [0.35, 0.05, 0.35, 0.95],
    [0.65, 0.05, 0.65, 0.95],
    [0.15, 0.65, 0.85, 0.65],
    [0.15, 0.35, 0.85, 0.35]
  ],
  '?': [
    [0.15, 0.8, 0.4, 1, 0.7, 1, 0.85, 0.8, 0.85, 0.6, 0.5, 0.4, 0.5, 0.25],
    [0.45, 0.05, 0.55, 0.05]
  ],
  '!': [
    [0.5, 1, 0.5, 0.3],
    [0.45, 0.05, 0.55, 0.05]
  ],
  '|': [
    [0.5, 0, 0.5, 1]
  ],
  '_': [
    [0, 0, 1, 0]
  ],
  ' ': []
};

// Map lowercase to uppercase
for (let c = 97; c <= 122; c++) {
  const lower = String.fromCharCode(c);
  const upper = String.fromCharCode(c - 32);
  GLYPH_STROKES[lower] = GLYPH_STROKES[upper];
}

/**
 * Builds 3D line segment coordinates for a given string (Option 1).
 */
export function buildVectorTextSegments(text, options = {}) {
  const size = options.size || 0.15;
  const aspect = options.aspect || 0.62; // character width = size * aspect
  const charWidth = size * aspect;
  const letterSpacing = (options.letterSpacing || 0.25) * charWidth;
  const lineSpacing = (options.lineSpacing || 1.35) * size;
  const align = options.align || 'left'; // 'left', 'center', 'right'

  const lines = text.split('\n');
  const lineSegmentPairs = []; // [x1, y1, z1, x2, y2, z2, ...]

  const totalHeight = lines.length * lineSpacing;

  lines.forEach((lineStr, lineIdx) => {
    const lineWidth = lineStr.length * (charWidth + letterSpacing) - letterSpacing;
    let startX = 0;
    if (align === 'center') startX = -lineWidth * 0.5;
    else if (align === 'right') startX = -lineWidth;

    // Y position (0 at top or centered)
    const lineY = (lines.length - 1 - lineIdx) * lineSpacing - (totalHeight * 0.5);

    let curX = startX;

    for (let i = 0; i < lineStr.length; i++) {
      const char = lineStr[i];
      const strokes = GLYPH_STROKES[char] || GLYPH_STROKES['?'];

      if (strokes && strokes.length > 0) {
        strokes.forEach(stroke => {
          for (let s = 0; s < stroke.length - 2; s += 2) {
            const x1 = curX + stroke[s] * charWidth;
            const y1 = lineY + stroke[s + 1] * size;
            const x2 = curX + stroke[s + 2] * charWidth;
            const y2 = lineY + stroke[s + 3] * size;

            lineSegmentPairs.push(x1, y1, 0, x2, y2, 0);
          }
        });
      }

      curX += charWidth + letterSpacing;
    }
  });

  return {
    positions: lineSegmentPairs,
    width: Math.max(...lines.map(l => l.length * (charWidth + letterSpacing) - letterSpacing)),
    height: totalHeight
  };
}

/**
 * Creates a THREE.BufferGeometry with 3D LineSegments (Option 1)
 */
export function buildVectorTextGeometry(text, options = {}) {
  const result = buildVectorTextSegments(text, options);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
  geo.userData = { width: result.width, height: result.height };
  return geo;
}

/**
 * Creates a complete THREE.LineSegments mesh for vector HUD text (Option 1).
 */
export function createVectorTextMesh(text, options = {}) {
  const color = options.color !== undefined ? options.color : 0x00e5ff;
  const opacity = options.opacity !== undefined ? options.opacity : 0.95;
  const blending = options.blending !== undefined ? options.blending : THREE.AdditiveBlending;

  const geo = buildVectorTextGeometry(text, options);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending,
    depthWrite: false
  });

  const lineMesh = new THREE.LineSegments(geo, mat);
  lineMesh.userData = {
    isVectorText: true,
    options: { ...options },
    width: geo.userData.width,
    height: geo.userData.height
  };

  /**
   * Fast dynamic text update method
   */
  lineMesh.setText = function (newText) {
    if (this.geometry) this.geometry.dispose();
    this.geometry = buildVectorTextGeometry(newText, this.userData.options);
    this.userData.width = this.geometry.userData.width;
    this.userData.height = this.geometry.userData.height;
  };

  lineMesh.setColor = function (newColor) {
    this.material.color.set(newColor);
  };

  return lineMesh;
}

/**
 * Option 2 Preparation: Generates 3D triangulated quad-ribbon geometry from vector strokes.
 * Each stroke line segment is extruded into a thin quad with 3D thickness.
 */
export function buildSolidTextGeometry(text, options = {}) {
  const segData = buildVectorTextSegments(text, options);
  const halfThick = (options.thickness || (options.size || 0.15) * 0.045);
  const pts = segData.positions;
  const vertices = [];
  const normals = [];

  for (let i = 0; i < pts.length; i += 6) {
    const x1 = pts[i], y1 = pts[i + 1];
    const x2 = pts[i + 3], y2 = pts[i + 4];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.0001) continue;

    // Normal perp vector in XY plane
    const px = (-dy / len) * halfThick;
    const py = (dx / len) * halfThick;

    // Quad corners:
    // v1: p1 - perp, v2: p1 + perp, v3: p2 + perp, v4: p2 - perp
    const v1 = [x1 - px, y1 - py, 0];
    const v2 = [x1 + px, y1 + py, 0];
    const v3 = [x2 + px, y2 + py, 0];
    const v4 = [x2 - px, y2 - py, 0];

    // Triangle 1: v1, v2, v3
    vertices.push(...v1, ...v2, ...v3);
    // Triangle 2: v1, v3, v4
    vertices.push(...v1, ...v3, ...v4);

    // Welded joint cap at p1
    vertices.push(
      x1 - px, y1 - py, 0,  x1 + px, y1 + py, 0,  x1 - py, y1 + px, 0,
      x1 + px, y1 + py, 0,  x1 + py, y1 - px, 0,  x1 - py, y1 + px, 0
    );

    for (let k = 0; k < 12; k++) normals.push(0, 0, 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.userData = { width: segData.width, height: segData.height };
  return geo;
}

/**
 * Creates a solid 3D mesh (Option 2)
 */
export function createSolidTextMesh(text, options = {}) {
  const color = options.color !== undefined ? options.color : 0x00e5ff;
  const opacity = options.opacity !== undefined ? options.opacity : 0.95;

  const geo = buildSolidTextGeometry(text, options);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = {
    isSolidText: true,
    options: { ...options },
    width: geo.userData.width,
    height: geo.userData.height
  };

  mesh.setText = function (newText) {
    if (this.geometry) this.geometry.dispose();
    this.geometry = buildSolidTextGeometry(newText, this.userData.options);
    this.userData.width = this.geometry.userData.width;
    this.userData.height = this.geometry.userData.height;
  };

  mesh.setColor = function (newColor) {
    this.material.color.set(newColor);
  };

  return mesh;
}

/**
 * Unified HUD Text Creator
 * Automatically renders Option 1 (Vector Stroke) or Option 2 (Solid Shape) based on mode.
 */
export function createHUDText(text, options = {}) {
  const mode = options.mode || ACTIVE_FONT_MODE;
  if (mode === FONT_MODE.SOLID) {
    return createSolidTextMesh(text, options);
  }
  return createVectorTextMesh(text, options);
}
