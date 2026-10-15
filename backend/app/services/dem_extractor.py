"""
DEM Extractor and Contour Generation Benchmark
Compares Marching Squares contour generation in Python vs JavaScript
using real AWS Terrarium global DEM tiles.
"""

import io
import math
import time
import httpx
import numpy as np
from PIL import Image
from typing import List, Dict, Any, Tuple

def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> Tuple[int, int]:
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def num2deg(xtile: int, ytile: int, zoom: int) -> Tuple[float, float]:
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return (lat_deg, lon_deg)

def fetch_terrarium_tile(lat: float, lon: float, zoom: int = 11) -> Tuple[np.ndarray, Dict[str, float]]:
    xtile, ytile = deg2num(lat, lon, zoom)
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{zoom}/{xtile}/{ytile}.png"
    
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(url)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch DEM tile: HTTP {resp.status_code}")
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        arr = np.array(img, dtype=np.float32)
        elev = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0

    lat_max, lon_min = num2deg(xtile, ytile, zoom)
    lat_min, lon_max = num2deg(xtile + 1, ytile + 1, zoom)

    bounds = {
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max,
        "zoom": zoom,
        "xtile": xtile,
        "ytile": ytile
    }
    return elev, bounds

def marching_squares_contour(grid: np.ndarray, isovalue: float) -> List[Tuple[Tuple[float, float], Tuple[float, float]]]:
    ny, nx = grid.shape
    c_bl = grid[:-1, :-1] >= isovalue
    c_br = grid[:-1, 1:] >= isovalue
    c_tr = grid[1:, 1:] >= isovalue
    c_tl = grid[1:, :-1] >= isovalue

    case_indices = (c_bl.astype(int) * 1) | (c_br.astype(int) * 2) | (c_tr.astype(int) * 4) | (c_tl.astype(int) * 8)
    segments = []

    for y in range(ny - 1):
        for x in range(nx - 1):
            code = case_indices[y, x]
            if code == 0 or code == 15:
                continue

            v_bl = grid[y, x]
            v_br = grid[y, x + 1]
            v_tr = grid[y + 1, x + 1]
            v_tl = grid[y + 1, x]

            def b_pt():
                t = (isovalue - v_bl) / (v_br - v_bl) if v_br != v_bl else 0.5
                return (x + t, y)

            def r_pt():
                t = (isovalue - v_br) / (v_tr - v_br) if v_tr != v_br else 0.5
                return (x + 1, y + t)

            def t_pt():
                t = (isovalue - v_tl) / (v_tr - v_tl) if v_tr != v_tl else 0.5
                return (x + t, y + 1)

            def l_pt():
                t = (isovalue - v_bl) / (v_tl - v_bl) if v_tl != v_bl else 0.5
                return (x, y + t)

            if code == 1 or code == 14:
                segments.append((l_pt(), b_pt()))
            elif code == 2 or code == 13:
                segments.append((b_pt(), r_pt()))
            elif code == 3 or code == 12:
                segments.append((l_pt(), r_pt()))
            elif code == 4 or code == 11:
                segments.append((r_pt(), t_pt()))
            elif code == 5:
                segments.append((l_pt(), t_pt()))
                segments.append((b_pt(), r_pt()))
            elif code == 6 or code == 9:
                segments.append((b_pt(), t_pt()))
            elif code == 7 or code == 8:
                segments.append((l_pt(), t_pt()))
            elif code == 10:
                segments.append((l_pt(), b_pt()))
                segments.append((r_pt(), t_pt()))

    return segments

def run_python_benchmark(elev: np.ndarray, step_m: float = 25.0) -> Dict[str, Any]:
    min_e = float(np.min(elev))
    max_e = float(np.max(elev))
    isovals = np.arange(math.ceil(min_e / step_m) * step_m, max_e, step_m)

    t0 = time.perf_counter()
    total_segments = 0
    for iso in isovals:
        segs = marching_squares_contour(elev, iso)
        total_segments += len(segs)
    t1 = time.perf_counter()

    return {
        "runtime_ms": round((t1 - t0) * 1000, 2),
        "isovals_count": len(isovals),
        "total_segments": total_segments,
        "grid_shape": list(elev.shape)
    }
