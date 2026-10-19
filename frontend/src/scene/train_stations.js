import * as THREE from 'three';

/**
 * Train station markers only.
 *
 * The old version attached a large vector timetable card to each station pin.
 * Those pin-following cards are intentionally removed: the map keeps the
 * surveyed station reticle, beacon and head sphere, with no floating banner.
 */
export class TrainStationManager {
  constructor(scene, camera, svgOverlay = null, config = {}) {
    this.scene = scene;
    this.camera = camera;
    this.svgOverlay = svgOverlay;
    this.config = config;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Exact surveyed coordinates from OSM rail siding 432811340
    this.stations = [
      {
        id: 'STN-YOKNEAM',
        name: 'YOKNEAM - KFAR YEHOSHUA',
        hebrewName: 'תחנת הרכבת יקנעם - כפר יהושע',
        lat: 32.6804,
        lon: 35.1266,
        line: 'Jezreel Valley Line (HaEmek)'
      }
    ];

    this.stationObjects = [];
  }

  buildStations(elevationSampler = null) {
    while (this.group.children.length > 0) {
      const obj = this.group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.stationObjects = [];

    const R_EARTH_KM = 6371.0;
    const rad = Math.PI / 180;
    const lat0 = (this.config.centerLat || 32.6595) * rad;
    const lon0 = (this.config.centerLon || 35.1090) * rad;
    const maxRadius = this.config.radiusKm || 10.0;

    this.stations.forEach(stn => {
      const phi = stn.lat * rad;
      const lam = stn.lon * rad;
      const x = R_EARTH_KM * (lam - lon0) * Math.cos((phi + lat0) * 0.5);
      const z = -R_EARTH_KM * (phi - lat0);

      if (Math.hypot(x, z) > maxRadius) return;

      const yGround = (elevationSampler ? elevationSampler(stn.lat, stn.lon) : 0.05) + 0.05;

      // Tactical station reticle on the tracks (diamond).
      const size = 0.45;
      const pts = [
        new THREE.Vector3(x, yGround, z - size),
        new THREE.Vector3(x + size, yGround, z),
        new THREE.Vector3(x, yGround, z + size),
        new THREE.Vector3(x - size, yGround, z),
        new THREE.Vector3(x, yGround, z - size)
      ];
      const reticleGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const reticleMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      this.group.add(new THREE.Line(reticleGeo, reticleMat));

      // Vertical drop-pin beacon.
      const beaconHeight = 1.35;
      const beaconGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, yGround, z),
        new THREE.Vector3(x, yGround + beaconHeight, z)
      ]);
      const beaconMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.9
      });
      this.group.add(new THREE.Line(beaconGeo, beaconMat));

      // Beacon head.
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      sphere.position.set(x, yGround + beaconHeight, z);
      this.group.add(sphere);

      this.stationObjects.push({
        station: stn,
        pinPos: new THREE.Vector3(x, yGround + beaconHeight, z)
      });
    });
  }
}
