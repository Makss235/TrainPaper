// Освещение сцены: uniforms, которые читают все материалы одного движка (один объект на всех —
// обновили значение один раз, и поменялось везде), и расчёт света по солнцу и погоде.
//
// Рассеянный свет неба (его цвет — от цвета неба, ночью холодный) плюс прямое солнце по углу
// к грани. Сила прямого света плавно растёт от −1,5° до +3,5° высоты солнца — тени проявляются
// на рассвете и гаснут на закате постепенно.
// @ts-check
import * as THREE from "three";

export const MAX_PATTERNS = 2;
/** Сколько источников помещается в текстуру данных (активных — не больше quality.maxLights). */
export const LIGHT_CAPACITY = 256;
/** Текселей на источник в текстуре данных. */
const TEXELS = 4;
/** Карт теней от источников (кроме солнца) — шейдер читает две. */
export const MAX_SPOT_SHADOWS = 2;
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
    // источники света: текстура данных TEXELS × LIGHT_CAPACITY (см. setLights), активных — uLightCount
    uLightTex: { value: createLightTexture() },
    uLightCount: { value: 0 },
    // тени от прожекторов (spot): две карты глубины, матрицы мир → карта, параметры (вкл., сдвиг, тексель)
    uSpotShadow0: { value: /** @type {THREE.Texture | null} */ (null) },
    uSpotShadow1: { value: /** @type {THREE.Texture | null} */ (null) },
    uSpotShadowMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4()] },
    uSpotShadowParams: { value: [V4(), V4()] },
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
    uShadowParams: { value: V4() },                            // включено (1/0), сдвиг глубины, сдвиг по нормали (м), —
    uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 4096) },   // размер текселя карты (карта прямоугольная)
    uShadowFade: { value: new THREE.Vector2(80, 110) },
    uShadowStyle: { value: new THREE.Vector2(1, 1) },          // сила тени (0…1), мягкость края (множитель)
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
 * @param {{sun: {intensity: number, color: number[]}, ambient: {intensity: number, tint: number[]}, shadows: {softness: number, strength: number}}} [scene]
 *   поправки из данных сцены (environment.sun / ambient / shadows) — «тёплый вечер» без кода
 */
export function updateLight(L, style, env, sunDir, weather, scene) {
  const S = style.light, alt = env.alt;
  const day = clamp((alt + 4) / 14);
  const sunAbove = smoothstep(-1.5, 3.5, alt);
  const direct = sunAbove * (.86 + .14 * smoothstep(8, 30, alt)) * weather.sun;
  const warm = env.sunColor.map((/** @type {number} */ c) => c / 255);
  const sunTint = warm.map((/** @type {number} */ c) => c + (1 - c) * .35 * smoothstep(10, 35, alt));
  // рассеянный свет: цвет неба, разбавленный серым, чтобы светлые поверхности не уходили в синеву
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
  const ambK = scene?.ambient.intensity ?? 1, ambTint = scene?.ambient.tint ?? [1, 1, 1];
  const amb = tint.map((/** @type {number} */ t, /** @type {number} */ i) => t * ambI * ambK * ambTint[i]);
  const sunK = scene?.sun.intensity ?? 1, sunCol = scene?.sun.color ?? [1, 1, 1];
  const set3 = (/** @type {{value: THREE.Vector3}} */ u, /** @type {number[]} */ c, k = 1) => u.value.set(c[0] * k, c[1] * k, c[2] * k);

  L.uSunDir.value.copy(sunDir.y > .005 ? sunDir : new THREE.Vector3(sunDir.x, .005, sunDir.z).normalize());
  set3(L.uSun, sunTint.map((/** @type {number} */ c, /** @type {number} */ i) => c * sunCol[i]), S.sun * direct * sunK);
  L.uShadowStyle.value.set(scene?.shadows.strength ?? 1, scene?.shadows.softness ?? 1);
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

function createLightTexture() {
  const tex = new THREE.DataTexture(new Float32Array(TEXELS * LIGHT_CAPACITY * 4), TEXELS, LIGHT_CAPACITY, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @typedef {object} LightData  источник для шейдера (мировые координаты)
 * @property {"point" | "spot" | "directional"} kind
 * @property {number[]} position
 * @property {number[]} color      цвет × яркость
 * @property {number} range
 * @property {boolean} night       горит только ночью (× uLamps)
 * @property {number[]} [direction] куда светит (spot, directional), единичный
 * @property {number} [cosOuter]   spot: косинус половины угла конуса
 * @property {number} [cosInner]   spot: косинус начала полутени
 * @property {number} [shadow]     номер карты теней (0, 1) или −1
 */

/**
 * Записать источники в текстуру данных. Каждый — 4 текселя:
 *   0: позиция xyz, радиус (−1 у направленного: у него нет радиуса — шейдер не отсекает его по расстоянию);
 *   1: цвет × яркость, ночной (1/0);  2: направление xyz, cos внешнего угла;
 *   3: вид (0 — точечный, 1 — прожектор, 2 — направленный), cos внутреннего угла, номер карты теней (−1 — нет), —.
 * @param {LightUniforms} L
 * @param {LightData[]} lights  уже отобранные (не больше quality.maxLights)
 */
export function setLights(L, lights) {
  const tex = L.uLightTex.value, data = /** @type {Float32Array} */ (tex.image.data);
  const n = Math.min(lights.length, LIGHT_CAPACITY);
  for (let i = 0; i < n; i++) {
    const l = lights[i], o = i * TEXELS * 4, d = l.direction || [0, -1, 0];
    data[o] = l.position[0]; data[o + 1] = l.position[1]; data[o + 2] = l.position[2];
    data[o + 3] = l.kind === "directional" ? -1 : l.range;
    data[o + 4] = l.color[0]; data[o + 5] = l.color[1]; data[o + 6] = l.color[2]; data[o + 7] = l.night ? 1 : 0;
    data[o + 8] = d[0]; data[o + 9] = d[1]; data[o + 10] = d[2]; data[o + 11] = l.cosOuter ?? -1;
    data[o + 12] = l.kind === "spot" ? 1 : l.kind === "directional" ? 2 : 0;
    data[o + 13] = l.cosInner ?? -1; data[o + 14] = l.shadow ?? -1; data[o + 15] = 0;
  }
  L.uLightCount.value = n;
  if (n) tex.needsUpdate = true;                        // нет источников — шейдер текстуру не читает
}

/**
 * Тени-узоры (решётки): плоскость x = const с прутьями, стойками и поперечинами — в мировых координатах.
 * @param {LightUniforms} L
 * @param {{x: number, y0: number, y1: number, step: number, bar: number, postStep: number, post: number, crossbar: number, crossbars: number[], from: number, to: number}[]} patterns
 */
export function setPatternShadows(L, patterns) {
  for (let i = 0; i < MAX_PATTERNS; i++) {
    const p = patterns[i];
    const A = L.uPatA.value[i], B = L.uPatB.value[i], C = L.uPatC.value[i];
    if (!p) { A.set(0, 0, 0, 0); continue; }
    A.set(p.x, p.y0, p.y1, p.step);
    B.set(p.bar, p.postStep, p.post, p.crossbar);
    C.set(p.from, p.to, p.crossbars[0], p.crossbars[1]);
  }
}
