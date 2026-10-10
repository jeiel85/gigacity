import * as THREE from 'three';
import { GRID, HALF, PITCH, STREET, streetLines, nearestStreetIndex } from './city.js';

// Headings: 0 +x, 1 +z, 2 -x, 3 -z.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TURN_CHANCE = 0.18;
const MIN_ALT = 12;
const MAX_ALT = 950;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function headingOf(dx, dz) {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 0 : 2;
  return dz >= 0 ? 1 : 3;
}

// The car the camera rides with. It flies the street canyons on autopilot,
// turning at intersections, while the player leans, climbs, boosts or hovers.
export class Hero {
  constructor() {
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.yaw = Math.PI / 2;
    this.speed = 40;
    this.baseSpeed = 40;
    this.turbo = false;
    this.hover = false;
    this.bank = 0;
    this.pitch = 0;
    this.carIndex = -1;
    this.body = null;
    this.cone = null;
    this.teleported = true;
  }

  setMeshes(body, cone) {
    if (this.body) this.group.remove(this.body, this.cone);
    this.body = body;
    this.cone = cone;
    this.group.add(body, cone);
  }

  takeCar(traffic, i, t) {
    traffic.carPos(i, t, this.pos);
    const [dx, dz] = traffic.carDir(i);
    this.heading = headingOf(dx, dz);
    this.yaw = Math.atan2(dx, dz);
    this.baseSpeed = this.speed = traffic.carSpeed(i);
    this.carIndex = i;
    traffic.setHidden(i);
    traffic.setHeroColor(traffic.carColor(i));
    this.teleported = true;
  }

  placeAt(traffic, x, y, z, yawDeg) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    this.heading = headingOf(Math.sin(yaw), Math.cos(yaw));
    const [dx] = DIRS[this.heading];
    if (dx !== 0) {
      this.pos.set(clamp(x, -HALF, HALF), y, streetLines[nearestStreetIndex(z)]);
    } else {
      this.pos.set(streetLines[nearestStreetIndex(x)], y, clamp(z, -HALF, HALF));
    }
    this.pos.y = clamp(y, MIN_ALT, MAX_ALT);
    this.yaw = Math.atan2(...DIRS[this.heading]);
    this.baseSpeed = this.speed = 45;
    this.carIndex = -1;
    traffic.setHidden(-1);
    this.teleported = true;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  update(dt, input) {
    const [dx, dz] = DIRS[this.heading];
    const alongX = dx !== 0;
    const alongKey = alongX ? 'x' : 'z';
    const perpKey = alongX ? 'z' : 'x';

    const target = this.hover ? 0 : this.baseSpeed * (this.turbo ? 3.2 : 1);
    this.speed += (target - this.speed) * Math.min(1, dt * (this.turbo ? 1.5 : 2.5));
    const prevAlong = this.pos[alongKey];
    this.pos.x += dx * this.speed * dt;
    this.pos.z += dz * this.speed * dt;
    const along = this.pos[alongKey];

    // Lean: slide across the street canyon, never into the towers.
    const lean = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const rightPerp = alongX ? dx : -dz;
    const line = streetLines[nearestStreetIndex(this.pos[perpKey])];
    let off = this.pos[perpKey] - line;
    if (lean) off += rightPerp * lean * 30 * dt;
    else off += (rightPerp * 5.5 - off) * Math.min(1, dt * 0.5);
    const lim = STREET / 2 - 3.5;
    this.pos[perpKey] = line + clamp(off, -lim, lim);

    const climb = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    this.pos.y = clamp(this.pos.y + climb * 38 * dt * (this.turbo ? 1.5 : 1), MIN_ALT, MAX_ALT);

    const ease = Math.min(1, dt * 4);
    this.pitch += (-climb * 0.22 - this.pitch) * ease;
    this.bank += (lean * 0.5 - this.bank) * ease;

    // Intersections: maybe turn, and always turn before leaving the grid.
    const kPrev = Math.floor((prevAlong + HALF) / PITCH);
    const kNow = Math.floor((along + HALF) / PITCH);
    if (kPrev !== kNow) {
      const k = Math.max(kPrev, kNow);
      const sgn = alongX ? dx : dz;
      const nextK = k + sgn;
      const forced = nextK < 0 || nextK > GRID;
      if (k >= 0 && k <= GRID && (forced || Math.random() < TURN_CHANCE)) this.turnAt(k, alongKey, perpKey);
    }
    if (Math.abs(this.pos[alongKey]) > HALF + 20 && Math.sign(this.pos[alongKey]) === (alongX ? dx : dz)) {
      this.heading = (this.heading + 2) % 4;
    }

    const [ndx, ndz] = DIRS[this.heading];
    let dyaw = Math.atan2(ndx, ndz) - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * Math.min(1, dt * 3);

    const bob = this.hover ? Math.sin(performance.now() / 600) * 0.4 : 0;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.group.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
  }

  turnAt(k, alongKey, perpKey) {
    const perpIdx = nearestStreetIndex(this.pos[perpKey]);
    const options = [(this.heading + 1) % 4, (this.heading + 3) % 4].filter((h) => {
      const [hx, hz] = DIRS[h];
      const next = perpIdx + (hx + hz);
      return next >= 0 && next <= GRID;
    });
    if (options.length === 0) return;
    this.pos[alongKey] = streetLines[k];
    this.heading = options[Math.floor(Math.random() * options.length)];
  }
}
