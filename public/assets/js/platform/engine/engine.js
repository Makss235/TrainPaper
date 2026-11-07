// Движок «Платформы»: WebGL-рендерер, камера, слои кадра и отрисовка по требованию.
//
// Кадр собирается из слоёв, каждый перерисовывается, только когда изменился (engine/loop.js):
//   небо  → буфер пониженного разрешения (облака мягкие — половины хватает), ~12 раз/с, пока плывут;
//   сцена → буфер полного разрешения со сглаживанием MSAA; только при движении камеры, поезда, света;
//   тени  → карта теней от солнца; только когда сдвинулось солнце или проехал поезд;
//   сборка → один полноэкранный проход: небо + звёзды/луна + сцена + осадки + фильтры.
// Когда ничего не меняется (поезд стоит, ясное небо), движок не рисует ничего и не держит таймеров.
import * as THREE from "three";
import { STYLE } from "../style.js";
import { CameraRig } from "./camera.js";
import { Composite } from "./composite.js";
import { LIGHT, updateLight } from "./light.js";
import { Loop } from "./loop.js";
import { SunShadow } from "./shadows.js";
import { WIRE_UNIFORMS } from "./wires.js";
import { SkyLayer } from "../sky/sky.js";

const RAD = Math.PI / 180;

/** Направление на светило в мире: камера по умолчанию смотрит вдоль −z на азимут viewAz (°). */
export function skyDirection(azimuth, altitude, viewAz) {
  const rel = (azimuth - viewAz) * RAD, alt = altitude * RAD;
  return new THREE.Vector3(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
}

export class Engine {
  constructor(canvas) {
    const Q = STYLE.quality;
    // цвета сцены уже «экранные» (sRGB): three.js не должен их пересчитывать ни на входе, ни на выходе
    THREE.ColorManagement.enabled = false;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: Q.powerPreference, preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.webgl2 = this.renderer.capabilities.isWebGL2;

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(50, 1, .3, 6000);
    this.rig = new CameraRig(this.camera);

    const samples = this.webgl2 ? Q.msaa : 0;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { samples, depthBuffer: true, stencilBuffer: false });
    this.skyTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
    this.sky = new SkyLayer();
    this.composite = new Composite();
    const maxTex = this.renderer.capabilities.maxTextureSize;
    this.shadow = new SunShadow(this.renderer, Math.min(Q.shadowSize, maxTex));

    this.loop = new Loop(layers => this.render(layers), { maxFps: Q.maxFps });
    this.afterRender = [];                 // колбэки после кадра (табло подстраивается под камеру)
    this.width = 1; this.height = 1;

    canvas.addEventListener("webglcontextlost", e => e.preventDefault());
    // после сброса видеодрайвера проще и надёжнее начать заново, чем восстанавливать буферы
    canvas.addEventListener("webglcontextrestored", () => location.reload());
    this.resize();
  }

  resize() {
    const Q = STYLE.quality;
    const W = innerWidth, H = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, Q.pixelRatio);
    this.width = W; this.height = H; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(W, H);
    const bw = Math.round(W * pr), bh = Math.round(H * pr);
    this.sceneTarget.setSize(bw, bh);
    this.skyTarget.setSize(Math.max(1, Math.round(bw * Q.skyScale)), Math.max(1, Math.round(bh * Q.skyScale)));
    WIRE_UNIFORMS.uRes.value.set(bw, bh);
    this.rig.layout(W, H);
    this.loop.invalidate("sky", "scene");
  }

  /**
   * Свет, небо и тени по времени суток и погоде.
   * env — lib/sky.js environment() с поправкой на погоду, celestial — солнце и луна, weather — параметры.
   */
  setEnvironment(env, celestial, weather, viewAz) {
    const sunDir = skyDirection(celestial.sun.azimuth, celestial.sun.altitude, viewAz);
    const light = updateLight(env, sunDir, weather);
    this.sky.set(env, celestial, sunDir, weather);
    const C = this.composite.uniforms;
    C.uSunDir.value.copy(sunDir);
    C.uStars.value = env.stars * (1 - weather.overcast);
    C.uSkyTop.value.set(env.top[0] / 255, env.top[1] / 255, env.top[2] / 255);
    if (celestial.moon) {
      C.uMoonDir.value.copy(skyDirection(celestial.moon.azimuth, celestial.moon.altitude, viewAz));
      const up = Math.min(1, Math.max(0, (celestial.moon.altitude + 1) / 3));
      const dark = Math.min(1, Math.max(0, (6 - celestial.sun.altitude) / 10));
      C.uMoon.value = up * (.35 + .65 * dark) * (1 - weather.overcast * .9);
    } else {
      C.uMoon.value = 0;
    }
    C.uPrecip.value.x = weather.rain;
    C.uPrecip.value.y = weather.snow;
    C.uPrecip.value.z = weather.wind[0] / 10;
    const g = .55 + .45 * light.day;
    C.uPrecipColor.value.set(.78 * g + .12, .82 * g + .12, .88 * g + .12);
    this.shadow.update(this.scene, LIGHT.uSunDir.value, light.direct);
    this.light = light;
    this.loop.invalidate("sky", "scene", "shadow");
    return light;
  }

  render(layers) {
    const r = this.renderer;
    r.info.reset();
    if (layers.has("shadow")) this.shadow.render(this.scene);
    if (layers.has("scene") || layers.has("shadow")) {
      r.setRenderTarget(this.sceneTarget);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(this.scene, this.camera);
    }
    if (layers.has("sky")) this.sky.render(r, this.skyTarget, this.camera);
    this.composite.uniforms.uPrecip.value.w = -this.camera.rotation.y * .6;
    this.composite.render(r, this.skyTarget.texture, this.sceneTarget.texture, this.camera,
      this.sceneTarget.width, this.sceneTarget.height);
    for (const fn of this.afterRender) fn(layers);
  }

  /** Экранные координаты (CSS-пиксели) точки мира или null, если она за спиной камеры. */
  project(p) {
    const v = new THREE.Vector3(...p).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -.3) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return [(v.x + 1) / 2 * this.width, (1 - v.y) / 2 * this.height];
  }
}
