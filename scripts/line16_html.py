#!/usr/bin/env python3
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'frontend/public/data/line16_test.json'
OUT = ROOT / 'frontend/public/debug/line16.html'
D = json.loads(SRC.read_text())

W, H = 1240, 820
MAP_W, MAP_H = 900, 760
OX, OY = 20, 20
pts = [[p[0], p[1]] for p in D['path']]
for seg in D['roads']:
    pts.extend(seg)
minx = min(p[0] for p in pts); maxx = max(p[0] for p in pts)
miny = min(p[1] for p in pts); maxy = max(p[1] for p in pts)
sx = (MAP_W - 2*OX) / max(0.001, maxx - minx)
sy = (MAP_H - 2*OY) / max(0.001, maxy - miny)
def P(x, y):
    return (OX + (x - minx) * sx, OY + (maxy - y) * sy)

road_svg = []
for seg in D['roads']:
    ps = ' '.join(f'{P(x,y)[0]:.1f},{P(x,y)[1]:.1f}' for x, y in seg)
    road_svg.append(f'<polyline class="road" points="{ps}" vector-effect="non-scaling-stroke"/>')
path_pts = ' '.join(f'{P(x,y)[0]:.1f},{P(x,y)[1]:.1f}' for x, y in D['path'])
for s in D['stops']:
    s['sx'], s['sy'] = P(s['xy'][0], s['xy'][1])
for s in D['samples']:
    s['sx'], s['sy'] = P(s['xy'][0], s['xy'][1])
stop_svg = ''.join(
    f'<circle class="stop" cx="{s["sx"]:.1f}" cy="{s["sy"]:.1f}" r="3.6"><title>{s["seq"]}. {s["name"]} ({s["arrival"]})</title></circle>'
    for s in D['stops'])

# speed graph
vmax = max(1.0, max(s['v'] for s in D['samples']))
tmax = max(1.0, D['samples'][-1]['t'])
gx, gy, gw, gh = 770, 430, 200, 110
speed_pts = ' '.join(
    f'{gx + (s["t"]/tmax)*gw:.1f},{gy + gh - (s["v"]/vmax)*gh:.1f}'
    for s in D['samples'][::4]
)

rows = ''.join(
    f'<tr><td>{s["seq"]}</td><td>{s["name"]}</td><td>{s["arrival"]}</td><td>{s["est_arrival"]}</td><td>{s["sim_arrival"]}</td><td>{s["sim_depart"]}</td><td>{s["chain_km"]:.2f}</td></tr>'
    for s in D['stops'])

html = '''<!doctype html>
<html><head><meta charset="utf-8"><title>Line 16 test - Yokneam</title>
<style>
body{margin:0;background:#01050d;color:#bdefff;font-family:"Courier New",monospace}
.wrap{display:flex;height:100vh}
.map{width:900px;flex:0 0 900px;border-right:1px solid #0e3866;position:relative}
.side{flex:1;padding:12px;overflow:auto}
h1{font-size:15px;letter-spacing:2px;color:#00e5ff;margin:10px 16px 2px}
.sub{font-size:10px;color:#70d8ff;margin:0 16px 8px}
svg{display:block}
.road{fill:none;stroke:#0e3866;stroke-width:0.8;opacity:.75}
.route{fill:none;stroke:#00e5ff;stroke-width:2.4;filter:drop-shadow(0 0 3px #00e5ff)}
.stop{fill:#ffe600;stroke:#ff8f00;stroke-width:1}
.bus{fill:#ffffff;stroke:#00e5ff;stroke-width:2}
.grid{stroke:#154c8a;stroke-width:.5;opacity:.4}
text{fill:#70d8ff;font-size:10px}
.card{border:1px solid #0e3866;padding:8px;margin:8px 0;background:rgba(1,15,30,.55)}
.big{font-size:22px;color:#00e5ff}
.warn{color:#ffb300}
.zoom{position:absolute;left:16px;bottom:16px;display:flex;gap:6px;align-items:center;z-index:5}
.zoom button{background:#0e3866;color:#00e5ff;border:1px solid #00e5ff;padding:4px 9px;font-family:inherit;cursor:pointer}
.zoom span{font-size:10px;color:#70d8ff}
table{border-collapse:collapse;width:100%;font-size:10px}
td,th{padding:2px 4px;border-bottom:1px solid #0e3866;text-align:left}
th{color:#00e5ff}
label{font-size:11px;color:#ffe600}
</style></head><body>
<div class="wrap">
<div class="map"><h1>LINE 16 — YOKNEAM ILIT</h1><div class="sub">TomTom path reconstruction · timetable · bell speed profile</div>
<svg id="mapsvg" width="900" height="760" viewBox="0 0 900 760">
<g id="mapg">
__ROADS__
<polyline class="route" points="__PATH__" vector-effect="non-scaling-stroke"/>
__STOPS__
<circle id="bus" class="bus" r="3" cx="0" cy="0"/>
</g>
</svg>
<div class="zoom"><button id="zin">+</button><button id="zout">−</button><button id="fit">FIT</button><span>wheel / drag</span></div></div>
<div class="side">
<div class="card"><div class="big" id="clock">--:--</div>
<div>TIME <span id="state">RUNNING</span> · <span id="speed">0</span> km/h · ELEV <span id="elev">--</span> m · DWELL 10s</div>
<label><input type="checkbox" id="delay"> apply +__DELAY__s delay</label>
<button id="play">PAUSE</button></div>
<div class="card"><b>LINE 16</b><br>__ROUTE__<br>__START__ → __END__<br>path __PATHKM__ km · elev __ELEVMIN__–__ELEVMAX__ m</div>
<div class="card"><b>SPEED PROFILE (km/h)</b><br>
<svg width="220" height="130" viewBox="0 0 220 130">
<line class="grid" x1="10" y1="120" x2="210" y2="120"/><line class="grid" x1="10" y1="10" x2="10" y2="120"/>
<text x="14" y="16">__VMAX__</text><text x="180" y="132">time</text>
<polyline points="__SPEED__" fill="none" stroke="#ffe600" stroke-width="1.6"/>
</svg></div>
<div class="card"><b>STOPS / SCHEDULE</b><table><tr><th>#</th><th>stop</th><th>sched</th><th>est</th><th>sim</th><th>dep</th><th>km</th></tr>__ROWS__</table></div>
</div></div>
<script>
const D=__DATA__;
const samples=D.samples;
const bus=document.getElementById('bus');
const svg=document.getElementById('mapsvg');
const mapg=document.getElementById('mapg');
let z=4.0, tx=450-450*z, ty=380-380*z, drag=null;
function applyMap(){mapg.setAttribute('transform',`translate(${tx},${ty}) scale(${z})`);}
applyMap();
svg.addEventListener('wheel', e=>{e.preventDefault(); const r=svg.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top; const k=e.deltaY<0?1.15:0.87; const nz=Math.min(12,Math.max(1,z*k)); tx=mx-(mx-tx)*(nz/z); ty=my-(my-ty)*(nz/z); z=nz; applyMap();}, {passive:false});
svg.addEventListener('pointerdown', e=>{drag={x:e.clientX,y:e.clientY,tx,ty}; svg.setPointerCapture(e.pointerId);});
svg.addEventListener('pointermove', e=>{if(!drag)return; tx=drag.tx+(e.clientX-drag.x); ty=drag.ty+(e.clientY-drag.y); applyMap();});
svg.addEventListener('pointerup', ()=>drag=null);
document.getElementById('zin').onclick=()=>{z=Math.min(12,z*1.3); applyMap();};
document.getElementById('zout').onclick=()=>{z=Math.max(1,z/1.3); applyMap();};
document.getElementById('fit').onclick=()=>{z=1; tx=0; ty=0; applyMap();};
const clock=document.getElementById('clock');
const speedEl=document.getElementById('speed');
const elevEl=document.getElementById('elev');
const stateEl=document.getElementById('state');
const delayEl=document.getElementById('delay');
const playEl=document.getElementById('play');
let simT=0, last=performance.now(), playing=true;
function sampleAt(t){
  let lo=0, hi=samples.length-1;
  if(t<=samples[0].t) return samples[0];
  if(t>=samples[hi].t) return samples[hi];
  while(lo<hi-1){const m=(lo+hi)>>1; if(samples[m].t<=t) lo=m; else hi=m;}
  const a=samples[lo], b=samples[hi], span=b.t-a.t||1;
  const u=(t-a.t)/span;
  return {sx:a.sx+(b.sx-a.sx)*u, sy:a.sy+(b.sy-a.sy)*u, v:a.v+(b.v-a.v)*u, t:t};
}
function fmt(t){const m=Math.floor(t/60),s=Math.floor(t%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  if(playing){simT+=dt*30; if(simT>samples[samples.length-1].t+4) simT=0;}
  const eff=delayEl.checked?Math.max(0,simT-D.delay_s):simT;
  const s=sampleAt(eff);
  bus.setAttribute('cx',s.sx); bus.setAttribute('cy',s.sy);
  clock.textContent=fmt(eff); speedEl.textContent=Math.round(s.v); elevEl.textContent=Math.round(s.ground_y/3.0*1000);
  requestAnimationFrame(frame);
}
playEl.onclick=()=>{playing=!playing; playEl.textContent=playing?'PAUSE':'PLAY'; stateEl.textContent=playing?'RUNNING':'PAUSED';};
requestAnimationFrame(frame);
</script></body></html>'''

html = (html.replace('__ROADS__', ''.join(road_svg))
            .replace('__PATH__', path_pts)
            .replace('__STOPS__', stop_svg)
            .replace('__SPEED__', speed_pts)
            .replace('__ROWS__', rows)
            .replace('__DATA__', json.dumps({'samples': D['samples'], 'delay_s': D['delay_s']}, ensure_ascii=False))
            .replace('__DELAY__', str(D['delay_s']))
            .replace('__START__', D['scheduled_start'][11:19])
            .replace('__END__', D['scheduled_end'][11:19])
            .replace('__ROUTE__', D['route_name'])
            .replace('__PATHKM__', str(D['path_km']))
            .replace('__VMAX__', f'{vmax:.0f}')
            .replace('__ELEVMIN__', str(round(min(D['path_y'])/3*1000)))
            .replace('__ELEVMAX__', str(round(max(D['path_y'])/3*1000))))
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print('wrote', OUT, len(html), 'bytes', 'vmax', vmax)
