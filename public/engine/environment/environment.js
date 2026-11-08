// Окружение: время суток, солнце и луна по координатам, цвета неба, свет, тени, облака и погода.
//
//   engine.environment.setLocation(59.93, 30.36);   // широта, долгота — солнце над этой точкой
//   engine.environment.setTime(new Date());          // момент (можно «прокручивать» для предпросмотра)
//   engine.environment.setAzimuth(250);               // куда по компасу смотрит ось −z сцены
//   engine.environment.setSun({ azimuth: 200, altitude: 30 });   // или солнце напрямую, без времени
//   engine.weather.set("rain");                       // погода (плавно)
//
// В данных сцены: "environment": { "azimuth": 250, "location": [59.93, 30.36], "weather": "partly",
//   "shadows": { "x": [-18, 18], "y": [-1, 14], "z": [14, -110] }, "fog": { "near": 90, "far": 1600 } }
// Свет и тени пересчитываются, когда солнце сдвинулось заметно (на 0,1°), — в реальном времени это
// раз в ~20 с; облака плывут отдельно, не трогая сцену.
// @ts-check
import * as THREE from "three";
import { updateLight } from "../render/lighting.js";
import { celestial as computeCelestial } from "./celestial.js";
import { environment as skyEnvironment } from "./sky-model.js";
import { defineWeather, WEATHER, WEATHER_LABELS, WeatherState } from "./weather.js";

const RAD = Math.PI / 180;

/** Направление на светило в мире: ось −z сцены смотрит по компасу на azimuth0. */
export function skyDirection(azimuth, altitude, azimuth0) {
  const rel = (azimuth - azimuth0) * RAD, alt = altitude * RAD;
  return new THREE.Vector3(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
}

export class Environment {
  constructor(engine) {
    this.engine = engine;
    this.location = { lat: 55.75, lon: 37.62 };
    this.azimuth = 0;
    this.time = Date.now();
    this.sunOverride = null;
    this.key = "";
    this.env = null;
    this.celestial = null;
    this.light = null;
  }

  /** Настройки из данных сцены (environment). */
  configure(s = {}) {
    if (s.azimuth !== undefined) this.azimuth = s.azimuth;
    if (s.location) this.location = { lat: s.location[0], lon: s.location[1] };
    const st = this.engine.style;
    if (s.fog) Object.assign(st.fog, s.fog);
    if (s.shadows) this.engine.shadow.setRegion(s.shadows);
    if (s.weather && !this.engine.weather.userSet) this.engine.weather.set(s.weather, { instant: true });
    this.update(true);
  }

  setLocation(lat, lon) { this.location = { lat, lon }; this.update(); }
  setTime(time) { this.time = +time; this.update(); }
  setAzimuth(deg) { this.azimuth = deg; this.update(true); }
  /** Солнце напрямую: { azimuth, altitude } (°) или null — снова по времени и координатам. */
  setSun(sun) { this.sunOverride = sun; this.update(true); }

  /** Пересчитать свет, небо и тени (если солнце заметно сдвинулось или force). */
  update(force = false) {
    const E = this.engine;
    let sky = computeCelestial(new Date(this.time), this.location.lat, this.location.lon);
    if (this.sunOverride) sky = { ...sky, sun: { ...this.sunOverride }, rising: this.sunOverride.rising ?? true };
    const base = skyEnvironment(sky.sun.altitude, sky.rising);
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
    this.light = updateLight(E.light, E.style, env, sunDir, w);
    E.sky.set(env, sky, sunDir, w);
    const C = E.composite.uniforms;
    C.uSunDir.value.copy(sunDir);
    C.uStars.value = env.stars * (1 - w.overcast);
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
    E.invalidate("sky", "scene", "shadow");
    this.syncAnimations();
  }

  /** Облака плывут, пока они есть; осадки идут, пока идут. Иначе — ни одного лишнего кадра. */
  syncAnimations() {
    const E = this.engine, loop = E.loop, Q = E.quality, w = E.weather.state.current;
    const clouds = Q.skyFps > 0 && (w.cover > .02 || w.cirrus > .02) && w.cloudOpacity > .01 && E.options.animate !== false;
    if (clouds && !loop.has("clouds")) {
      loop.animate("clouds", (now, dt) => { E.sky.advance(dt, now / 1000, E.weather.state.current.wind); E.invalidate("sky"); }, Q.skyFps);
    } else if (!clouds) loop.stop("clouds");
    const precip = E.precipitation.active && E.options.animate !== false;
    if (precip && !loop.has("precip")) {
      loop.animate("precip", (now, dt) => { E.precipitation.advance(dt); E.invalidate("fx"); }, Q.precipFps);
    } else if (!precip) loop.stop("precip");
  }
}

/** Погода: пресеты и плавная смена. */
export class WeatherController {
  constructor(engine) {
    this.engine = engine;
    this.state = new WeatherState("partly");
    this.userSet = false;
  }

  get key() { return this.state.key; }
  get current() { return this.state.current; }
  /** Пресеты: [[ключ, подпись], ...] */
  get presets() { return WEATHER_LABELS.filter(([k]) => WEATHER[k]); }

  /** Свой пресет погоды. @param {string} key @param {Record<string, any>} params @param {string} [label] */
  define(key, params, label) {
    defineWeather(key, params);
    if (label && !WEATHER_LABELS.some(([k]) => k === key)) WEATHER_LABELS.push([key, label]);
  }

  /**
   * Сменить погоду: плавно за ms (по умолчанию 4 с) или сразу (instant).
   * @param {string} key
   * @param {{instant?: boolean, ms?: number}} [opts]
   */
  set(key, { instant = false, ms = 4000 } = {}) {
    if (!WEATHER[key]) { console.warn(`Нет погоды «${key}». Есть: ${Object.keys(WEATHER).join(", ")}`); return; }
    this.userSet = true;
    const E = this.engine;
    const quick = instant || E.options.animate === false;
    this.state.set(key, { instant: quick, ms });
    if (quick) { E.environment.update(true); return; }
    E.loop.animate("weather", () => {
      const moving = this.state.step();
      E.environment.update(true);
      return moving;
    }, 30);
  }
}
