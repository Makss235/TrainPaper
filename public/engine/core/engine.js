// Движок: WebGL-рендерер, сцена из объектов с компонентами, камеры, свет, окружение и погода,
// отрисовка по требованию.
//
//   import { Engine } from "../engine/index.js";
//   const engine = new Engine({ container: document.getElementById("view"),
//     paths: { models: "/assets/models/", prefabs: "/assets/prefabs/" } });
//   await engine.load("/assets/scenes/typical.jsonc");
//   engine.environment.setTime(new Date());
//   engine.weather.set("rain");
//
// Кадр собирается из слоёв, каждый перерисовывается, только когда изменился (core/loop.js):
//   небо   → буфер пониженного разрешения, пока плывут облака (~12 раз/с);
//   сцена  → буфер полного разрешения со сглаживанием и текстурой глубины; только при изменениях;
//   тени   → карта теней от солнца; только когда сдвинулось солнце или что-то подвинулось;
//   осадки → частицы в мире поверх готовой сцены с проверкой её глубины (пока идёт дождь/снег);
//   сборка → один проход: небо + звёзды/луна + сцена + осадки + фильтры.
// Когда ничего не меняется, движок не рисует ничего и не держит таймеров.
// @ts-check
import * as THREE from "three";
import { AssetManager } from "../assets/assets.js";
import { Environment, WeatherController } from "../environment/environment.js";
import { Precipitation } from "../environment/precipitation.js";
import { SkyLayer } from "../environment/sky.js";
import { Composite } from "../render/composite.js";
import { createLightUniforms } from "../render/lighting.js";
import { Materials } from "../render/materials.js";
import { definePalette } from "../render/palette.js";
import { SunShadow } from "../render/shadows.js";
import { DEFAULT_QUALITY, DEFAULT_STYLE, mergeDeep } from "../render/style.js";
import { CameraSystem } from "../systems/cameras.js";
import { LightSystem } from "../systems/lights.js";
import { loadData } from "./data.js";
import { Loop } from "./loop.js";
import { Scene } from "./scene.js";

class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, ...args) { for (const fn of this.map.get(name) || []) { try { fn(...args); } catch (e) { console.error(e); } } }
}

/**
 * @typedef {object} EngineOptions
 * @property {HTMLElement} [container]   куда вставить холст (заполняет контейнер целиком)
 * @property {HTMLCanvasElement} [canvas] или готовый холст
 * @property {Partial<typeof DEFAULT_QUALITY>} [quality]  качество и нагрузка
 * @property {any} [style]               стиль: свет, дымка, фильтры (render/style.js)
 * @property {{models?: string, prefabs?: string, manifest?: string|null}} [paths]  где лежат модели и префабы
 * @property {Record<string, string>} [palette]  именованные цвета
 * @property {boolean} [pointer]         камера поворачивается за курсором (по умолчанию да)
 * @property {boolean} [animate]         анимации (false — для скриншотов: всё сразу, без движения)
 * @property {boolean} [batching]        склеивать неподвижные одинаковые меши (по умолчанию да)
 */

export class Engine {
  /** @param {EngineOptions} [options] */
  constructor(options = {}) {
    this.options = options;
    this.quality = { ...DEFAULT_QUALITY, ...(options.quality || {}) };
    this.style = mergeDeep(DEFAULT_STYLE, options.style);
    if (options.palette) definePalette(options.palette);
    this.events = new Events();
    // цвета сцены уже «экранные» (sRGB): three.js не должен их пересчитывать
    THREE.ColorManagement.enabled = false;

    const canvas = options.canvas || document.createElement("canvas");
    this.container = options.container || canvas.parentElement || document.body;
    if (!options.canvas) {
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
      this.container.prepend(canvas);
    }
    this.canvas = canvas;
    const Q = this.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: Q.powerPreference, preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    const webgl2 = this.renderer.capabilities.isWebGL2;

    /** Сцена three.js, в которой лежит дерево объектов */
    this.three = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, .3, 6000);
    this.screen = { uRes: { value: new THREE.Vector2(1, 1) }, uMinPx: { value: 1 } };
    this.light = createLightUniforms(this.style);
    this.materials = new Materials(this.light, this.screen);

    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { samples: webgl2 ? Q.msaa : 0, depthBuffer: true, depthTexture: depth });
    this.skyTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.fxTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.sky = new SkyLayer();
    this.composite = new Composite(this.style);
    this.shadow = new SunShadow(this.renderer, this.light, Math.min(Q.shadowSize, this.renderer.capabilities.maxTextureSize));

    this.loop = new Loop(layers => this.render(layers), { maxFps: Q.maxFps });
    this.assets = new AssetManager(this, options.paths);
    this.scene = new Scene(this);
    this.three.add(this.scene.object3D);
    this.cameras = new CameraSystem(this);
    this.lights = new LightSystem(this);
    this.weather = new WeatherController(this);
    this.environment = new Environment(this);
    this.precipitation = new Precipitation(this);
    /** @type {((layers: Set<string>) => void)[]} после каждого кадра (HTML поверх сцены подстраивается под камеру) */
    this.afterRender = [];

    canvas.addEventListener("webglcontextlost", e => e.preventDefault());
    canvas.addEventListener("webglcontextrestored", () => this.events.emit("contextRestored"));
    // текстуры с текстом (таблички, ливреи) перерисовываются, когда догрузится шрифт, — показать их сразу
    document.fonts?.ready.then(() => setTimeout(() => this.invalidate("scene"), 0));
    this.onResize = () => this.resize();
    addEventListener("resize", this.onResize);
    if (options.pointer !== false) {
      this.onPointer = e => this.cameras.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1);
      addEventListener("pointermove", this.onPointer);
    }
    this.resize();
    this.environment.update(true);
  }

  /** Подписка на события: "sceneLoaded", "environment", "cameraChanged", "frame". */
  on(name, fn) { return this.events.on(name, fn); }

  /** Перерисовать слои: "scene", "sky", "shadow", "fx", "composite". */
  invalidate(...layers) {
    if (layers.includes("shadow")) this.precipitation.markDirty();
    this.loop.invalidate(...layers);
  }

  /**
   * Загрузить сцену (адрес JSONC или объект данных).
   * @param {string | Record<string, any>} source
   */
  async load(source) {
    const data = typeof source === "string" ? await loadData(source) : source;
    this.cameras.cameras = [];
    this.cameras.active = null;
    await this.scene.load(data);
    this.environment.configure(this.scene.settings);
    this.cameras.update(0);
    this.lights.markDirty();
    this.invalidate("scene", "sky", "shadow");
    return this.scene;
  }

  /** Найти объект по имени (или пути «Платформа/Фонарь 3»). @param {string} name */
  find(name) {
    return this.scene.find(name);
  }

  /**
   * Создать объект из данных (или имени префаба) и добавить в сцену (или к parent).
   * @param {string | Record<string, any>} data
   * @param {import("./game-object.js").GameObject} [parent]
   */
  async instantiate(data, parent) {
    const od = typeof data === "string" ? { prefab: data } : data;
    const [resolved] = await this.scene.resolve([od]);
    const tmp = this.scene;
    const go = tmp.instantiate(resolved);
    (parent || this.scene.root).add(go);
    return go;
  }

  resize() {
    const Q = this.quality;
    const rect = this.container.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width || innerWidth)), H = Math.max(1, Math.round(rect.height || innerHeight));
    const pr = Math.min(devicePixelRatio || 1, Q.pixelRatio);
    this.width = W; this.height = H; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(W, H, !this.options.canvas);
    const bw = Math.round(W * pr), bh = Math.round(H * pr);
    this.sceneTarget.setSize(bw, bh);
    this.skyTarget.setSize(Math.max(1, Math.round(bw * Q.skyScale)), Math.max(1, Math.round(bh * Q.skyScale)));
    this.fxTarget.setSize(Math.max(1, Math.round(bw * Q.precipScale)), Math.max(1, Math.round(bh * Q.precipScale)));
    this.screen.uRes.value.set(bw, bh);
    this.cameras.layout(W, H);
    this.cameras.update(0);
    this.invalidate("scene", "sky");
  }

  /** Нарисовать кадр (вызывает цикл; вручную не нужно). @param {Set<string>} layers */
  render(layers) {
    const r = this.renderer;
    r.info.reset();
    this.lights.update();
    if (layers.has("shadow")) this.shadow.render(this.three);
    const sceneChanged = layers.has("scene") || layers.has("shadow");
    if (sceneChanged) {
      r.setRenderTarget(this.sceneTarget);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(this.three, this.camera);
    }
    if (layers.has("sky")) this.sky.render(r, this.skyTarget, this.camera);
    const fx = this.precipitation.active;
    if (fx && (layers.has("fx") || sceneChanged)) {
      this.precipitation.render(r, this.fxTarget, this.sceneTarget.depthTexture, this.camera, this.three);
    }
    this.composite.render(r, this.skyTarget.texture, this.sceneTarget.texture, fx ? this.fxTarget.texture : null,
      this.camera, this.sceneTarget.width, this.sceneTarget.height);
    for (const fn of this.afterRender) fn(layers);
    this.events.emit("frame", layers);
  }

  /**
   * Экранные координаты (CSS-пиксели) точки мира или null, если она за камерой.
   * @param {number[]} p
   * @returns {[number, number] | null}
   */
  project(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -this.camera.near) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return [(v.x + 1) / 2 * this.width, (1 - v.y) / 2 * this.height];
  }

  /** Остановить и освободить всё (холст остаётся в DOM, если передан снаружи). */
  dispose() {
    removeEventListener("resize", this.onResize);
    if (this.onPointer) removeEventListener("pointermove", this.onPointer);
    for (const k of [...this.loop.anims.keys()]) this.loop.stop(k);
    this.scene.clear();
    this.precipitation.dispose();
    this.shadow.dispose();
    for (const t of [this.sceneTarget, this.skyTarget, this.fxTarget]) t.dispose();
    this.renderer.dispose();
    if (!this.options.canvas) this.canvas.remove();
  }
}
