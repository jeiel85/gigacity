import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAR_SCALE } from './traffic.js';

export const VIEWS = ['chase', 'seat', 'drone', 'director'];
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const SHOTS = ['side', 'low', 'aerial', 'front', 'flyby'];
const BASE_FOV = 62;

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
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'drone';
    if (mode === 'drone') this.controls.target.copy(this.hero.pos);
    if (this.hero.body) this.hero.body.visible = mode !== 'seat';
    this.shot = null;
    this.snap = true;
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
      const back = (h.turbo ? 22 : 16) * (cam.aspect < 1 ? 1.7 : 1);
      this.offset.lerp(this._v.copy(fwd).multiplyScalar(-back).setY(4.5 - h.pitch * 10), k);
      this.lookOffset.lerp(this._w.copy(fwd).multiplyScalar(30).setY(2.5), k);
      cam.position.copy(h.group.position).add(this.offset);
      cam.up.set(0, 1, 0);
      cam.lookAt(this._v.copy(h.group.position).add(this.lookOffset));
      fov += Math.max(0, h.speed / h.baseSpeed - 1) * 7;
    } else if (this.mode === 'seat') {
      h.group.updateMatrixWorld();
      cam.position.set(0, 1.0 * CAR_SCALE, 0.5 * CAR_SCALE).applyMatrix4(h.group.matrixWorld);
      cam.quaternion.copy(h.group.quaternion).multiply(FLIP);
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
      this.shot = { i, type, end: t + 5 + Math.random() * 3, side: Math.random() < 0.5 ? 1 : -1 };
      if (type === 'flyby') {
        const p = tr.carPos(i, t + 2.6, new THREE.Vector3());
        const [dx, dz] = tr.carDir(i);
        this.shot.fixed = p.add(new THREE.Vector3(-dz, 0, dx).multiplyScalar(13 * this.shot.side)).setY(p.y + 3);
      }
    }
    const { i, type, side } = this.shot;
    const p = tr.carPos(i, t, this._v);
    const [dx, dz] = tr.carDir(i);
    const fwd = new THREE.Vector3(dx, 0, dz);
    const right = new THREE.Vector3(-dz, 0, dx).multiplyScalar(side);
    const pos = this._w.copy(p);
    if (type === 'side') pos.addScaledVector(right, 14).addScaledVector(fwd, -4).y += 3;
    else if (type === 'low') pos.addScaledVector(right, 6).addScaledVector(fwd, -6).y -= 22;
    else if (type === 'aerial') pos.addScaledVector(fwd, -30).y += 45;
    else if (type === 'front') pos.addScaledVector(fwd, 18).y += 1.5;
    else pos.copy(this.shot.fixed);
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(type === 'aerial' ? p.addScaledVector(fwd, 20) : p);
  }
}
