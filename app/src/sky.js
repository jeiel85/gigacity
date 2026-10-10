import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { HALF } from './city.js';
import { SKY_VERT, SKY_FRAG, STAR_VERT, STAR_FRAG, CLOUD_VERT, CLOUD_FRAG } from './shaders.js';

// Colours are linear. `lit` is the fraction of rooms with lights on.
export const SKIES = {
  day: {
    top: [0.12, 0.3, 0.72], horizon: [0.62, 0.72, 0.86], fog: [0.55, 0.63, 0.75], fogDensity: 0.0004,
    sunDir: [0.45, 0.75, 0.35], sun: [1.6, 1.5, 1.35], ambient: [0.3, 0.35, 0.45],
    night: 0, lit: 0.16, windowGain: 0.4, lightGain: 1.0, coneGain: 0, clouds: 0.35, bloom: 0.22, exposure: 1.0,
  },
  dusk: {
    top: [0.08, 0.09, 0.25], horizon: [1.0, 0.42, 0.2], fog: [0.48, 0.28, 0.3], fogDensity: 0.00065,
    sunDir: [-0.85, 0.1, 0.35], sun: [1.8, 0.75, 0.4], ambient: [0.22, 0.17, 0.26],
    night: 0.55, lit: 0.45, windowGain: 0.9, lightGain: 1.6, coneGain: 0.05, clouds: 0.28, bloom: 0.55, exposure: 1.05,
  },
  night: {
    top: [0.004, 0.006, 0.02], horizon: [0.035, 0.045, 0.09], fog: [0.025, 0.032, 0.065], fogDensity: 0.0007,
    sunDir: [0.3, 0.55, -0.6], sun: [0.1, 0.12, 0.2], ambient: [0.035, 0.04, 0.07],
    night: 1, lit: 0.6, windowGain: 1.3, lightGain: 2.2, coneGain: 0.12, clouds: 0.1, bloom: 0.6, exposure: 1.15,
  },
};

const VEC_KEYS = { top: 'uSkyTop', horizon: 'uSkyHorizon', fog: 'uFogColor', sunDir: 'uSunDir', sun: 'uSunColor', ambient: 'uAmbient' };
const NUM_KEYS = {
  fogDensity: 'uFogDensity', night: 'uNight', lit: 'uLit', windowGain: 'uWindowGain',
  lightGain: 'uLightGain', coneGain: 'uConeGain', clouds: 'uClouds',
};

// One uniform object per name, shared by reference across every material.
export function makeUniforms() {
  const U = { uTime: { value: 0 } };
  for (const u of Object.values(VEC_KEYS)) U[u] = { value: new THREE.Vector3() };
  for (const u of Object.values(NUM_KEYS)) U[u] = { value: 0 };
  return U;
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = mulberry32(7);
  for (let k = 0; k < 26; k++) {
    const x = 64 + (r() - 0.5) * 60;
    const y = 64 + (r() - 0.5) * 30;
    const rad = 18 + r() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export class SkyController {
  constructor(U, scene) {
    this.U = U;
    this.target = null;
    this.bloom = 0;
    this.exposure = 1;

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(7000, 32, 16),
      new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }),
    );
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;

    const r = mulberry32(99);
    const nStars = 2500;
    const pos = new Float32Array(nStars * 3);
    const size = new Float32Array(nStars);
    const bright = new Float32Array(nStars);
    for (let i = 0; i < nStars; i++) {
      const theta = r() * Math.PI * 2;
      const y = 0.05 + r() * 0.95;
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(theta) * rr * 6000, y * 6000, Math.sin(theta) * rr * 6000], i * 3);
      size[i] = 1 + r() * 2;
      bright[i] = 0.3 + r() * r() * 2.5;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    this.stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
      uniforms: U, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;

    const nClouds = 220;
    this.clouds = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { ...U, uTex: { value: cloudTexture() } },
        vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
        transparent: true, depthWrite: false,
      }),
      nClouds,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < nClouds; i++) {
      const s = 200 + r() * 220;
      m.makeScale(s, s, s);
      m.setPosition((r() - 0.5) * HALF * 2.6, 110 + r() * 310, (r() - 0.5) * HALF * 2.6);
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 3;

    scene.add(this.dome, this.stars, this.clouds);
  }

  set(name, instant = false) {
    this.target = SKIES[name];
    if (instant) this.blend(1);
  }

  blend(k) {
    const t = this.target;
    const U = this.U;
    for (const [key, u] of Object.entries(VEC_KEYS)) {
      const v = new THREE.Vector3(...t[key]);
      if (key === 'sunDir') v.normalize();
      U[u].value.lerp(v, k);
    }
    for (const [key, u] of Object.entries(NUM_KEYS)) U[u].value += (t[key] - U[u].value) * k;
    this.bloom += (t.bloom - this.bloom) * k;
    this.exposure += (t.exposure - this.exposure) * k;
  }

  update(dt, camera) {
    this.blend(1 - Math.exp(-dt * 2.5));
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
  }
}
