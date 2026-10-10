import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './rng.js';
import { HALF, STREET, streetLines } from './city.js';
import { CAR_VERT, CAR_FRAG, CONE_VERT, CONE_FRAG } from './shaders.js';

export const MAX_CARS = 16000;
export const CAR_SCALE = 1.6;
const ALTS = [38, 62, 90, 120, 155, 195, 240, 290, 350, 420, 500];
const OVERRUN = 150; // lanes extend past the city so wrap-around happens in the fog
const PAINT = [
  [0.8, 0.8, 0.82], [0.8, 0.8, 0.82], [0.03, 0.03, 0.035], [0.03, 0.03, 0.035],
  [0.5, 0.52, 0.55], [0.5, 0.52, 0.55], [0.6, 0.04, 0.03], [0.85, 0.55, 0.02],
  [0.02, 0.25, 0.3], [0.15, 0.17, 0.22], [0.15, 0.17, 0.22],
];

// Side profile (forward, up) extruded across the car's width, then turned to face +z.
function profile(points, width) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), {
    depth: width,
    bevelEnabled: false,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

// Flying car facing +z. aPart: 0 body, 1 headlight, 2 tail bar, 3 underglow, 4 cabin glass.
function carGeometry() {
  const body = profile([[-2.3, 0.25], [2.3, 0.25], [2.4, 0.5], [2.0, 0.75], [-2.2, 0.8], [-2.35, 0.55]], 2.1);
  const cabin = profile([[-1.6, 0.74], [1.05, 0.74], [0.1, 1.25], [-1.3, 1.2]], 1.75);

  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    return g;
  };
  const parts = [
    [body, 0],
    [cabin, 4],
    [box(0.5, 0.16, 0.08, 0.7, 0.45, 2.38), 1],
    [box(0.5, 0.16, 0.08, -0.7, 0.45, 2.38), 1],
    [box(1.9, 0.12, 0.1, 0, 0.62, -2.33), 2],
    [box(0.5, 0.06, 0.5, 0.75, 0.22, 1.5), 3],
    [box(0.5, 0.06, 0.5, -0.75, 0.22, 1.5), 3],
    [box(0.5, 0.06, 0.5, 0.75, 0.22, -1.5), 3],
    [box(0.5, 0.06, 0.5, -0.75, 0.22, -1.5), 3],
  ];
  for (const [g, part] of parts) {
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
  }
  const geo = mergeGeometries(parts.map(([g]) => g));
  geo.scale(CAR_SCALE, CAR_SCALE, CAR_SCALE);
  return geo;
}

// Open cone with its apex at the headlights, opening forward and slightly down.
function coneGeometry() {
  const length = 34;
  const g = new THREE.ConeGeometry(3.5, length, 12, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, length / 2);
  g.rotateX(0.12);
  const pos = g.attributes.position;
  const along = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) along[i] = pos.getZ(i) / length;
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.translate(0, 0.45 * CAR_SCALE, 2.4 * CAR_SCALE);
  return g;
}

export function buildTraffic(seed, U) {
  const rng = makeRng(seed ^ 0x2545f491);
  const lanes = [];
  for (const axis of [0, 1]) {
    for (const line of streetLines) {
      ALTS.forEach((alt, level) => {
        for (const dir of [1, -1]) {
          const rightSide = axis === 0 ? dir : -dir; // right-hand traffic
          const off = rightSide * (STREET * 0.2 + (level % 2) * 2.5);
          const speed = (28 + alt * 0.09) * rng.range(0.85, 1.15);
          lanes.push({ axis, line, alt, dir, off, speed, weight: 1 / (1 + alt / 250) });
        }
      });
    }
  }
  const cumulative = [];
  let total = 0;
  for (const l of lanes) cumulative.push((total += l.weight));
  const pickLane = () => {
    const r = rng.next() * total;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1; else hi = mid;
    }
    return lanes[lo];
  };

  const origin = new Float32Array(MAX_CARS * 3);
  const dir = new Float32Array(MAX_CARS * 2);
  const motion = new Float32Array(MAX_CARS * 4);
  const color = new Float32Array(MAX_CARS * 3);
  const index = new Float32Array(MAX_CARS);
  const length = 2 * (HALF + OVERRUN);
  // Cars are generated in random lane order, so the first N are a uniform sample:
  // the traffic slider simply draws fewer instances.
  for (let i = 0; i < MAX_CARS; i++) {
    const lane = pickLane();
    const start = lane.dir > 0 ? -HALF - OVERRUN : HALF + OVERRUN;
    const perp = lane.line + lane.off + rng.range(-2.5, 2.5);
    const y = lane.alt + rng.range(-3, 3);
    if (lane.axis === 0) {
      origin.set([start, y, perp], i * 3);
      dir.set([lane.dir, 0], i * 2);
    } else {
      origin.set([perp, y, start], i * 3);
      dir.set([0, lane.dir], i * 2);
    }
    motion.set([length, lane.speed * rng.range(0.92, 1.08), rng.next() * length, rng.next() * Math.PI * 2], i * 4);
    color.set(rng.pick(PAINT), i * 3);
    index[i] = i;
  }

  const shared = {
    aOrigin: new THREE.InstancedBufferAttribute(origin, 3),
    aDir: new THREE.InstancedBufferAttribute(dir, 2),
    aMotion: new THREE.InstancedBufferAttribute(motion, 4),
    aColor: new THREE.InstancedBufferAttribute(color, 3),
    aIndex: new THREE.InstancedBufferAttribute(index, 1),
  };
  const uHidden = { value: -1 };
  const coneUniforms = { ...U, uHidden };

  const baseCar = carGeometry();
  const baseCone = coneGeometry();
  const carGeo = new THREE.InstancedBufferGeometry().copy(baseCar);
  const coneGeo = new THREE.InstancedBufferGeometry().copy(baseCone);
  for (const [name, attr] of Object.entries(shared)) {
    carGeo.setAttribute(name, attr);
    coneGeo.setAttribute(name, attr);
  }

  const carMat = new THREE.ShaderMaterial({ uniforms: { ...U, uHidden }, vertexShader: CAR_VERT, fragmentShader: CAR_FRAG });
  const coneMat = new THREE.ShaderMaterial({
    uniforms: coneUniforms,
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const cars = new THREE.Mesh(carGeo, carMat);
  const cones = new THREE.Mesh(coneGeo, coneMat);
  cars.frustumCulled = false;
  cones.frustumCulled = false;
  cones.renderOrder = 2;

  const group = new THREE.Group();
  group.add(cars, cones);

  const heroColor = { value: new THREE.Vector3(0.82, 0.82, 0.85) };
  const heroBody = new THREE.Mesh(baseCar, new THREE.ShaderMaterial({
    uniforms: { ...U, uHeroColor: heroColor },
    defines: { HERO: '' },
    vertexShader: CAR_VERT,
    fragmentShader: CAR_FRAG,
  }));
  const heroCone = new THREE.Mesh(baseCone, new THREE.ShaderMaterial({
    uniforms: { ...U, uHeroColor: heroColor },
    defines: { HERO: '' },
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }));
  heroCone.renderOrder = 2;

  const traffic = {
    group,
    heroBody,
    heroCone,
    count: 0,
    get hidden() { return uHidden.value; },
    setHidden(i) { uHidden.value = i; },
    setDensity(fraction) {
      traffic.count = Math.round(MAX_CARS * Math.min(1, Math.max(0, fraction)));
      carGeo.instanceCount = traffic.count;
      coneGeo.instanceCount = traffic.count;
    },
    // Mirrors CAR_PLACE in shaders.js.
    carPos(i, t, out) {
      const L = motion[i * 4];
      const raw = motion[i * 4 + 2] + motion[i * 4 + 1] * t;
      const s = raw - L * Math.floor(raw / L);
      return out.set(
        origin[i * 3] + dir[i * 2] * s,
        origin[i * 3 + 1] + Math.sin(t * 1.3 + motion[i * 4 + 3]) * 0.35,
        origin[i * 3 + 2] + dir[i * 2 + 1] * s,
      );
    },
    carDir(i) { return [dir[i * 2], dir[i * 2 + 1]]; },
    carSpeed(i) { return motion[i * 4 + 1]; },
    carColor(i) { return [color[i * 3], color[i * 3 + 1], color[i * 3 + 2]]; },
    setHeroColor(rgb) { heroColor.value.set(...rgb); },
    dispose() {
      for (const o of [cars, cones, heroBody, heroCone]) {
        o.geometry.dispose();
        o.material.dispose();
      }
      baseCar.dispose();
      baseCone.dispose();
    },
  };
  return traffic;
}
