import * as THREE from 'three';
import { makeRng, makeNoise } from './rng.js';
import {
  TOWER_VERT, TOWER_FRAG, NEON_VERT, NEON_FRAG,
  BEACON_VERT, BEACON_FRAG, GROUND_VERT, GROUND_FRAG,
} from './shaders.js';

// Manhattan grid: GRID x GRID blocks separated by streets. Street centrelines
// sit at -HALF + k * PITCH for k = 0..GRID; flying traffic follows them.
export const GRID = 30;
export const PITCH = 92;
export const STREET = 28;
export const BLOCK = PITCH - STREET;
export const HALF = (GRID * PITCH) / 2;
export const streetLines = Array.from({ length: GRID + 1 }, (_, k) => -HALF + k * PITCH);

export function nearestStreetIndex(v) {
  return Math.max(0, Math.min(GRID, Math.round((v + HALF) / PITCH)));
}

// Window cell sizes per facade style; must match cellFor() in TOWER_FRAG.
const CELLS = [[3.2, 4], [4.5, 4], [6, 4], [3.6, 4.4]];
const TINTS = [
  [[0.16, 0.2, 0.26], [0.12, 0.15, 0.2], [0.2, 0.22, 0.25]], // glass curtain
  [[0.3, 0.28, 0.26], [0.24, 0.23, 0.22], [0.36, 0.33, 0.3]], // punched concrete
  [[0.22, 0.23, 0.26], [0.17, 0.18, 0.2]], // ribbon windows
  [[0.08, 0.08, 0.1], [0.1, 0.09, 0.09]], // dark monolith
];
const SPIRE_STYLE = 4;
const NEON_COLORS = [
  [1, 0.1, 0.55], [0.1, 0.9, 1], [1, 0.45, 0.05], [0.6, 0.2, 1], [0.2, 1, 0.4], [1, 0.08, 0.08],
];
const LOT_SPLITS = {
  one: [[0, 0, 1, 1]],
  halvesX: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  halvesZ: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  quads: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
};

const snap = (h) => Math.max(8, Math.round(h / 4) * 4);

export function buildCity(seed, U) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const noise = makeNoise(seed);
  const segments = [];
  const neons = [];
  const beacons = [];
  let towerCount = 0;
  let litWeightedWindows = 0;

  function addNeon(seg) {
    const vertical = rng.chance(0.6);
    const sw = vertical ? rng.range(2.5, 4) : rng.range(10, 20);
    const sh = vertical ? rng.range(10, 28) : rng.range(2.5, 4);
    const face = rng.int(0, 3);
    const faceWidth = face < 2 ? seg.d : seg.w;
    const top = Math.min(seg.h, 140);
    if (sw > faceWidth - 4 || top - sh < 10) return;
    const y = rng.range(6 + sh / 2, top - sh / 2 - 2);
    const lateral = rng.range(-(faceWidth - sw) / 2 + 1, (faceWidth - sw) / 2 - 1);
    let x = seg.x, z = seg.z, yaw = 0;
    if (face === 0) { x += seg.w / 2 + 0.6; z += lateral; yaw = Math.PI / 2; }
    else if (face === 1) { x -= seg.w / 2 + 0.6; z += lateral; yaw = -Math.PI / 2; }
    else if (face === 2) { z += seg.d / 2 + 0.6; x += lateral; yaw = 0; }
    else { z -= seg.d / 2 + 0.6; x += lateral; yaw = Math.PI; }
    const cols = vertical ? 1 : Math.max(2, Math.round(sw / sh));
    const rows = vertical ? Math.max(2, Math.round(sh / sw)) : 1;
    neons.push({ x, y, z, yaw, sw, sh, color: rng.pick(NEON_COLORS), seed: rng.next() * 100, cols, rows });
  }

  function addTower(cx, cz, w, d, height) {
    towerCount++;
    const style = rng.int(0, 3);
    const tint = rng.pick(TINTS[style]).map((c) => c * rng.range(0.85, 1.15));
    const tseed = rng.next() * 1000;
    const litScale = rng.range(0.6, 1.25);
    const [cellW, cellH] = CELLS[style];
    const tiers = height > 110 && rng.chance(0.7) ? (height > 350 ? 3 : 2) : 1;
    let y = 0;
    let remaining = height;
    for (let t = 0; t < tiers; t++) {
      const last = t === tiers - 1;
      const h = last ? remaining : snap(remaining * rng.range(0.4, 0.65));
      const seg = { x: cx, z: cz, w, d, y, h, style, tint, tseed, litScale };
      segments.push(seg);
      litWeightedWindows += ((2 * (w + d)) / cellW) * (h / cellH) * litScale;
      if (t === 0 && rng.chance(0.5)) {
        addNeon(seg);
        if (rng.chance(0.4)) addNeon(seg);
      }
      y += h;
      remaining -= h;
      w *= rng.range(0.62, 0.85);
      d *= rng.range(0.62, 0.85);
    }
    if (height > 260 && rng.chance(0.4)) {
      const s = rng.range(1.5, 3);
      const h = rng.range(25, 90);
      segments.push({ x: cx, z: cz, w: s, d: s, y, h, style: SPIRE_STYLE, tint: [0.35, 0.36, 0.4], tseed, litScale });
      y += h;
    }
    if (height > 90) beacons.push({ x: cx, y: y + 1.5, z: cz, phase: rng.next() });
  }

  for (let bi = 0; bi < GRID; bi++) {
    for (let bj = 0; bj < GRID; bj++) {
      if (rng.chance(0.03)) continue; // plaza
      const x0 = streetLines[bi] + STREET / 2;
      const z0 = streetLines[bj] + STREET / 2;
      const r = rng.next();
      const lots = r < 0.28 ? LOT_SPLITS.one
        : r < 0.55 ? (rng.chance(0.5) ? LOT_SPLITS.halvesX : LOT_SPLITS.halvesZ)
          : LOT_SPLITS.quads;
      for (const [lx, lz, lw, ld] of lots) {
        const gap = 2.5;
        const w = lw * BLOCK - gap * 2;
        const d = ld * BLOCK - gap * 2;
        const cx = x0 + lx * BLOCK + gap + w / 2;
        const cz = z0 + lz * BLOCK + gap + d / 2;
        const core = 1 - Math.min(1, Math.hypot(cx, cz) / HALF);
        const n = Math.min(1, Math.max(0, (noise.fbm(cx / 700, cz / 700) - 0.25) / 0.5));
        let h = (20 + 380 * Math.pow(n, 1.6) * (0.3 + 0.7 * core)) * rng.range(0.6, 1.4);
        if (rng.chance(0.012 + 0.05 * core * n)) h = rng.range(450, 900);
        addTower(cx, cz, w * rng.range(0.85, 1), d * rng.range(0.85, 1), snap(h));
      }
    }
  }

  const group = new THREE.Group();
  group.add(makeTowers(segments, U), makeNeons(neons, U), makeBeacons(beacons, U), makeGround(U));
  return { group, towerCount, litWeightedWindows };
}

function makeTowers(segments, U) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const n = segments.length;
  const info = new Float32Array(n * 4);
  const tint = new Float32Array(n * 3);
  segments.forEach((s, i) => {
    info.set([s.tseed, s.style, s.litScale, 0], i * 4);
    tint.set(s.tint, i * 3);
  });
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: TOWER_VERT,
    fragmentShader: TOWER_FRAG,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  segments.forEach((s, i) => {
    m.makeScale(s.w, s.h, s.d);
    m.setPosition(s.x, s.y, s.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

function makeNeons(neons, U) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const n = neons.length;
  const attr = new Float32Array(n * 4);
  const grid = new Float32Array(n * 2);
  neons.forEach((s, i) => {
    attr.set([...s.color, s.seed], i * 4);
    grid.set([s.cols, s.rows], i * 2);
  });
  geo.setAttribute('aNeon', new THREE.InstancedBufferAttribute(attr, 4));
  geo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grid, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: NEON_VERT,
    fragmentShader: NEON_FRAG,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  neons.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sw, s.sh, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

function makeBeacons(beacons, U) {
  const geo = new THREE.SphereGeometry(1.6, 8, 6);
  const phase = new Float32Array(beacons.map((b) => b.phase));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: BEACON_VERT, fragmentShader: BEACON_FRAG });
  const mesh = new THREE.InstancedMesh(geo, mat, beacons.length);
  const m = new THREE.Matrix4();
  beacons.forEach((b, i) => mesh.setMatrixAt(i, m.makeTranslation(b.x, b.y, b.z)));
  mesh.computeBoundingSphere();
  return mesh;
}

function makeGround(U) {
  const geo = new THREE.PlaneGeometry(12000, 12000);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uHalf: { value: HALF },
      uPitch: { value: PITCH },
      uStreet: { value: STREET },
    },
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
  });
  return new THREE.Mesh(geo, mat);
}
