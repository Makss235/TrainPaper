// Компонент — кусочек поведения или внешнего вида, прикреплённый к объекту сцены (как в Unity).
//
// Свой компонент:
//
//   class Blink extends Component {
//     static type = "Blink";
//     static doc = "Мигает объектом";
//     static props = {
//       period: { type: "number", default: 1, min: 0.1, doc: "Период, с" },
//     };
//     start() { this.animate(now => { this.gameObject.object3D.visible = (now / 1000 / this.props.period) % 1 < .5; this.invalidate(); }, 10); }
//   }
//   registerComponent(Blink);
//
// Жизненный цикл: awake() — объект создан и все компоненты сцены прикреплены; start() — сцена
// загружена (можно искать другие объекты); onEnable()/onDisable() — объект включили/выключили;
// onChange(keys) — поменялись свойства (через set()); onDestroy() — объект удалён.
// Компонент не крутит кадры сам: для анимации есть animate(tick, fps) — кадры рисуются, только пока она идёт.
// @ts-check

/**
 * @typedef {object} PropSpec  Описание свойства компонента (для проверки данных, инспектора и документации)
 * @property {string} type  "number" | "string" | "boolean" | "color" | "vec2" | "vec3" | "enum" | "array" | "object" | "asset"
 * @property {any} [default]   значение по умолчанию
 * @property {string} [doc]    пояснение
 * @property {string[]} [options]  варианты для enum
 * @property {number} [min]
 * @property {number} [max]
 */

/** @type {Map<string, typeof Component>} */
const registry = new Map();

/**
 * Зарегистрировать тип компонента: после этого его можно указывать в данных сцены по имени type.
 * @param {typeof Component} Class
 */
export function registerComponent(Class) {
  if (!Class.type || Class.type === "Component") throw new Error("У компонента нужно static type = \"Имя\"");
  registry.set(Class.type, Class);
  return Class;
}

/** @param {string} type */
export function getComponentClass(type) {
  return registry.get(type);
}

export function componentTypes() {
  return [...registry.keys()];
}

let uid = 0;

export class Component {
  /** Имя типа в данных сцены: { "type": "Model", ... } */
  static type = "Component";
  /** Пояснение для документации и инспектора */
  static doc = "";
  /** @type {Record<string, PropSpec>} */
  static props = {};

  /**
   * @param {import("./game-object.js").GameObject} gameObject
   * @param {Record<string, any>} [props]
   */
  constructor(gameObject, props = {}) {
    this.gameObject = gameObject;
    this.id = ++uid;
    this.enabled = true;
    /** Метка компонента из данных ("id": "roof") — чтобы различать два компонента одного типа в префабе */
    /** @type {string | undefined} */
    this.key = undefined;
    const C = /** @type {typeof Component} */ (this.constructor);
    /** @type {Record<string, any>} */
    this.props = resolveProps(C, props, gameObject?.name);
  }

  /** @returns {string} */
  get type() { return /** @type {typeof Component} */ (this.constructor).type; }
  /** @returns {import("./engine.js").Engine} */
  get engine() { return this.gameObject.engine; }
  /** Трансформ объекта — THREE.Object3D: position, rotation, scale, родитель. */
  get object3D() { return this.gameObject.object3D; }

  // ---------- жизненный цикл (переопределяйте нужное) ----------
  awake() {}
  start() {}
  onEnable() {}
  onDisable() {}
  /** @param {string[]} keys */
  onChange(keys) { void keys; }
  onDestroy() {}

  /**
   * Поменять свойства (из кода или инспектора): значения проверяются, вызывается onChange, кадр перерисовывается.
   * @param {Record<string, any>} patch
   */
  set(patch) {
    const C = /** @type {typeof Component} */ (this.constructor);
    const next = resolveProps(C, { ...this.props, ...patch }, this.gameObject?.name);
    const keys = Object.keys(patch).filter(k => JSON.stringify(next[k]) !== JSON.stringify(this.props[k]));
    this.props = next;
    if (keys.length) {
      this.onChange(keys);
      this.invalidate("scene", "shadow");
    }
  }

  /** Попросить движок перерисовать слои (по умолчанию — сцену). @param {...string} layers */
  invalidate(...layers) {
    this.engine?.invalidate(...(layers.length ? layers : ["scene"]));
  }

  /**
   * Анимация: tick(now, dt) вызывается fps раз в секунду, пока возвращает не false и компонент жив.
   * Кадры при этом рисуются только по invalidate() внутри tick.
   * @param {(now: number, dt: number) => boolean | void} tick
   * @param {number} [fps]
   * @param {string} [key]  имя анимации (по умолчанию одна на компонент)
   */
  animate(tick, fps, key = "") {
    this.engine.loop.animate(`c${this.id}${key}`, (now, dt) => (this.enabled && this.gameObject.activeInHierarchy ? tick(now, dt) : true), fps);
  }

  /** @param {string} [key] */
  stopAnimation(key = "") {
    this.engine?.loop.stop(`c${this.id}${key}`);
  }

  /** Данные компонента для файла сцены: только отличия от значений по умолчанию. */
  toJSON() {
    const C = /** @type {typeof Component} */ (this.constructor);
    /** @type {Record<string, any>} */
    const out = { type: C.type };
    if (this.key !== undefined) out.id = this.key;
    for (const [k, spec] of Object.entries(C.props)) {
      if (JSON.stringify(this.props[k]) !== JSON.stringify(spec.default)) out[k] = this.props[k];
    }
    return out;
  }
}

/**
 * Свойства по схеме: значения по умолчанию, приведение типов, предупреждения о лишнем.
 * @param {typeof Component} C
 * @param {Record<string, any>} input
 * @param {string} [owner]
 */
export function resolveProps(C, input, owner = "") {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, spec] of Object.entries(C.props)) {
    let v = input[k];
    if (v === undefined) v = typeof spec.default === "object" && spec.default !== null ? structuredClone(spec.default) : spec.default;
    else if (spec.type === "number" && typeof v !== "number") v = Number(v);
    else if (spec.type === "boolean") v = !!v;
    if (spec.type === "number" && typeof v === "number") {
      if (spec.min !== undefined) v = Math.max(spec.min, v);
      if (spec.max !== undefined) v = Math.min(spec.max, v);
    }
    if (spec.type === "enum" && spec.options && !spec.options.includes(v)) {
      console.warn(`${owner}: ${C.type}.${k} = «${v}» — нет такого варианта (${spec.options.join(", ")})`);
      v = spec.default;
    }
    out[k] = v;
  }
  for (const k of Object.keys(input)) {
    if (k !== "type" && !(k in C.props)) console.warn(`${owner}: у компонента ${C.type} нет свойства «${k}». Есть: ${Object.keys(C.props).join(", ") || "—"}`);
  }
  return out;
}
