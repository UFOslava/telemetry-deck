# Tactical Holographic Telemetry Deck: Architecture & Implementation Spec

## 1. Executive Summary & Vision

The objective is to translate the aesthetic of the futuristic, radar-style circular holographic HUD wallpaper into a live, real-time data visualization running in modern browsers. 

The application runs as a local web service (e.g. Dockerized backend + WebGL frontend). Any client on the LAN can access the viewport in fullscreen/kiosk mode or embed it as a live desktop background without cloud dependencies or paid API keys.

---

## 2. Visual & Geometric Aesthetic

### 2.1 Color Palette & Materials
* **Background:** Deep Void Blue-Black (`#01050d` to `#020916`).
* **Primary Topography:** Neon Cyan (`#00e5ff`) with soft glow / additive blending.
* **Telemetry Targets & Tracking Rings:** Electric Amber / Orange (`#ff6a00`, `#ff8f00`).
* **Radial Grid & Reticles:** Muted Navy / Cobalt (`#0e3866`, `#154c8a`).
* **Data Indicators & Vector Trails:** Ice White (`#e0f7fa`) with variable alpha opacity ($0.2$ to $0.8$).

### 2.2 Camera & Projection Setup
* **Projection:** 3D Perspective with an oblique tilt ($55^\circ$ to $65^\circ$ pitch angle looking down from the South/South-West toward the center).
* **Center Origin $(0, 0, 0)$:** Anchor coordinates (e.g., local home coordinates or regional center).
* **Coordinate Mapping:**
  * Latitude $\phi$ / Longitude $\lambda$ converted to local metric Cartesian coordinates $(x, z)$ via Equirectangular or Local Tangent Plane (ENU - East, North, Up) projection:
    $$x = R \cdot (\lambda - \lambda_0) \cos\left(\frac{\phi + \phi_0}{2}\right)$$
    $$z = -R \cdot (\phi - \phi_0)$$
    $$y = \text{elevation} \cdot s_y \quad \text{(where $s_y$ is vertical exaggeration, typically $1.5\times$ to $2.5\times$)}$$
* **Circular Masking:** All data layers (topography, grids) are clipped to a circular radius $R_{\text{max}}$ (e.g., $15\text{ km}$ to $25\text{ km}$) with a bright edge ring.

---

## 3. Data Ingestion & Pipelines

All data streams run on zero-cost, public APIs and open datasets. The backend orchestrates caching to respect rate limits and maintain high frame rates on endpoints.

### 3.1 Static Layer: Topography / Elevation Isolines
* **Source:** Copernicus DEM GLO-30 or NASA SRTM 30m (free GeoTIFF).
* **Generation (Offline or Startup Script):**
  1. Clip DEM raster to a bounding box around the local origin ($\pm 25\text{ km}$).
  2. Generate vector contour lines at intervals (e.g., $25\text{m}$ or $50\text{m}$) using GDAL:
     ```bash
     gdal_contour -a elev -i 25.0 regional_dem.tif contours.geojson
     ```
  3. Filter contours by clipping inside radius $R_{\text{max}}$.
  4. Convert to compressed flat binary vertex buffers or lightweight GeoJSON line-strips with normalized local $(x, y, z)$ coordinates.

### 3.2 Dynamic Layer: Public Transit & Road Tracking (30s Polling)
* **Sources:**
  * **Israel MoT SIRI / Open Bus Stride API (Hasadna):** Free REST API providing live vehicle positions and route numbers across Israeli operators.
  * **GTFS-RT Feeds (MoT / Data.gov.il):** Protocol buffer streams.
* **Visualization Mapping:**
  * Active buses within range are rendered as glowing white/orange nodes.
  * Vertical drop-pins (tether lines) extend from each vehicle down to the ground plane or terrain elevation, matching the visual markers in the reference wallpaper.
  * Velocity vectors indicate direction and speed.

### 3.3 Dynamic Layer: Flight Telemetry (10s Polling)
* **Source:** **OpenSky Network REST API** (`/api/states/all` with bounding box).
* **Visualization Mapping:**
  * High-altitude aircraft render on a higher $Y$-plane.
  * Dashed radial tracking vectors connect selected flights to peripheral HUD reticles (e.g., target boxes like `ZH`, `FL240`, speed in knots).

### 3.4 Dynamic Layer: Meteorological & Solar Trends (10m Polling)
* **Source:** **Open-Meteo Forecast API** (No key required, CORS-enabled).
* **Visualization Mapping:**
  * **Upper Curved Ribbon / HUD Arc:** 24-hour temperature, barometric pressure, and humidity curves drawn along the top circular boundary.
  * **Solar & Lunar Tracker:** Compute solar azimuth and elevation; render an orbital marker around the outer perimeter ring.

---

## 4. System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Host Backend (Python)                    │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │  DEM Preprocessor     │       │  OpenSky / Transit    │  │
│  │  (GDAL / Rasterio)    │       │  Polling Workers      │  │
│  └──────────┬────────────┘       └──────────┬────────────┘  │
│             │                               │               │
│             ▼                               ▼               │
│      [Static Contours]             [FastAPI In-Memory Cache]│
│             │                               │               │
│             └───────────────┬───────────────┘               │
│                             │ WebSocket / REST API          │
└─────────────────────────────┼───────────────────────────────┘
                              │ LAN (HTTP/WS)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Frontend Viewport (HTML5 / WebGL)              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Rendering Engine (Three.js / WebGL)                  │  │
│  │   - LineSegments2 (Fat glowing lines)                 │  │
│  │   - InstancedMesh (Nodes, drop pins, reticles)        │  │
│  │   - Custom Shader Materials (Additive blending)       │  │
│  │   - EffectComposer (UnrealBloomPass post-processing)  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  2D Canvas / SVG Overlay (Curved HUD meters, telemetry│  │
│  │  readouts, coordinate ticks)                          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Frontend Implementation Details

### 5.1 Technology Stack
* **Three.js** (Core 3D engine, camera control, lighting, materials).
* **Three.js Postprocessing:** `EffectComposer`, `RenderPass`, `UnrealBloomPass` (essential for reproducing the neon-on-dark holographic sheen).
* **SVG / Canvas 2D Overlay:** Used for high-contrast crisp text readouts (bearing angles, coordinates, flight identifiers) mapped to screen space or 3D sprites.

### 5.2 Scene Hierarchy & Layers
1. **Grid Base:**
   * Concentric polar range rings ($5\text{ km}, 10\text{ km}, 15\text{ km}, 20\text{ km}$).
   * Radial spokes at $30^\circ$ increments with angular tick marks.
   * Outer compass azimuth ring with bearing markers ($0^\circ$ to $360^\circ$).
2. **Topographic Terrain:**
   * Rendered using `THREE.LineSegments` or `Line2` (from `three/addons/lines/Line2.js`) to support screen-space line widths.
   * Vertex shader computes elevation-dependent opacity/color intensity.
3. **Dynamic Object Layer:**
   * Instanced drop-pins: A line from $(x, y_{\text{terrain}}, z)$ to $(x, y_{\text{object}}, z)$ with a point light or circular marker at the top.
   * Node pulse animations: Small sine-wave scale oscillations ($1.0 + 0.15 \cdot \sin(\omega t)$) on active targets.
4. **Upper Horizon HUD:**
   * Cylindrical or curved banner geometry placed at the back edge of the scene carrying weather line charts and data histograms.

---

## 6. Project Directory Structure

```text
telemetry-deck/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py               # FastAPI entrypoint + WS router
│   │   ├── config.py             # Center Lat/Lon, bounding radiuses
│   │   ├── services/
│   │   │   ├── dem_extractor.py  # Contour vector extraction (SRTM/Copernicus)
│   │   │   ├── transit_poller.py # SIRI / Stride API client
│   │   │   ├── flight_poller.py  # OpenSky client
│   │   │   └── weather_poller.py # Open-Meteo client
│   │   └── data/
│   │       └── raw_dem.tif       # Regional DEM tile
└── frontend/
    ├── package.json
    ├── index.html
    ├── src/
    │   ├── main.js               # WebGL setup, render loop
    │   ├── scene/
    │   │   ├── camera.js         # Fixed oblique perspective
    │   │   ├── bloom.js          # UnrealBloomPass pipeline
    │   │   ├── polar_grid.js     # Concentric rings & radial spokes
    │   │   ├── contours.js       # Topography line-strip builder
    │   │   ├── telemetry_pins.js # Vehicle & plane drop-markers
    │   │   └── curved_hud.js     # Top horizon weather charts
    │   └── network/
    │       └── data_stream.js    # WebSocket client & buffer state
```

---

## 7. Recommended Implementation Milestones

1. **Milestone 1 — The Static Holographic Stage:**
   * Set up Three.js scene with fixed tilted camera and `UnrealBloomPass`.
   * Draw the procedural polar grid (concentric rings, radial rays, degree ticks).
   * Ingest static DEM contours and verify 3D elevation profile against the dark backdrop.
2. **Milestone 2 — Live Environmental HUD:**
   * Wire Open-Meteo hourly weather into the top curved graph arc.
   * Add solar angle tracker on the perimeter ring.
3. **Milestone 3 — Live Tracking & Vectors:**
   * Implement backend poller for OpenSky flights and local transit.
   * Stream live coordinates via WebSocket.
   * Render dynamic vertical drop-pins with smooth interpolation between updates.