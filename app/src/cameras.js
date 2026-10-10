import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAR_SCALE } from './traffic.js';
import { streetLines, nearestStreetIndex } from './city.js';

export const VIEWS = ['chase', 'seat', 'drone', 'director'];
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const SHOTS = ['side', 'low', 'aerial', 'front', 'flyby'];
const BASE_FOV = 62;
const CHASE_ELEVATION = Math.atan2(4.5, 16);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Puts `pos` on the far side of the street canyon from the car at `p`, `dist` units
// from the centreline, so director cameras never end up inside a tower.
function acrossStreet(pos, p, dx, dist) {
  const key = dx !== 0 ? 'z' : 'x';
  const line = streetLines[nearestStreetIndex(p[key])];
  pos[key] = line - Math.sign(p[key] - line || 1) * dist;
  return pos;
}

export class CameraRig {
  constructor(camera, dom, hero, getTraffic) {
    this.camera = camera;
    this.hero = hero;
    this.getTraffic = getTraffic;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.maxDistance = 4000;
    this.mode = 'chase';
    this.offset = new THREE.Vector3(0, 8, -22);
    this.lookOffset = new THREE.Vector3();
    this.snap = true;
    this.shot = null;
    // Player look offsets around the car (chase) or the driver's head (seat).
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'drone';
    if (mode === 'drone') this.controls.target.copy(this.hero.pos);
    if (this.hero.body) this.hero.body.visible = mode !== 'seat';
    this.shot = null;
    this.snap = true;
    this.resetView();
  }

  get steerable() {
    return this.mode === 'chase' || this.mode === 'seat';
  }

  look(dxPixels, dyPixels) {
    if (!this.steerable) return;
    this.orbitYaw -= dxPixels * 0.005;
    this.orbitPitch += dyPixels * 0.004;
    this.clampLook();
  }

  orbit(direction, dt) {
    if (!this.steerable) return;
    this.orbitYaw += direction * 1.8 * dt;
    this.clampLook();
  }

  zoomBy(deltaY) {
    if (this.mode !== 'chase') return;
    this.zoom = clamp(this.zoom * Math.exp(deltaY * 0.001), 0.45, 5);
  }

  resetView() {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
  }

  clampLook() {
    if (this.mode === 'seat') {
      this.orbitYaw = clamp(this.orbitYaw, -2.4, 2.4);
      this.orbitPitch = clamp(this.orbitPitch, -1.1, 1.1);
    } else {
      this.orbitYaw = Math.atan2(Math.sin(this.orbitYaw), Math.cos(this.orbitYaw));
      this.orbitPitch = clamp(this.orbitPitch, -CHASE_ELEVATION - 0.3, 1.3 - CHASE_ELEVATION);
    }
  }

  update(dt, t) {
    const cam = this.camera;
    const h = this.hero;
    if (h.teleported) {
      this.snap = true;
      h.teleported = false;
    }
    let fov = BASE_FOV;
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 5);

    if (this.mode === 'chase') {
      // Offsets are smoothed in the car's frame, so the camera never lags with speed.
      const fwd = h.forward;
      const dist = (h.turbo ? 22 : 16) * (cam.aspect < 1 ? 1.7 : 1) * this.zoom;
      const yaw = h.yaw + Math.PI + this.orbitYaw;
      const elev = CHASE_ELEVATION + this.orbitPitch;
      this.offset.lerp(this._v.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(dist), k);
      // Look down the road when behind the car; at the car itself when orbiting around it.
      const ahead = clamp(1 - Math.abs(this.orbitYaw) / 0.6, 0, 1);
      this.lookOffset.lerp(this._w.copy(fwd).multiplyScalar(30 * ahead).setY(2.5 * ahead), k);
      cam.position.copy(h.group.position).add(this.offset);
      cam.up.set(0, 1, 0);
      cam.lookAt(this._v.copy(h.group.position).add(this.lookOffset));
      fov += Math.max(0, h.speed / h.baseSpeed - 1) * 7;
    } else if (this.mode === 'seat') {
      h.group.updateMatrixWorld();
      cam.position.set(0, 1.0 * CAR_SCALE, 0.5 * CAR_SCALE).applyMatrix4(h.group.matrixWorld);
      cam.quaternion.copy(h.group.quaternion).multiply(FLIP)
        .multiply(this._q.setFromEuler(this._e.set(-this.orbitPitch, this.orbitYaw, 0, 'YXZ')));
      fov = 72 + Math.max(0, h.speed / h.baseSpeed - 1) * 8;
    } else if (this.mode === 'drone') {
      this.controls.update();
    } else {
      this.updateDirector(t);
    }

    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (this.snap ? 1 : Math.min(1, dt * 3));
      cam.updateProjectionMatrix();
    }
    this.snap = false;
  }

  // Cuts between random cars every few seconds with a handful of shot types.
  updateDirector(t) {
    const cam = this.camera;
    const tr = this.getTraffic();
    if (tr.count === 0) {
      cam.position.copy(this.hero.group.position).add(new THREE.Vector3(0, 30, -40));
      cam.lookAt(this.hero.group.position);
      return;
    }
    if (!this.shot || t > this.shot.end || this.shot.i >= tr.count || this.shot.i === tr.hidden) {
      const i = Math.floor(Math.random() * tr.count);
      const type = SHOTS[Math.floor(Math.random() * SHOTS.length)];
      this.shot = { i, type, end: t + 5 + Math.random() * 3 };
      if (type === 'flyby') {
        const p = tr.carPos(i, t + 2.6, new THREE.Vector3());
        const [dx, dz] = tr.carDir(i);
        this.shot.fixed = acrossStreet(p.clone(), p, dx, 8).setY(p.y + 3);
      }
    }
    const { i, type } = this.shot;
    const p = tr.carPos(i, t, this._v);
    const [dx, dz] = tr.carDir(i);
    const fwd = new THREE.Vector3(dx, 0, dz);
    const pos = this._w.copy(p);
    if (type === 'side') acrossStreet(pos, p, dx, 7).addScaledVector(fwd, -4).y += 3;
    else if (type === 'low') acrossStreet(pos, p, dx, 3).addScaledVector(fwd, -6).y -= 22;
    else if (type === 'aerial') pos.addScaledVector(fwd, -30).y += 45;
    else if (type === 'front') pos.addScaledVector(fwd, 18).y += 1.5;
    else pos.copy(this.shot.fixed);
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(type === 'aerial' ? p.addScaledVector(fwd, 20) : p);
  }
}
