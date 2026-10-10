// GLSL shared by every material. All shaders output linear HDR; tone mapping
// and sRGB conversion happen once in the OutputPass.

export const COMMON = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uNight;
uniform float uTime;
uniform float uLightGain;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Exponential-squared fog that thins with altitude.
float fogFactor(vec3 wp) {
  float d = length(wp - cameraPosition);
  float f = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  return f * mix(1.0, 0.55, clamp(wp.y / 900.0, 0.0, 1.0));
}

vec3 skyColor(vec3 dir) {
  return mix(uSkyHorizon, uSkyTop, pow(clamp(dir.y, 0.0, 1.0), 0.6));
}
`;

// ---------------------------------------------------------------- towers

export const TOWER_VERT = /* glsl */ `
${COMMON}
attribute vec4 aInfo; // seed, facade style, lit multiplier, unused
attribute vec3 aTint;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;
varying vec3 vTint;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal; // boxes are only translated and scaled on axes
  vInfo = aInfo;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Window cell sizes and margins must match CELLS in city.js.
export const TOWER_FRAG = /* glsl */ `
${COMMON}
uniform float uLit;
uniform float uWindowGain;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;
varying vec3 vTint;

vec2 cellFor(float s) {
  return s < 0.5 ? vec2(3.2, 4.0) : s < 1.5 ? vec2(4.5, 4.0) : s < 2.5 ? vec2(6.0, 4.0) : vec2(3.6, 4.4);
}
vec2 marginFor(float s) {
  return s < 0.5 ? vec2(0.07, 0.12) : s < 1.5 ? vec2(0.22, 0.24) : s < 2.5 ? vec2(0.0, 0.3) : vec2(0.18, 0.18);
}
vec3 roomColor(float h) {
  if (h < 0.55) return mix(vec3(1.0, 0.58, 0.28), vec3(1.0, 0.8, 0.52), h / 0.55);
  if (h < 0.74) return vec3(0.6, 0.78, 1.0);
  if (h < 0.86) return vec3(0.88, 0.93, 1.0);
  if (h < 0.94) return vec3(0.25, 1.0, 0.85);
  return vec3(1.0, 0.3, 0.72);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float seed = vInfo.x;
  float style = vInfo.y;
  vec3 base = vTint;
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 light = uAmbient * (0.65 + 0.35 * n.y) + uSunColor * diff;
  vec3 col;

  if (n.y > 0.5 || style > 3.5) {
    vec2 r = fract(vWorld.xz / 6.0);
    float grid = step(0.9, max(r.x, r.y));
    col = base * 0.8 * light * (1.0 - 0.3 * grid);
  } else if (n.y < -0.5) {
    col = base * 0.2;
  } else {
    bool xFace = abs(n.x) > 0.5;
    vec2 uv = xFace ? vec2(vWorld.z * sign(n.x), vWorld.y) : vec2(-vWorld.x * sign(n.z), vWorld.y);
    float face = xFace ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
    vec2 cell = cellFor(style);
    vec2 margin = marginFor(style);
    vec2 g = uv / cell;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 fw = fwidth(g);
    vec2 m = smoothstep(margin - fw, margin + fw, f) * (1.0 - smoothstep(1.0 - margin - fw, 1.0 - margin + fw, f));
    float win = (margin.x < 0.01 ? 1.0 : m.x) * m.y;

    // Light is decided per room (a run of windows on one floor), not per pane.
    float roomW = (style > 1.5 && style < 2.5) ? 2.0 : 3.0;
    vec2 room = vec2(floor(id.x / roomW), id.y);
    float hr = hash13(vec3(room, seed * 7.13 + face));
    float hc = hash13(vec3(room.yx + 11.0, seed + face * 3.7));
    float lit = step(hr, uLit * vInfo.z);
    vec3 lc = roomColor(hc) * (0.55 + 0.9 * hash13(vec3(id, seed)));

    vec3 R = reflect(-V, n);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    vec3 glass = mix(base * 0.25, skyColor(R), 0.18 + 0.7 * fres) * (0.75 + 0.5 * hash13(vec3(id, seed + 9.0)));
    glass *= mix(1.0, 0.3, uNight);
    vec3 wall = base * light;
    vec3 nearCol = mix(wall, glass + lc * lit * uWindowGain, win);

    // Far away the grid collapses to its average colour instead of shimmering.
    float cover = (1.0 - 2.0 * margin.x) * (1.0 - 2.0 * margin.y);
    vec3 avgLit = vec3(1.0, 0.76, 0.52) * uLit * vInfo.z * uWindowGain * 0.85;
    vec3 avgGlass = mix(base * 0.25, skyColor(R), 0.3) * mix(1.0, 0.3, uNight);
    vec3 farCol = mix(wall, avgGlass + avgLit, cover);
    col = mix(nearCol, farCol, smoothstep(0.35, 0.9, max(fw.x, fw.y)));
  }

  col *= 0.45 + 0.55 * smoothstep(0.0, 80.0, vWorld.y);
  col = mix(col, uFogColor, fogFactor(vWorld));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ----------------------------------------------------------------- neon

export const NEON_VERT = /* glsl */ `
${COMMON}
attribute vec4 aNeon; // rgb, seed
attribute vec2 aGrid; // glyph columns, rows
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vNeon;
varying vec2 vGrid;
void main() {
  vUv = uv;
  vNeon = aNeon;
  vGrid = aGrid;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const NEON_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vNeon;
varying vec2 vGrid;
void main() {
  vec2 g = vUv * vGrid;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 sub = floor(f * vec2(4.0, 6.0));
  float inside = step(0.18, f.x) * step(f.x, 0.82) * step(0.12, f.y) * step(f.y, 0.88);
  float on = step(0.48, hash13(vec3(id * 5.0 + sub, vNeon.w))) * inside;
  vec2 e = min(vUv, 1.0 - vUv) * vGrid;
  float edge = 1.0 - step(0.06, min(e.x, e.y));
  float flicker = hash13(vec3(vNeon.w, 1.0, 2.0)) > 0.85
    ? step(0.25, hash13(vec3(floor(uTime * 12.0), vNeon.w, 3.0)))
    : 1.0;
  vec3 col = vNeon.rgb * (on * 0.9 + edge) * uLightGain * 2.2 * flicker + vNeon.rgb * 0.04;
  col = mix(col, uFogColor, fogFactor(vWorld) * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

// -------------------------------------------------------------- beacons

export const BEACON_VERT = /* glsl */ `
${COMMON}
attribute float aPhase;
varying float vPhase;
varying vec3 vWorld;
void main() {
  vPhase = aPhase;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BEACON_FRAG = /* glsl */ `
${COMMON}
varying float vPhase;
varying vec3 vWorld;
void main() {
  float on = step(fract(uTime * 0.6 + vPhase), 0.18);
  vec3 col = vec3(1.0, 0.08, 0.05) * (0.3 + on * 5.0 * uLightGain);
  col = mix(col, uFogColor, fogFactor(vWorld) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

// --------------------------------------------------------------- ground

export const GROUND_VERT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GROUND_FRAG = /* glsl */ `
${COMMON}
uniform float uHalf;
uniform float uPitch;
uniform float uStreet;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  vec2 m = mod(p + uHalf, uPitch);
  vec2 dc = min(m, uPitch - m); // distance to the nearest street centreline per axis
  float inCity = step(max(abs(p.x), abs(p.y)), uHalf + uStreet * 0.5);
  float street = mix(1.0, step(min(dc.x, dc.y), uStreet * 0.5), inCity);
  vec3 col = mix(vec3(0.12, 0.12, 0.125), vec3(0.03, 0.032, 0.037), street);
  col *= uAmbient * 1.3 + uSunColor * max(uSunDir.y, 0.0) * 0.8;

  // Street lamps along both kerbs, with a wide pool of light around each.
  float kerb = uStreet * 0.5 - 1.5;
  vec2 q = mod(p, 18.0) - 9.0;
  float lampX = exp(-(pow(dc.y - kerb, 2.0) + q.x * q.x) / 4.0) + 0.12 * exp(-(pow(dc.y - kerb, 2.0) + q.x * q.x) / 60.0);
  float lampZ = exp(-(pow(dc.x - kerb, 2.0) + q.y * q.y) / 4.0) + 0.12 * exp(-(pow(dc.x - kerb, 2.0) + q.y * q.y) / 60.0);
  col += vec3(1.0, 0.55, 0.22) * (lampX + lampZ) * uNight * 2.5 * inCity;

  col = mix(col, uFogColor, fogFactor(vWorld));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ----------------------------------------------------------------- cars

// Traffic cars are placed entirely on the GPU from their lane parameters;
// traffic.js#carPos mirrors this so the CPU can pick and follow them.
const CAR_ATTRS = /* glsl */ `
#ifndef HERO
attribute vec3 aOrigin;
attribute vec2 aDir;
attribute vec4 aMotion; // lane length, speed, phase, bob phase
attribute vec3 aColor;
attribute float aIndex;
uniform float uHidden;
#else
uniform vec3 uHeroColor;
#endif
`;

const CAR_PLACE = /* glsl */ `
#ifdef HERO
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * normal);
#else
  float s = mod(aMotion.z + aMotion.y * uTime, aMotion.x);
  vec3 c = aOrigin + vec3(aDir.x, 0.0, aDir.y) * s;
  c.y += sin(uTime * 1.3 + aMotion.w) * 0.35;
  vec4 wp = vec4(c + vec3(position.x * aDir.y + position.z * aDir.x, position.y, -position.x * aDir.x + position.z * aDir.y), 1.0);
  vec3 wn = vec3(normal.x * aDir.y + normal.z * aDir.x, normal.y, -normal.x * aDir.x + normal.z * aDir.y);
  if (abs(aIndex - uHidden) < 0.5) wp.xyz = vec3(0.0, -1.0e4, 0.0);
#endif
`;

export const CAR_VERT = /* glsl */ `
${COMMON}
${CAR_ATTRS}
attribute float aPart;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vPart;
void main() {
  ${CAR_PLACE}
  vPart = aPart;
  vWorld = wp.xyz;
  vNormal = wn;
#ifdef HERO
  vColor = uHeroColor;
#else
  vColor = aColor;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CAR_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vPart;
void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col;
  float emissive = 1.0;
  if (vPart < 0.5) {
    float diff = max(dot(n, uSunDir), 0.0);
    vec3 R = reflect(-V, n);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    col = vColor * (uAmbient + uSunColor * diff) + skyColor(R) * fres * 0.7;
    emissive = 0.0;
  } else if (vPart > 3.5) {
    vec3 R = reflect(-V, n);
    float fres = 0.15 + 0.85 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = vec3(0.02, 0.025, 0.03) * (uAmbient + uSunColor * max(dot(n, uSunDir), 0.0)) + skyColor(R) * fres * 0.9;
    emissive = 0.0;
  } else if (vPart < 1.5) {
    col = vec3(1.0, 0.95, 0.85) * uLightGain * 2.5;
  } else if (vPart < 2.5) {
    col = vec3(1.0, 0.05, 0.03) * uLightGain * 3.0;
  } else {
    col = vec3(0.12, 0.42, 1.0) * uLightGain * 3.0;
  }
  col = mix(col, uFogColor, fogFactor(vWorld) * mix(1.0, 0.75, emissive));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const CONE_VERT = /* glsl */ `
${COMMON}
${CAR_ATTRS}
attribute float aAlong;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
void main() {
  ${CAR_PLACE}
  vAlong = aAlong;
  vWorld = wp.xyz;
  vNormal = wn;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CONE_FRAG = /* glsl */ `
${COMMON}
uniform float uConeGain;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float edge = pow(abs(dot(n, V)), 2.0);
  float a = pow(1.0 - clamp(vAlong, 0.0, 1.0), 2.0) * edge;
  float f = fogFactor(vWorld);
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * uConeGain * (1.0 - f), 1.0);
}
`;

// ------------------------------------------------------------------ sky

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

export const SKY_FRAG = /* glsl */ `
${COMMON}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = d.y > 0.0
    ? mix(uSkyHorizon, uSkyTop, pow(d.y, 0.55))
    : mix(uSkyHorizon, uFogColor, clamp(-d.y * 6.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 9.0 + pow(sd, 12.0) * 0.25 * (1.0 - uNight * 0.7));
  col = mix(col, uFogColor, exp(-max(d.y, 0.0) * 14.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
varying float vBright;
void main() {
  vBright = aBright;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

export const STAR_FRAG = /* glsl */ `
uniform float uNight;
varying float vBright;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vBright * a * uNight * uNight, 1.0);
}
`;

export const CLOUD_VERT = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + (right * position.x + up * position.y * 0.55) * size;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const CLOUD_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uTex;
uniform float uClouds;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float a = texture2D(uTex, vUv).a;
  float d = length(vWorld - cameraPosition);
  a *= smoothstep(60.0, 400.0, d) * uClouds;
  vec3 lit = uAmbient * 1.4 + uSunColor * 0.5 * (0.6 + 0.4 * vUv.y);
  vec3 col = mix(uFogColor, lit, 0.55);
  col = mix(col, uFogColor, fogFactor(vWorld) * 0.8);
  gl_FragColor = vec4(col, a);
}
`;
