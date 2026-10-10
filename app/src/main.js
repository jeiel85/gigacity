import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity } from './city.js';
import { buildTraffic, MAX_CARS } from './traffic.js';
import { SKIES, SkyController, makeUniforms } from './sky.js';
import { Hero } from './hero.js';
import { CameraRig, VIEWS } from './cameras.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ URL state

function parseHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const nums = (key, n) => {
    const v = (p.get(key) || '').split(',').map(Number);
    return v.length === n && v.every(Number.isFinite) ? v : null;
  };
  const seed = parseInt(p.get('seed'), 10);
  const traffic = parseInt(p.get('traffic'), 10);
  return {
    seed: Number.isFinite(seed) && seed >= 0 ? seed % 100000 : null,
    sky: SKIES[p.get('sky')] ? p.get('sky') : 'day',
    view: VIEWS.includes(p.get('view')) ? p.get('view') : 'chase',
    traffic: Number.isFinite(traffic) ? Math.min(100, Math.max(0, traffic)) : 70,
    at: nums('at', 3),
    look: nums('look', 2),
  };
}

const initial = parseHash();
const state = {
  seed: initial.seed ?? Math.floor(Math.random() * 100000),
  sky: initial.sky,
  view: initial.view,
  traffic: initial.traffic,
};

// ------------------------------------------------------------- renderer

const canvas = $('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  $('error').hidden = false;
  $('error').textContent = `WebGL2를 시작할 수 없습니다: ${err.message}`;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1, 12000);
const U = makeUniforms();
const sky = new SkyController(U, scene);
sky.set(state.sky, true);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), sky.bloom, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const hero = new Hero();
scene.add(hero.group);
let world = null;
const rig = new CameraRig(camera, renderer.domElement, hero, () => world.traffic);

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function buildWorld(seed, at = null, look = null) {
  if (world) {
    scene.remove(world.city.group, world.traffic.group);
    disposeGroup(world.city.group);
    world.traffic.dispose();
  }
  const city = buildCity(seed, U);
  const traffic = buildTraffic(seed, U);
  scene.add(city.group, traffic.group);
  world = { seed, city, traffic };
  traffic.setDensity(state.traffic / 100);
  hero.setMeshes(traffic.heroBody, traffic.heroCone);
  if (at) hero.placeAt(traffic, at[0], at[1], at[2], look ? look[0] : 90);
  else hero.takeCar(traffic, Math.floor(Math.random() * Math.max(1, traffic.count)), time);
  rig.setMode(state.view);
  syncUi();
}

// --------------------------------------------------------------- input

const keys = {};
const input = { left: false, right: false, up: false, down: false };
const isTyping = (e) => e.target instanceof HTMLInputElement;

addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  keys[e.code] = true;
  if (e.shiftKey && e.code === 'KeyT') hero.turbo = !hero.turbo;
  else if (e.shiftKey && e.code === 'KeyH') hero.hover = !hero.hover;
  else if (e.shiftKey && e.code === 'KeyV') setView(state.view === 'seat' ? 'chase' : 'seat');
  else return;
  syncUi();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readInput() {
  input.left = !!(keys.KeyA || keys.ArrowLeft);
  input.right = !!(keys.KeyD || keys.ArrowRight);
  input.up = !!(keys.KeyW || keys.ArrowUp);
  input.down = !!(keys.KeyS || keys.ArrowDown);
}

// Click (not drag) on a car to take it over.
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 500;
  down = null;
  if (moved > 6 || !quick) return;
  const i = pickCar(e.clientX, e.clientY);
  if (i < 0) return;
  hero.takeCar(world.traffic, i, time);
  setView(state.view === 'seat' ? 'seat' : 'chase');
});

function pickCar(cx, cy) {
  const tr = world.traffic;
  const v = new THREE.Vector3();
  let best = -1;
  let bestD = 30 * 30;
  for (let i = 0; i < tr.count; i++) {
    if (i === tr.hidden) continue;
    tr.carPos(i, time, v).project(camera);
    if (v.z < -1 || v.z > 1) continue;
    const dx = (v.x * 0.5 + 0.5) * innerWidth - cx;
    const dy = (-v.y * 0.5 + 0.5) * innerHeight - cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ------------------------------------------------------------------ UI

function setView(v) {
  state.view = v;
  rig.setMode(v);
  syncUi();
}

function setSky(s) {
  state.sky = s;
  sky.set(s);
  syncUi();
}

function newSeed(seed) {
  state.seed = seed;
  buildWorld(seed);
  writeHash();
}

for (const group of document.querySelectorAll('.seg')) {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (group.dataset.group === 'view') setView(b.dataset.v);
    else setSky(b.dataset.v);
  });
}
$('traffic').addEventListener('input', (e) => {
  state.traffic = Number(e.target.value);
  world.traffic.setDensity(state.traffic / 100);
  syncUi();
});
$('seed').addEventListener('change', (e) => {
  const s = parseInt(e.target.value, 10);
  if (Number.isFinite(s) && s >= 0) newSeed(s % 100000);
  else e.target.value = state.seed;
});
$('newCity').addEventListener('click', () => newSeed(Math.floor(Math.random() * 100000)));

function syncUi() {
  for (const b of document.querySelectorAll('.seg button')) {
    const group = b.parentElement.dataset.group;
    b.classList.toggle('on', b.dataset.v === (group === 'view' ? state.view : state.sky));
  }
  $('traffic').value = state.traffic;
  $('trafficVal').textContent = `${state.traffic} %`;
  if (document.activeElement !== $('seed')) $('seed').value = state.seed;
  $('seedLbl').textContent = state.seed;
  $('badgeTurbo').classList.toggle('on', hero.turbo);
  $('badgeHover').classList.toggle('on', hero.hover);
}

const fmt = (n) => n.toLocaleString('en-US');
function updateStats(fps) {
  const tr = world.traffic;
  $('sTowers').textContent = fmt(world.city.towerCount);
  $('sCars').textContent = fmt(tr.count + 1);
  $('sLit').textContent = `~${fmt(Math.round((world.city.litWeightedWindows * U.uLit.value) / 1000))}k`;
  $('fps').textContent = Math.round(fps);
  $('draws').textContent = renderer.info.render.calls;
  $('tris').textContent = `${(renderer.info.render.triangles / 1e6).toFixed(2)}M`;
}

function writeHash() {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
  const p = state.view === 'drone' ? camera.position : hero.pos;
  const at = [p.x, p.y, p.z].map((v) => v.toFixed(1)).join(',');
  const look = `${Math.round(yaw)},${Math.round(pitch)}`;
  const traffic = state.traffic === 70 ? '' : `&traffic=${state.traffic}`;
  history.replaceState(null, '', `#seed=${state.seed}&sky=${state.sky}&view=${state.view}&at=${at}&look=${look}${traffic}`);
}

addEventListener('hashchange', () => {
  const h = parseHash();
  state.sky = h.sky;
  sky.set(h.sky);
  state.traffic = h.traffic;
  state.view = h.view;
  if (h.seed !== null && h.seed !== state.seed) {
    state.seed = h.seed;
    buildWorld(h.seed, h.at, h.look);
  } else {
    world.traffic.setDensity(state.traffic / 100);
    if (h.at) hero.placeAt(world.traffic, h.at[0], h.at[1], h.at[2], h.look ? h.look[0] : 90);
    rig.setMode(state.view);
  }
  syncUi();
});

addEventListener('resize', () => {
  if (!innerWidth || !innerHeight) return; // collapsed window: nothing to size to
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- loop

let time = 0;
buildWorld(state.seed, initial.view !== 'drone' ? initial.at : null, initial.look);
if (initial.view === 'drone' && initial.at) {
  camera.position.fromArray(initial.at);
  const [yaw, pitch] = (initial.look || [90, -10]).map(THREE.MathUtils.degToRad);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  rig.controls.target.copy(camera.position).addScaledVector(dir, 60);
}
$('maxCars').textContent = fmt(MAX_CARS);

let last = performance.now();
let frames = 0;
let statClock = 0;
let hashClock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!innerWidth || !innerHeight) {
    last = now;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  U.uTime.value = time;

  readInput();
  hero.update(dt, input);
  rig.update(dt, time);
  sky.update(dt, camera);
  bloom.strength = sky.bloom;
  renderer.toneMappingExposure = sky.exposure;

  renderer.info.reset();
  composer.render();

  frames++;
  statClock += dt;
  if (statClock >= 0.5) {
    updateStats(frames / statClock);
    frames = 0;
    statClock = 0;
  }
  hashClock += dt;
  if (hashClock >= 1) {
    hashClock = 0;
    writeHash();
  }
}
requestAnimationFrame(frame);

// Console handle for inspecting the running city (e.g. gigacity.hero.pos).
window.gigacity = { hero, rig, camera, renderer, composer, sky, U, get world() { return world; }, get time() { return time; } };
