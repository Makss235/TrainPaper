// Освещение сцены: общие uniforms, которые читают все материалы (один объект на всех — обновили
// значение один раз, и поменялось везде), и расчёт света по высоте солнца и погоде.
//
// Формулы перенесены из прежнего 2D-вида: рассеянный свет неба (его цвет — от цвета неба,
// ночью холодный) плюс прямое солнце по углу к грани. Сила прямого света плавно растёт
// от −1,5° до +3,5° высоты солнца, поэтому тени проявляются на рассвете и гаснут на закате.
import * as THREE from "three";
import { clamp } from "../../lib/color.js";
import { STYLE } from "../style.js";

const V3 = () => new THREE.Vector3();
const V4 = () => new THREE.Vector4();
export const MAX_LAMPS = 8, MAX_PATTERNS = 2;

export const LIGHT = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: V3() },
  uAmbSky: { value: new THREE.Vector3(1, 1, 1) },
  uAmbGround: { value: new THREE.Vector3(.8, .8, .8) },
  uFogColor: { value: new THREE.Vector3(.8, .85, .9) },
  uFog: { value: new THREE.Vector3(STYLE.fog.near, STYLE.fog.far, STYLE.fog.max) },
  uCeiling: { value: STYLE.light.ceiling },
  uLamps: { value: 0 },
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, V4) },
  uLampCol: { value: Array.from({ length: MAX_LAMPS }, V3) },
  uSkyTop: { value: new THREE.Vector3(.23, .47, .77) },
  uSkyHorizon: { value: new THREE.Vector3(.65, .79, .89) },
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowParams: { value: V4() },
  uShadowFade: { value: new THREE.Vector2(80, 110) },
  uPatA: { value: Array.from({ length: MAX_PATTERNS }, V4) },
  uPatB: { value: Array.from({ length: MAX_PATTERNS }, V4) },
  uPatC: { value: Array.from({ length: MAX_PATTERNS }, V4) },
};

const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const set3 = (u, c, k = 1) => u.value.set(c[0] * k, c[1] * k, c[2] * k);

/**
 * Свет по окружению (lib/sky.js environment(), уже с поправкой на погоду) и погоде.
 * sunDir — направление на солнце в мире (THREE.Vector3). Возвращает сводку для остальных частей.
 */
export function updateLight(env, sunDir, weather) {
  const L = STYLE.light, alt = env.alt;
  const day = clamp((alt + 4) / 14);
  const sunAbove = smoothstep(-1.5, 3.5, alt);
  const direct = sunAbove * (.86 + .14 * smoothstep(8, 30, alt)) * weather.sun;
  const warm = env.sunColor.map(c => c / 255);
  const sunTint = warm.map(c => c + (1 - c) * .35 * smoothstep(10, 35, alt));
  // рассеянный свет: цвет неба, разбавленный серым, чтобы платформа не уходила в синеву
  const skyCol = env.top.map((c, i) => c + (env.horizon[i] - c) * .55);
  const gray = (skyCol[0] + skyCol[1] + skyCol[2]) / 3;
  const skyLight = skyCol.map(c => c * .5 + gray * .5 + 30);
  const peak = Math.max(...skyLight);
  const night = clamp((-alt - 4) / 8), twilight = clamp((alt + 7) / 13);
  const tint = skyLight.map((c, i) => (c / peak) * (1 - night) + L.nightTint[i] * night);
  let ambI = L.ambient.base + L.ambient.twilight * twilight + L.ambient.day * day + L.ambient.night * night;
  // в облачную погоду солнце рассеивается облаками: часть его света становится ровным светом неба
  ambI += L.sun * sunAbove * (1 - weather.sun) * .42;
  ambI *= 1 - .22 * weather.dark;
  const amb = tint.map(t => t * ambI);

  LIGHT.uSunDir.value.copy(sunDir.y > .005 ? sunDir : new THREE.Vector3(sunDir.x, .005, sunDir.z).normalize());
  set3(LIGHT.uSun, sunTint, L.sun * direct);
  set3(LIGHT.uAmbSky, amb);
  set3(LIGHT.uAmbGround, amb, L.groundBounce);
  set3(LIGHT.uFogColor, env.horizon.map(c => c / 255 * (.92 + .08 * day)));
  LIGHT.uFog.value.set(STYLE.fog.near * weather.fogNear, STYLE.fog.far * weather.fogFar, Math.min(1, STYLE.fog.max + weather.fogMax));
  const lamps = clamp(env.lamps + weather.lamps * (1 - night));
  LIGHT.uLamps.value = lamps;
  set3(LIGHT.uSkyTop, env.top.map(c => c / 255));
  set3(LIGHT.uSkyHorizon, env.horizon.map(c => c / 255));
  LIGHT.uWet.value = weather.wet;
  LIGHT.uSnow.value = weather.snowCover;
  return { direct, lamps, day, night, ambI };
}

/**
 * Фонари: из всех источников сцены берём MAX_LAMPS ближайших к точке интереса (камере).
 * lamps — [{position: [x,y,z], color: [r,g,b], range, intensity}]
 */
export function setLamps(lamps, near = [0, 2, 0]) {
  const sorted = lamps
    .map(l => ({ l, d: Math.hypot(l.position[0] - near[0], l.position[1] - near[1], l.position[2] - near[2]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_LAMPS);
  for (let i = 0; i < MAX_LAMPS; i++) {
    const item = sorted[i]?.l;
    const pos = LIGHT.uLampPos.value[i], col = LIGHT.uLampCol.value[i];
    if (!item) { pos.set(0, 0, 0, 0); col.set(0, 0, 0); continue; }
    pos.set(item.position[0], item.position[1], item.position[2], item.range ?? 9);
    const c = item.color || STYLE.light.lampColor, k = item.intensity ?? 1;
    col.set(c[0] * k, c[1] * k, c[2] * k);
  }
}

/**
 * Тени-узоры (ограды): плоскость x = const с прутьями, стойками и двумя перилами.
 * patterns — [{x, y0, y1, step, bar, postStep, post, rail, rails: [y1, y2], from, to}]
 */
export function setPatternShadows(patterns) {
  for (let i = 0; i < MAX_PATTERNS; i++) {
    const p = patterns[i];
    const A = LIGHT.uPatA.value[i], B = LIGHT.uPatB.value[i], C = LIGHT.uPatC.value[i];
    if (!p) { A.set(0, 0, 0, 0); continue; }
    A.set(p.x, p.y0, p.y1, p.step);
    B.set(p.bar, p.postStep, p.post, p.rail);
    C.set(p.from, p.to, p.rails[0], p.rails[1]);
  }
}
