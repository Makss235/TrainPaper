// Окружение: время суток, солнце и луна по координатам, цвета неба, свет, тени, облака и погода.
//
//   engine.environment.setLocation(59.93, 30.36);   // широта, долгота — солнце над этой точкой
//   engine.time.set(new Date());                     // момент — по часам симуляции (engine.time)
//   engine.environment.skyScale = 1440;              // «сутки за минуту» только на небе: солнце и луна идут быстро,
//                                                    // а часы сцены (движение объектов, таймеры) — как обычно
//   engine.environment.skyShift = 6 * 3600000;       // небо на 6 часов впереди часов сцены (предпросмотр времени суток)
//   engine.time.scale = 1440;                        // а так ускоряется всё: и небо, и объекты, и таймеры
//   engine.environment.setAzimuth(250);               // куда по компасу смотрит ось −z сцены
//   engine.environment.setSun({ azimuth: 200, altitude: 30 });   // или солнце напрямую, без времени
//   engine.weather.set("rain", { intensity: .4 });    // погода (плавно), сила 0…1,5: морось, дождь, ливень
//
// В данных сцены:
//   "environment": {
//     "azimuth": 250, "location": [59.93, 30.36], "weather": "partly", "weatherIntensity": 1,
//     "clouds": false,                                       // небо без облаков движка (облака сцены — свои спрайты)
//     "planes": true,                                        // изредка пролетает самолёт со шлейфом ({ "every": [150, 420] } — пауза, с)
//     "shadows": { "x": [-18, 18], "y": [-1, 14], "z": [14, -110], "softness": 1, "strength": 1 },
//     "fog": { "near": 90, "far": 1600 },
//     "sun": { "intensity": 1, "color": "#ffffff" },        // множители к расчёту по времени
//     "ambient": { "intensity": 1, "tint": "#ffffff" },
//     "sky": [[-18, "#050814", "#0b1226"], [3, "#3b61a5", "#f0ac76"], [50, "#2f6cbc", "#9cc3e6"]]   // своя таблица неба
//   }
// Свет и тени пересчитываются, когда солнце сдвинулось заметно (на 0,1°). Пока небо движется, сдвиг проверяется
// с частотой по его скорости: ×1 — раз в секунду, ×1440 — quality.sunFps раз в секунду.
// У неба свои сдвиг и скорость относительно часов сцены (skyShift, skyScale): время суток можно листать,
// не трогая часы, по которым живут объекты.
// Облака и осадки плывут по реальному времени, не трогая сцену.
// @ts-check
import * as THREE from "three";
import { updateLight } from "../render/lighting.js";
import { AirTraffic } from "./air-traffic.js";
import { celestial as computeCelestial } from "./celestial.js";
import { DEFAULT_SKY, environment as skyEnvironment, parseSkyTable } from "./sky-model.js";
import { BASE, mixWeather, WEATHER, WEATHER_LABELS, WeatherState } from "./weather.js";

const RAD = Math.PI / 180;

/**
 * Направление на светило в мире: ось −z сцены смотрит по компасу на azimuth0.
 * @param {number} azimuth @param {number} altitude @param {number} azimuth0
 */
export function skyDirection(azimuth, altitude, azimuth0) {
  const rel = (azimuth - azimuth0) * RAD, alt = altitude * RAD;
  return new THREE.Vector3(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
}

/** Свет сцены по умолчанию (поправки из данных сцены: sun, ambient, shadows). */
const SCENE_LIGHT = () => ({
  sun: { intensity: 1, color: /** @type {number[]} */ ([1, 1, 1]) },
  ambient: { intensity: 1, tint: /** @type {number[]} */ ([1, 1, 1]) },
  shadows: { softness: 1, strength: 1 },
});

export class Environment {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.location = { lat: 55.75, lon: 37.62 };
    this.azimuth = 0;
    /** @type {{azimuth: number, altitude: number, rising?: boolean} | null} */
    this.sunOverride = null;
    this.key = "";
    /** @type {any} */
    this.env = null;
    /** @type {import("./celestial.js").Celestial | null} */
    this.celestial = null;
    /** @type {any} */
    this.light = null;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    /** Таблица неба этого движка (environment/sky-model.js) */
    this.skyTable = DEFAULT_SKY;
    /** Поправки света из данных сцены */
    this.sceneLight = SCENE_LIGHT();
    /** @type {(() => void) | null} */
    this.cancelCheck = null;
    /** Когда окружение последний раз просило перерисовать небо (реальные мс) */
    this.skyAsked = -1e9;
    /** Умолчания движка, к которым возвращается каждая новая сцена (дымка, область теней) */
    this.defaults = { fog: { ...engine.style.fog }, shadows: structuredClone(engine.shadow.region) };
    /** Сдвиг неба от часов сцены на момент shiftAt (мс) и скорость неба относительно часов */
    /** Самолёты в небе (environment.planes в данных сцены) */
    this.planes = new AirTraffic(engine);
    this.shiftBase = 0;
    this.shiftAt = performance.now();
    this.scale = 1;
    engine.time.on("timeChanged", () => { this.update(); this.#follow(); });
  }

  /** Момент на небе (мс): часы сцены плюс сдвиг неба. */
  get time() { return this.engine.time.ms + this.skyShift; }

  /**
   * На сколько небо впереди часов сцены, мс. Солнце, луна, свет и тени считаются по engine.time + skyShift,
   * а объекты, таймеры и расписания живут по engine.time — предпросмотр времени суток их не трогает.
   */
  get skyShift() { return this.shiftBase + (this.scale - 1) * (performance.now() - this.shiftAt); }
  set skyShift(ms) {
    this.shiftBase = ms;
    this.shiftAt = performance.now();
    this.update();
  }

  /**
   * Во сколько раз небо идёт быстрее часов сцены (1 — вместе с ними). 1440 — «сутки за минуту» только на небе:
   * сдвиг неба растёт сам, по реальному времени. Чтобы ускорить и объекты — engine.time.scale.
   */
  get skyScale() { return this.scale; }
  set skyScale(k) {
    k = Math.max(0, k);
    if (k === this.scale) return;
    this.shiftBase = this.skyShift;                    // накопленное остаётся: небо продолжает с того же места
    this.shiftAt = performance.now();
    this.scale = k;
    this.#follow();
  }

  /** Настройки из данных сцены (environment). @param {Record<string, any>} [s] */
  configure(s = {}) {
    const E = this.engine;
    // настройки сцены не наследуются от предыдущей: чего в данных нет — берётся из умолчаний движка
    // (место на Земле задаёт приложение — setLocation; оно остаётся, если сцена своё не указала)
    this.azimuth = s.azimuth ?? 0;
    /** Рисовать ли облака на небе (у сцены могут быть свои — спрайтами) */
    this.clouds = s.clouds !== false;
    this.planes.configure(s.planes ?? null);
    if (s.location) this.location = { lat: s.location[0], lon: s.location[1] };
    Object.assign(E.style.fog, this.defaults.fog, s.fog);
    E.shadow.setRegion({ ...this.defaults.shadows, ...s.shadows });
    // таблица неба и поправки света — свои у каждой сцены (новая сцена начинает со встроенных)
    try {
      this.skyTable = s.sky ? parseSkyTable(s.sky) : DEFAULT_SKY;
    } catch (error) {
      console.warn(`environment.sky: ${error.message}`);
      this.skyTable = DEFAULT_SKY;
    }
    const L = SCENE_LIGHT(), pal = E.palette;
    if (s.sun) { L.sun.intensity = s.sun.intensity ?? 1; if (s.sun.color) L.sun.color = pal.rgb(s.sun.color); }
    if (s.ambient) { L.ambient.intensity = s.ambient.intensity ?? 1; if (s.ambient.tint) L.ambient.tint = pal.rgb(s.ambient.tint); }
    if (s.shadows) { L.shadows.softness = s.shadows.softness ?? 1; L.shadows.strength = s.shadows.strength ?? 1; }
    this.sceneLight = L;
    if (s.weather && !E.weather.userSet) E.weather.set(s.weather, { instant: true, intensity: s.weatherIntensity ?? 1 });
    this.update(true);
    this.#follow();
  }

  /** @param {number} lat @param {number} lon */
  setLocation(lat, lon) { this.location = { lat, lon }; this.update(); }
  /** Момент на небе: то же, что engine.time.set(t). @param {Date | number} time */
  setTime(time) { this.engine.time.set(time); }
  /** @param {number} deg */
  setAzimuth(deg) { this.azimuth = deg; this.update(true); }
  /** Солнце напрямую: { azimuth, altitude } (°) или null — снова по времени и координатам. @param {{azimuth: number, altitude: number, rising?: boolean} | null} sun */
  setSun(sun) { this.sunOverride = sun; this.update(true); this.#follow(); }
  /** Своя таблица неба: [[высота°, "#зенит", "#горизонт"], ...] (null — встроенная). @param {[number, string, string][] | null} rows */
  setSkyTable(rows) { this.skyTable = rows ? parseSkyTable(rows) : DEFAULT_SKY; this.update(true); }

  /** Пока небо движется — следить за солнцем: проверка с частотой по скорости неба (×1 — 1/с, ×1440 — quality.sunFps раз в секунду). */
  #follow() {
    this.cancelCheck?.();
    this.cancelCheck = null;
    const E = this.engine, T = E.time;
    // скорость неба относительно реального времени: часы сцены (если идут) плюс собственный ход неба
    const speed = (T.running ? T.scale : 0) + (this.scale - 1);
    if (speed <= 0 || this.sunOverride) return;
    const realMs = Math.max(1000 / Math.max(1, E.quality.sunFps), Math.min(1000, 24000 / speed));
    if (this.scale === 1) {
      // небо идёт вместе с часами сцены — один таймер этих часов
      const tick = () => { this.update(); this.cancelCheck = T.after(realMs * T.scale / 1000, tick, { label: "солнце" }); };
      this.cancelCheck = T.after(realMs * T.scale / 1000, tick, { label: "солнце" });
    } else {
      // у неба свой ход — по реальному времени, в цикле кадров (в скрытой вкладке не идёт вовсе)
      E.loop.animate("sun", () => { this.update(); }, 1000 / realMs);
      this.cancelCheck = () => E.loop.stop("sun");
    }
  }

  /** Пересчитать свет, небо и тени (если солнце заметно сдвинулось или force). */
  update(force = false) {
    const E = this.engine;
    /** @type {any} */
    let sky = computeCelestial(new Date(this.time), this.location.lat, this.location.lon);
    if (this.sunOverride) sky = { ...sky, sun: { ...this.sunOverride }, rising: this.sunOverride.rising ?? true };
    const base = skyEnvironment(sky.sun.altitude, sky.rising, this.skyTable);
    const key = `${sky.sun.altitude.toFixed(1)}|${sky.sun.azimuth.toFixed(1)}|${base.lamps.toFixed(2)}|${sky.moon ? sky.moon.altitude.toFixed(0) : ""}|${this.azimuth}`;
    if (!force && key === this.key) return;
    this.key = key;
    const weather = E.weather.state;
    const env = weather.applyTo(base);
    this.env = env;
    this.celestial = sky;
    const w = weather.current;
    const sunDir = skyDirection(sky.sun.azimuth, sky.sun.altitude, this.azimuth);
    this.sunDir = sunDir;
    this.light = updateLight(E.light, E.style, env, sunDir, w, this.sceneLight);
    E.lights.syncLamps();
    E.sky.set(env, sky, sunDir, this.clouds === false ? { ...w, cover: 0, cirrus: 0, cloudOpacity: 0 } : w);
    const C = E.composite.uniforms;
    C.uSunDir.value.copy(sunDir);
    C.uStars.value = env.stars * (1 - w.overcast);
    // солнечный диск: светлый, почти белый; у горизонта — тёплый. За плотными облаками и под горизонтом не виден
    const low = Math.min(1, Math.max(0, env.glow));
    E.composite.setSun(Math.min(1, Math.max(0, (sky.sun.altitude + 1.2) / 2.4)) * (1 - w.overcast * .9),
      [1, .985 - .13 * low, .93 - .36 * low]);
    C.uSkyTop.value.set(env.top[0] / 255, env.top[1] / 255, env.top[2] / 255);
    if (sky.moon) {
      C.uMoonDir.value.copy(skyDirection(sky.moon.azimuth, sky.moon.altitude, this.azimuth));
      const up = Math.min(1, Math.max(0, (sky.moon.altitude + 1) / 3));
      const dark = Math.min(1, Math.max(0, (6 - sky.sun.altitude) / 10));
      C.uMoon.value = up * (.35 + .65 * dark) * (1 - w.overcast * .9);
    } else {
      C.uMoon.value = 0;
    }
    E.shadow.update(E.three, E.light.uSunDir.value, this.light.direct);
    E.precipitation.setWeather(w, .35 + .65 * this.light.day);
    E.events.emit("environment", { env, celestial: sky, light: this.light });
    // напрямую у цикла: сдвинулось солнце, а не геометрия — карта крыш для осадков остаётся прежней
    E.loop.invalidate("sky", "scene", "shadow");
    this.skyAsked = performance.now();
    this.syncAnimations();
  }

  /** Облака плывут, пока они есть; осадки идут, пока идут. Иначе — ни одного лишнего кадра. По реальному времени. */
  syncAnimations() {
    const E = this.engine, loop = E.loop, Q = E.quality, w = E.weather.state.current;
    const clouds = this.clouds !== false && Q.skyFps > 0 && (w.cover > .02 || w.cirrus > .02) && w.cloudOpacity > .01 && E.options.animate !== false;
    if (clouds && !loop.has("clouds")) {
      loop.animate("clouds", (now, dt) => {
        E.sky.advance(dt, now / 1000, E.weather.state.current.wind);
        // при ускоренном времени небо и так перерисовывается с каждым шагом солнца (чаще, чем плывут облака) —
        // свой кадр облакам не нужен: они сдвинутся в ближайшем кадре солнца
        if (performance.now() - this.skyAsked > 1000 / Q.skyFps) E.invalidate("sky");
      }, Q.skyFps);
    } else if (!clouds) loop.stop("clouds");
    // звёзды слегка мерцают: ночью пересобирается только кадр (один недорогой проход), сцена не перерисовывается
    const stars = E.composite.uniforms.uStars.value > .03 && Q.starsFps > 0 && E.options.animate !== false;
    if (stars && !loop.has("stars")) loop.animate("stars", () => { E.invalidate("composite"); }, Q.starsFps);
    else if (!stars) loop.stop("stars");
    const precip = E.precipitation.active && E.options.animate !== false;
    if (precip && !loop.has("precip")) {
      loop.animate("precip", (now, dt) => { E.precipitation.advance(dt); E.invalidate("fx"); }, Q.precipFps);
    } else if (!precip) loop.stop("precip");
  }
}

/**
 * Погода: пресеты (свои у каждого движка) и плавная смена по реальному времени.
 *   engine.weather.set("rain")                       — дождь, плавно за 4 с
 *   engine.weather.set("rain", { intensity: .35 })   — морось; 1,5 — ливень
 *   engine.weather.define("sleet", { rain: .4, snow: .4, cover: 1, overcast: 1 }, "Мокрый снег")
 */
export class WeatherController {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** Пресеты этого движка: копия встроенных (environment/weather.js) @type {Record<string, Record<string, any>>} */
    this.table = structuredClone(WEATHER);
    /** Подписи пресетов @type {[string, string][]} */
    this.labels = WEATHER_LABELS.map(([k, l]) => /** @type {[string, string]} */ ([k, l]));
    this.state = new WeatherState(mixWeather(this.table, "partly"));
    this.userSet = false;
    /** @type {AbortController | null} */
    this.transition = null;
  }

  get key() { return this.state.key; }
  get intensity() { return this.state.intensity; }
  get current() { return this.state.current; }
  /** Пресеты: [[ключ, подпись], ...] */
  get presets() { return this.labels.filter(([k]) => this.table[k]); }
  /** Поля погоды и их значения по умолчанию (для своих пресетов). */
  get base() { return BASE; }

  /**
   * Свой пресет погоды (что не указано — из BASE).
   * @param {string} key @param {Record<string, any>} params @param {string} [label]
   */
  define(key, params, label) {
    this.table[key] = params;
    if (label && !this.labels.some(([k]) => k === key)) this.labels.push([key, label]);
    if (this.state.key === key) this.set(key, { instant: true, intensity: this.state.intensity });
  }

  /**
   * Сменить погоду: плавно за ms (по умолчанию 4 с, по реальному времени) или сразу (instant).
   * @param {string} key
   * @param {{instant?: boolean, ms?: number, intensity?: number}} [opts]
   */
  set(key, { instant = false, ms = 4000, intensity = 1 } = {}) {
    if (!this.table[key]) { console.warn(`Нет погоды «${key}». Есть: ${Object.keys(this.table).join(", ")}`); return; }
    this.userSet = true;
    const E = this.engine;
    const quick = instant || E.options.animate === false || ms <= 0;
    this.transition?.abort();
    this.transition = null;
    this.state.set(key, mixWeather(this.table, key, intensity), { instant: quick, intensity });
    if (quick) { E.environment.update(true); return; }
    const ac = (this.transition = new AbortController());
    E.tween({ duration: ms / 1000, ease: "smoothstep", signal: ac.signal, onUpdate: (/** @type {number} */ e) => { this.state.blend(e); E.environment.update(true); } })
      .then(() => { if (this.transition === ac) this.transition = null; }, () => {});
  }

  /** Сменить только силу текущей погоды. @param {number} intensity @param {{instant?: boolean, ms?: number}} [opts] */
  setIntensity(intensity, opts = {}) {
    this.set(this.state.key, { ...opts, intensity });
  }
}
