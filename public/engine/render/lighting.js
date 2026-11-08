// Освещение сцены: uniforms, которые читают все материалы одного движка (один объект на всех —
// обновили значение один раз, и поменялось везде), и расчёт света по солнцу и погоде.
//
// Рассеянный свет неба (его цвет — от цвета неба, ночью холодный) плюс прямое солнце по углу
// к грани. Сила прямого света плавно растёт от −1,5° до +3,5° высоты солнца — тени проявляются
// на рассвете и гаснут на закате постепенно.
// @ts-check
import * as THREE from "three";

export const MAX_LAMPS = 8, MAX_PATTERNS = 2;
const clamp = (/** @type {number} */ v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smoothstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const V3 = () => new THREE.Vector3();
const V4 = () => new THREE.Vector4();

/** Uniforms освещения одного движка. @param {any} style */
export function createLightUniforms(style) {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSun: { value: V3() },
    uAmbSky: { value: new THREE.Vector3(1, 1, 1) },
    uAmbGround: { value: new THREE.Vector3(.8, .8, .8) },
    uFogColor: { value: new THREE.Vector3(.8, .85, .9) },
    uFog: { value: new THREE.Vector3(style.fog.near, style.fog.far, style.fog.max) },
    uCeiling: { value: style.light.ceiling },
    uLamps: { value: 0 },
    uLampPos: { value: Array.from({ length: MAX_LAMPS }, V4) },
    uLampCol: { value: Array.from({ length: MAX_LAMPS }, V3) },
    uSkyTop: { value: new THREE.Vector3(.23, .47, .77) },
    uSkyHorizon: { value: new THREE.Vector3(.65, .79, .89) },
    uWet: { value: 0 },
    uSnow: { value: 0 },
    // карта высот сверху (из осадков): под крышей снег не лежит и пол не мокнет. w = 0 — карты нет
    uCoverMap: { value: /** @type {THREE.Texture | null} */ (null) },
    uCoverBox: { value: V4() },
    uCoverRange: { value: new THREE.Vector2(40, -40) },
    uShadowMap: { value: /** @type {THREE.Texture | null} */ (null) },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowParams: { value: V4() },
    uShadowFade: { value: new THREE.Vector2(80, 110) },
    uPatA: { value: Array.from({ length: MAX_PATTERNS }, V4) },
    uPatB: { value: Array.from({ length: MAX_PATTERNS }, V4) },
    uPatC: { value: Array.from({ length: MAX_PATTERNS }, V4) },
  };
}
/** @typedef {ReturnType<typeof createLightUniforms>} LightUniforms */

/**
 * Свет по окружению (уже с поправкой на погоду) и погоде. Возвращает сводку для других систем.
 * @param {LightUniforms} L
 * @param {any} style
 * @param {any} env       окружение: alt, top, horizon, sunColor, lamps (environment/sky-model.js)
 * @param {THREE.Vector3} sunDir  направление на солнце в мире
 * @param {any} weather   параметры погоды (environment/weather.js)
 */
export function updateLight(L, style, env, sunDir, weather) {
  const S = style.light, alt = env.alt;
  const day = clamp((alt + 4) / 14);
  const sunAbove = smoothstep(-1.5, 3.5, alt);
  const direct = sunAbove * (.86 + .14 * smoothstep(8, 30, alt)) * weather.sun;
  const warm = env.sunColor.map((/** @type {number} */ c) => c / 255);
  const sunTint = warm.map((/** @type {number} */ c) => c + (1 - c) * .35 * smoothstep(10, 35, alt));
  // рассеянный свет: цвет неба, разбавленный серым, чтобы платформа не уходила в синеву
  const skyCol = env.top.map((/** @type {number} */ c, /** @type {number} */ i) => c + (env.horizon[i] - c) * .55);
  const gray = (skyCol[0] + skyCol[1] + skyCol[2]) / 3;
  const skyLight = skyCol.map((/** @type {number} */ c) => c * .5 + gray * .5 + 30);
  const peak = Math.max(...skyLight);
  const night = clamp((-alt - 4) / 8), twilight = clamp((alt + 7) / 13);
  const tint = skyLight.map((/** @type {number} */ c, /** @type {number} */ i) => (c / peak) * (1 - night) + S.nightTint[i] * night);
  let ambI = S.ambient.base + S.ambient.twilight * twilight + S.ambient.day * day + S.ambient.night * night;
  // в облачную погоду часть солнечного света становится ровным светом неба
  ambI += S.sun * sunAbove * (1 - weather.sun) * .42;
  ambI *= 1 - .22 * weather.dark;
  const amb = tint.map((/** @type {number} */ t) => t * ambI);
  const set3 = (/** @type {{value: THREE.Vector3}} */ u, /** @type {number[]} */ c, k = 1) => u.value.set(c[0] * k, c[1] * k, c[2] * k);

  L.uSunDir.value.copy(sunDir.y > .005 ? sunDir : new THREE.Vector3(sunDir.x, .005, sunDir.z).normalize());
  set3(L.uSun, sunTint, S.sun * direct);
  set3(L.uAmbSky, amb);
  set3(L.uAmbGround, amb, S.groundBounce);
  set3(L.uFogColor, env.horizon.map((/** @type {number} */ c) => c / 255 * (.92 + .08 * day)));
  L.uFog.value.set(style.fog.near * weather.fogNear, style.fog.far * weather.fogFar, Math.min(1, style.fog.max + weather.fogMax));
  const lamps = clamp(env.lamps + weather.lamps * (1 - night));
  L.uLamps.value = lamps;
  set3(L.uSkyTop, env.top.map((/** @type {number} */ c) => c / 255));
  set3(L.uSkyHorizon, env.horizon.map((/** @type {number} */ c) => c / 255));
  L.uWet.value = weather.wet;
  L.uSnow.value = weather.snowCover;
  return { direct, lamps, day, night, ambI };
}

/**
 * Точечные источники: берём MAX_LAMPS ближайших к точке near (обычно камере).
 * @param {LightUniforms} L
 * @param {{position: number[], color: number[], range: number, intensity: number, night?: boolean}[]} lamps
 * @param {number[]} near
 */
export function setLamps(L, lamps, near) {
  const sorted = lamps
    .map(l => ({ l, d: Math.hypot(l.position[0] - near[0], l.position[1] - near[1], l.position[2] - near[2]) - l.range * .5 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_LAMPS);
  for (let i = 0; i < MAX_LAMPS; i++) {
    const item = sorted[i]?.l;
    const pos = L.uLampPos.value[i], col = L.uLampCol.value[i];
    if (!item) { pos.set(0, 0, 0, 0); col.set(0, 0, 0); continue; }
    pos.set(item.position[0], item.position[1], item.position[2], item.night === false ? -item.range : item.range);
    col.set(item.color[0] * item.intensity, item.color[1] * item.intensity, item.color[2] * item.intensity);
  }
}

/**
 * Тени-узоры (ограды): плоскость x = const с прутьями, стойками и перилами — в мировых координатах.
 * @param {LightUniforms} L
 * @param {{x: number, y0: number, y1: number, step: number, bar: number, postStep: number, post: number, rail: number, rails: number[], from: number, to: number}[]} patterns
 */
export function setPatternShadows(L, patterns) {
  for (let i = 0; i < MAX_PATTERNS; i++) {
    const p = patterns[i];
    const A = L.uPatA.value[i], B = L.uPatB.value[i], C = L.uPatC.value[i];
    if (!p) { A.set(0, 0, 0, 0); continue; }
    A.set(p.x, p.y0, p.y1, p.step);
    B.set(p.bar, p.postStep, p.post, p.rail);
    C.set(p.from, p.to, p.rails[0], p.rails[1]);
  }
}
