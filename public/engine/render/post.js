// Пост-обработка — подключаемый стек эффектов (PostEffect). Финальная сборка кадра (render/composite.js)
// склеивает включённые эффекты в один шейдер: каждый эффект — функция GLSL `vec3 <type>(vec3 col, vec2 uv)`,
// они вызываются по порядку order. Шейдер пересобирается только при смене набора эффектов, а параметры
// меняются через uniforms — без пересборки. Изменение параметров рисует только сборку кадра (слой "composite").
//
//   engine.post.add("vignette", { amount: .3 });
//   engine.post.set("grade", { saturation: .8 });
//   engine.post.remove("grain");
//
// В данных сцены: "post": [ { "type": "grade", "contrast": 1.05 }, { "type": "vignette", "amount": 0.24 },
//                           { "type": "lut", "texture": "img/lut/cold.png" } ]
//
// Свой эффект (без правки файлов движка):
//   class Sepia extends PostEffect {
//     static type = "sepia";
//     static order = 50;
//     static props = { amount: { type: "number", default: 1, min: 0, max: 1 } };
//     static glsl = `
//       uniform float uSepiaAmount;
//       vec3 sepia(vec3 col, vec2 uv) {
//         vec3 s = vec3(dot(col, vec3(.393, .769, .189)), dot(col, vec3(.349, .686, .168)), dot(col, vec3(.272, .534, .131)));
//         return mix(col, s, uSepiaAmount);
//       }`;
//     uniforms(p) { return { uSepiaAmount: p.amount }; }
//   }
//   registerPostEffect(Sepia);
//   engine.post.add("sepia", { amount: .6 });
//
// Эффект из нескольких проходов (bloom) объявляет prepare(): свои буферы и проходы до сборки кадра.
// Эффект с анимацией объявляет static fps — пока он включён, кадры сборки рисуются с этой частотой (I3).
// @ts-check
import * as THREE from "three";
import { resolveProps } from "../core/component.js";

/** @type {Map<string, typeof PostEffect>} */
const registry = new Map();

/** Зарегистрировать эффект: после этого его можно добавлять по имени type. @param {typeof PostEffect} C */
export function registerPostEffect(C) {
  if (!C.type) throw new Error("У эффекта нужно static type = \"имя\"");
  if (!/^[a-z][A-Za-z0-9]*$/.test(C.type)) throw new Error(`Имя эффекта «${C.type}»: латиница и цифры, с маленькой буквы (это имя функции GLSL)`);
  registry.set(C.type, C);
  return C;
}

/** @param {string} type */
export const getPostEffectClass = type => registry.get(type);
export const postEffectTypes = () => [...registry.keys()];

/**
 * @typedef {object} PostInputs  что доступно эффектам при подготовке и в сборке
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Texture} scene      буфер сцены (цвет, прозрачность там, где небо)
 * @property {THREE.Texture} depth      глубина сцены
 * @property {THREE.PerspectiveCamera} camera
 * @property {number} width   ширина буфера сцены, px
 * @property {number} height
 * @property {boolean} sceneChanged   сцена перерисована в этом кадре
 */

export class PostEffect {
  /** Имя (оно же имя функции GLSL) */
  static type = "";
  static doc = "";
  /** Порядок применения: меньше — раньше. Дизеринг — последний (1000). */
  static order = 0;
  /** Частота кадров для анимированного эффекта (0 — без анимации) */
  static fps = 0;
  /** @type {Record<string, import("../core/component.js").PropSpec>} */
  static props = {};
  /** GLSL: uniforms эффекта и функция vec3 <type>(vec3 col, vec2 uv) */
  static glsl = "";

  /**
   * @param {PostStack} stack @param {Record<string, any>} [props]
   */
  constructor(stack, props = {}) {
    this.stack = stack;
    this.enabled = true;
    const C = /** @type {typeof PostEffect} */ (this.constructor);
    /** @type {Record<string, any>} */
    this.props = resolveProps(/** @type {any} */ (C), props, `эффект ${C.type}`);
  }

  get type() { return /** @type {typeof PostEffect} */ (this.constructor).type; }

  /** Значения uniforms по свойствам (имена — из static glsl). @param {Record<string, any>} props @returns {Record<string, any>} */
  uniforms(props) { void props; return {}; }

  /** Проходы до сборки кадра (многопроходные эффекты). @param {PostInputs} inputs */
  prepare(inputs) { void inputs; }

  /** Поменять свойства: uniforms обновятся без пересборки шейдера. @param {Record<string, any>} patch */
  set(patch) {
    const C = /** @type {typeof PostEffect} */ (this.constructor);
    this.props = resolveProps(/** @type {any} */ (C), { ...this.props, ...patch }, `эффект ${C.type}`);
    this.stack.sync(this);
  }

  dispose() {}

  toJSON() {
    const C = /** @type {typeof PostEffect} */ (this.constructor);
    /** @type {Record<string, any>} */
    const out = { type: C.type };
    for (const [k, spec] of Object.entries(C.props)) if (JSON.stringify(this.props[k]) !== JSON.stringify(spec.default)) out[k] = this.props[k];
    return out;
  }
}

/** Полноэкранный проход: нарисовать material в target. */
export class FullscreenPass {
  /** @param {THREE.ShaderMaterial} material */
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** @param {THREE.WebGLRenderer} renderer @param {THREE.WebGLRenderTarget | null} target */
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Стек эффектов движка — engine.post. */
export class PostStack {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {PostEffect[]} */
    this.effects = [];
    /** Меняется при смене набора — сборка кадра пересобирает шейдер */
    this.version = 0;
    /** Набор по умолчанию (style.filters) — к нему возвращается следующая сцена @type {Record<string, any>[]} */
    this.base = [];
    /** Какие эффекты поменяла текущая сцена @type {Set<string>} */
    this.sceneTypes = new Set();
  }

  /** Набор по умолчанию: задаётся при создании движка. @param {Record<string, any>[]} list */
  setBase(list) {
    this.base = list.map(x => ({ ...x }));
    this.configure(this.base);
  }

  /**
   * Эффекты сцены ("post" в данных): прежняя сцена откатывается к набору по умолчанию, затем применяется новая.
   * @param {Record<string, any>[]} list
   */
  applyScene(list) {
    for (const type of this.sceneTypes) {
      const base = this.base.find(b => b.type === type);
      if (base) { this.remove(type); this.configure([base]); } else this.remove(type);
    }
    this.sceneTypes = new Set((list || []).map(x => x.type));
    this.configure(list || []);
  }

  /** Эффекты по порядку применения. */
  list() {
    return [...this.effects].sort((a, b) => (/** @type {any} */ (a.constructor)).order - (/** @type {any} */ (b.constructor)).order);
  }

  /** @param {string} type */
  get(type) { return this.effects.find(e => e.type === type) ?? null; }

  /**
   * Добавить эффект (уже есть — поменять свойства).
   * @param {string} type @param {Record<string, any>} [props]
   */
  add(type, props = {}) {
    const old = this.get(type);
    if (old) { old.set(props); return old; }
    const C = registry.get(type);
    if (!C) { console.warn(`Нет эффекта «${type}». Есть: ${postEffectTypes().join(", ")}`); return null; }
    const fx = new C(this, props);
    this.effects.push(fx);
    this.#changed();
    return fx;
  }

  /** Поменять свойства эффекта (нет — добавить). @param {string} type @param {Record<string, any>} patch */
  set(type, patch) {
    return this.add(type, patch);
  }

  /** @param {string} type */
  remove(type) {
    const fx = this.get(type);
    if (!fx) return;
    this.effects = this.effects.filter(e => e !== fx);
    fx.dispose();
    this.#changed();
  }

  /** Убрать всё. */
  clear() {
    for (const fx of this.effects) fx.dispose();
    this.effects = [];
    this.#changed();
  }

  /**
   * Набор из данных: [{ type, ...свойства }]. replace — сначала убрать остальные эффекты.
   * @param {Record<string, any>[]} list @param {{replace?: boolean}} [o]
   */
  configure(list, { replace = false } = {}) {
    if (replace) this.clear();
    for (const item of list || []) {
      const { type, enabled, ...props } = item;
      if (enabled === false) this.remove(type);
      else this.add(type, props);
    }
  }

  /** Свойства эффекта поменялись — обновить uniforms. @param {PostEffect} fx */
  sync(fx) {
    this.engine.composite?.syncEffect(fx);
    this.#animate();
    this.engine.invalidate("composite");
  }

  #changed() {
    this.version++;
    this.#animate();
    this.engine.invalidate("composite");
  }

  /** Анимированные эффекты (static fps) просят кадры сборки, пока включены. */
  #animate() {
    const loop = this.engine.loop;
    let fps = 0;
    for (const fx of this.effects) {
      const C = /** @type {any} */ (fx.constructor);
      if (fx.enabled && C.fps && /** @type {any} */ (fx).animated !== false) fps = Math.max(fps, C.fps);
    }
    if (fps > 0 && this.engine.options.animate !== false) {
      loop.animate("post", () => { this.engine.invalidate("composite"); }, fps);
    } else loop.stop("post");
  }

  /** Проходы до сборки кадра. @param {PostInputs} inputs */
  prepare(inputs) {
    for (const fx of this.effects) if (fx.enabled) fx.prepare(inputs);
  }

  toJSON() { return this.list().map(e => e.toJSON()); }
}
