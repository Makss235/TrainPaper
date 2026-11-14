// Компонент — кусочек поведения или внешнего вида, прикреплённый к объекту сцены (как в Unity).
//
//   class Blinker extends Component {
//     static type = "Blinker";
//     static doc = "Мигает объектом";
//     static fps = 4;                                     // update не чаще 4 раз в секунду
//     static props = { period: { type: "number", default: 1, min: .1, doc: "Период, с" } };
//     update(dt) { this.t = (this.t ?? 0) + dt; this.object3D.visible = this.t % this.props.period < this.props.period / 2; this.invalidate(); }
//   }
//   registerComponent(Blinker);
//
// Жизненный цикл: awake() — объект создан и все компоненты сцены прикреплены; start() — сцена
// загружена, ссылки (props типа ref/component) раскрыты, можно искать другие объекты; start может быть async;
// onEnable()/onDisable() — объект или компонент включили/выключили; onChange(keys) — поменялись свойства
// (через set()); onDestroy() — объект удалён.
//
// Оживить объект можно двумя способами (движок рисует кадры, только пока они работают):
//   update(dt)                 — метод класса: постоянное поведение; this.sleep() / this.wake(); static fps, static order;
//                                dt — секунды симуляции (engine.time), static realTime = true — реальные;
//   this.animate(tick, fps)    — анимация по месту: функция tick(now, dt) идёт, пока не вернёт false
//                                (или до this.stopAnimation()); у компонента их может быть несколько — по именам;
// и два помощника поверх них:
//   this.tween({ from, to, duration, ease, onUpdate })   — разовый плавный переход, промис;
//   this.wait(с) / this.every(с, fn) / this.at("14:05", fn)  — таймеры и корутины по часам симуляции.
// Всё это снимается само, когда компонент удалён (this.signal); промисы wait/tween отклоняются CancelledError,
// который движок не выводит в консоль.
// @ts-check
import { CancelledError, isCancelled } from "./time.js";

/**
 * @typedef {object} PropSpec  Описание свойства компонента (для проверки данных, инспектора и документации)
 * @property {string} type  "number" | "string" | "boolean" | "color" | "vec2" | "vec3" | "enum" | "array" | "object" | "asset"
 *   | "ref" (имя или путь объекта → GameObject) | "component" ("Дверь 2#Door" → компонент)
 * @property {any} [default]   значение по умолчанию
 * @property {string} [doc]    пояснение
 * @property {string[]} [options]  варианты для enum
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [component]  для type "component": тип компонента, если в ссылке нет «#Тип»
 */

/** @type {Map<string, typeof Component>} */
const registry = new Map();

/**
 * Зарегистрировать тип компонента: после этого его можно указывать в данных сцены по имени type.
 * @template {typeof Component} C
 * @param {C} Class
 * @param {string} [type]  имя (по умолчанию static type класса)
 * @returns {C}
 */
export function registerComponent(Class, type) {
  const name = type || (Object.prototype.hasOwnProperty.call(Class, "type") ? Class.type : "");
  if (!name || name === "Component" || name === "Script") throw new Error("У компонента нужно static type = \"Имя\"");
  if (type && Class.type !== type) Object.defineProperty(Class, "type", { value: type, configurable: true, writable: true });
  registry.set(name, Class);
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

/** @typedef {import("./game-object.js").GameObject} GameObject */
/** @typedef {import("./engine.js").Engine} Engine */

export class Component {
  /** Имя типа в данных сцены: { "type": "Model", ... } */
  static type = "Component";
  /** Пояснение для документации и инспектора */
  static doc = "";
  /** Категория в инспекторе: "Движок", "Скрипт", … */
  static category = "";
  /** @type {Record<string, PropSpec>} */
  static props = {};
  /** Частота update(), раз в секунду (0 — частота кадров) */
  static fps = 0;
  /** Порядок вызова update() среди компонентов (меньше — раньше) */
  static order = 0;
  /** update(dt) получает реальные секунды (а не секунды симуляции) и идёт на паузе часов */
  static realTime = false;
  /** Кнопки компонента в инспекторе: { "Подпись": "имяМетода" } */
  /** @type {Record<string, string>} */
  static actions = {};

  /**
   * @param {GameObject} gameObject
   * @param {Record<string, any>} [props]
   */
  constructor(gameObject, props = {}) {
    this.gameObject = gameObject;
    this.id = ++uid;
    this._enabled = true;
    /** Метка компонента из данных ("id": "roof") — чтобы различать два компонента одного типа в префабе */
    /** @type {string | undefined} */
    this.key = undefined;
    const C = /** @type {typeof Component} */ (this.constructor);
    /** @type {Record<string, any>} */
    this.props = resolveProps(C, props, gameObject?.name);
    /** Имена ссылок (props ref/component) — для toJSON. @type {Record<string, string | null>} */
    this._refNames = {};
    this.started = false;
    this.destroyed = false;
    /** @type {AbortController | null} */
    this._abort = null;
    /** @type {(() => void)[]} */
    this._offs = [];
    /** @type {Set<string>} */
    this._anims = new Set();
  }

  /** @returns {string} */
  get type() { return /** @type {typeof Component} */ (this.constructor).type; }
  /** @returns {Engine} */
  get engine() { return /** @type {Engine} */ (this.gameObject.engine); }
  /** Трансформ объекта — THREE.Object3D: position, rotation, scale, родитель. */
  get object3D() { return this.gameObject.object3D; }
  /** Часы симуляции (engine.time). */
  get time() { return this.engine.time; }

  /** Включён ли компонент (сам по себе; объект может быть выключен — см. activeAndEnabled). */
  get enabled() { return this._enabled; }
  set enabled(on) { this.setEnabled(on); }
  /** Компонент включён и объект активен в иерархии. */
  get activeAndEnabled() { return this._enabled && !this.destroyed && !!this.gameObject?.activeInHierarchy; }

  /** Включить/выключить компонент: onEnable/onDisable, update засыпает. @param {boolean} on */
  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return;
    const was = this.activeAndEnabled;
    this._enabled = on;
    if (this.started && was !== this.activeAndEnabled) this._activeChanged(on);
    this.engine?.invalidate("scene", "shadow");
  }

  /** Сигнал отмены: срабатывает при удалении компонента. Передавайте в fetch и свои ожидания. */
  get signal() {
    return (this._abort ||= new AbortController()).signal;
  }

  // ---------- жизненный цикл (переопределяйте нужное) ----------
  awake() {}
  /** @returns {void | Promise<void>} */
  start() {}
  onEnable() {}
  onDisable() {}
  /** @param {string[]} keys */
  onChange(keys) { void keys; }
  onDestroy() {}
  /** Постоянное поведение: dt — секунды симуляции (static realTime — реальные). Объявите метод в классе. @param {number} dt */
  update(dt) { void dt; }

  /** Объявлен ли в классе update(). */
  get hasUpdate() { return this.update !== Component.prototype.update; }

  /** Перестать вызывать update() (до wake()). */
  sleep() { this.engine?.scheduler.sleep(this); }
  /** Снова вызывать update() (если компонент включён и объект активен). */
  wake() {
    if (this.hasUpdate && this.started && this.activeAndEnabled) this.engine.scheduler.wake(this);
  }
  /** Вызывается ли сейчас update(). */
  get awakeNow() { return !!this.engine?.scheduler.isAwake(this); }

  // ---------- внутреннее: движок вызывает сам ----------

  /** Раскрыть ссылки, start(), разбудить update. */
  _start() {
    if (this.started || this.destroyed) return;
    this._resolveRefs();
    this.started = true;
    let result;
    try {
      result = this.start();
    } catch (error) {
      this.#report("start()", error);
    }
    if (result && typeof result.then === "function") result.then(undefined, error => this.#report("start()", error));
    if (!this.destroyed) this.wake();
  }

  /** @param {boolean} on */
  _activeChanged(on) {
    if (on) { this.onEnable(); this.wake(); } else { this.sleep(); this.onDisable(); }
  }

  _destroy() {
    if (this.destroyed) return;
    this.sleep();
    this.destroyed = true;
    this._abort?.abort(new CancelledError("Компонент удалён"));
    for (const off of this._offs.splice(0)) off();
    for (const key of this._anims) this.engine?.loop.stop(key);
    this._anims.clear();
    try { this.onDestroy(); } catch (error) { this.#report("onDestroy()", error); }
  }

  /** @param {string} where @param {any} error */
  #report(where, error) {
    if (isCancelled(error)) return;
    console.error(`Объект «${this.gameObject?.name}», компонент ${this.type}: ошибка в ${where}`, error);
  }

  /** Свойства типа ref/component: имя → объект/компонент. */
  _resolveRefs() {
    const C = /** @type {typeof Component} */ (this.constructor);
    for (const [k, spec] of Object.entries(C.props)) {
      if (spec.type !== "ref" && spec.type !== "component") continue;
      const v = this.props[k];
      if (typeof v !== "string") { if (v == null) this._refNames[k] = null; continue; }
      this._refNames[k] = v;
      this.props[k] = v ? this.#lookup(v, spec, k) : null;
    }
  }

  /** @param {string} ref @param {PropSpec} spec @param {string} key */
  #lookup(ref, spec, key) {
    const scene = this.engine?.scene;
    if (spec.type === "ref") {
      const go = scene?.find(ref) ?? null;
      if (!go) console.warn(`Объект «${this.gameObject.name}», ${this.type}.${key}: нет объекта «${ref}»`);
      return go;
    }
    const [path, typeName] = ref.includes("#") ? ref.split("#") : [ref, spec.component || ""];
    const go = scene?.find(path) ?? null;
    const comp = go ? (typeName ? go.getComponent(typeName) : go.components[0]) : null;
    if (!comp) console.warn(`Объект «${this.gameObject.name}», ${this.type}.${key}: нет ${go ? `компонента ${typeName} у объекта` : "объекта"} «${path}»`);
    return comp ?? null;
  }

  /**
   * Поменять свойства (из кода или инспектора): значения проверяются, вызывается onChange, кадр перерисовывается.
   * @param {Record<string, any>} patch
   */
  set(patch) {
    const C = /** @type {typeof Component} */ (this.constructor);
    const next = resolveProps(C, { ...this.props, ...patch }, this.gameObject?.name);
    const keys = Object.keys(patch).filter(k => !sameValue(next[k], this.props[k]));
    this.props = next;
    if (this.started) {
      for (const k of keys) {
        const spec = C.props[k];
        if ((spec?.type === "ref" || spec?.type === "component") && typeof next[k] === "string") {
          this._refNames[k] = next[k];
          this.props[k] = next[k] ? this.#lookup(next[k], spec, k) : null;
        } else if (spec?.type === "ref" || spec?.type === "component") {
          this._refNames[k] = null;
        }
      }
    }
    if (keys.length) {
      this.onChange(keys);
      this.invalidate("scene", "shadow");
    }
  }

  /** Попросить движок перерисовать слои (по умолчанию — сцену). @param {...string} layers */
  invalidate(...layers) {
    this.engine?.invalidate(...(layers.length ? layers : ["scene"]));
  }

  // ---------- время: таймеры, корутины, переходы ----------

  /** Подождать seconds секунд симуляции: await this.wait(30). @param {number} seconds */
  wait(seconds) { return this.time.wait(seconds, { signal: this.signal, label: this.#label() }); }
  /** Подождать до момента: Date, мс или "ЧЧ:ММ". @param {Date | number | string} when */
  until(when) { return this.time.until(when, { signal: this.signal, label: this.#label() }); }
  /** Вызвать fn через seconds секунд симуляции. Возвращает отмену. @param {number} seconds @param {() => void} fn */
  after(seconds, fn) { return this.time.after(seconds, fn, { signal: this.signal, label: this.#label() }); }
  /** Вызывать fn каждые seconds секунд симуляции. Возвращает отмену. @param {number} seconds @param {() => void} fn */
  every(seconds, fn) { return this.time.every(seconds, fn, { signal: this.signal, label: this.#label() }); }
  /** Вызвать fn в момент when (Date, мс или "ЧЧ:ММ" — ближайшее). Возвращает отмену. @param {Date | number | string} when @param {() => void} fn */
  at(when, fn) { return this.time.at(when, fn, { signal: this.signal, label: this.#label() }); }

  /**
   * Плавный переход (снимается вместе с компонентом). Кадры рисуются, только пока он идёт.
   * @param {import("./scheduler.js").TweenOptions} o
   */
  tween(o) {
    return this.engine.scheduler.tween({ ...o, signal: o.signal || this.signal });
  }

  #label() { return `${this.gameObject?.name} · ${this.type}`; }

  /**
   * Анимация — второй способ оживить объект (первый — метод update): tick(now, dt) вызывается fps раз в секунду,
   * пока не вернёт false, пока её не снимут stopAnimation() или пока компонент жив. Пока объект или компонент
   * выключен, tick не вызывается. Время — реальное: now — мс (как performance.now()), dt — секунды с прошлого вызова.
   * Кадр заказывает сам tick: this.invalidate() или this.gameObject.moved().
   *
   *   this.animate((now, dt) => { this.object3D.rotation.y += dt; this.gameObject.moved(); }, 30);
   *   this.animate(now => { door.position.x = Math.min(1, (now - t0) / 800); this.invalidate(); return now - t0 < 800; }, 60, "door");
   *
   * @param {(now: number, dt: number) => boolean | void} tick
   * @param {number} [fps]  не чаще стольких раз в секунду (по умолчанию — частота кадров)
   * @param {string} [key]  имя анимации: у компонента их может быть несколько; то же имя — замена прежней
   */
  animate(tick, fps, key = "") {
    const k = `c${this.id}${key}`;
    this._anims.add(k);
    this.engine.loop.animate(k, (now, dt) => {
      if (this.destroyed) return false;
      const r = this.activeAndEnabled ? tick(now, dt) : true;
      if (r === false) this._anims.delete(k);
      return r;
    }, fps);
  }

  /** Снять анимацию, запущенную animate(). @param {string} [key] */
  stopAnimation(key = "") {
    const k = `c${this.id}${key}`;
    this._anims.delete(k);
    this.engine?.loop.stop(k);
  }

  /** Идёт ли анимация. @param {string} [key] */
  isAnimating(key = "") { return this._anims.has(`c${this.id}${key}`); }

  // ---------- события ----------

  /**
   * Подписаться на событие target (объект сцены, engine, engine.time — у кого есть on(name, fn)) или своего объекта
   * (this.on("имя", fn)). Подписка снимается сама при удалении компонента. Возвращает отписку.
   * @param {{on: (name: string, fn: (...a: any[]) => void) => (() => void) | void} | string} target
   * @param {string | ((...a: any[]) => void)} name
   * @param {(...a: any[]) => void} [fn]
   */
  on(target, name, fn) {
    if (typeof target === "string") return this.on(this.gameObject, target, /** @type {any} */ (name));
    const off = target.on(/** @type {string} */ (name), /** @type {(...a: any[]) => void} */ (fn));
    const remove = () => { off?.(); this._offs = this._offs.filter(f => f !== remove); };
    this._offs.push(remove);
    return remove;
  }

  /** Событие своего объекта (bubble — поднимается к родителям). @param {string} name @param {any} [data] @param {{bubble?: boolean}} [o] */
  emit(name, data, o) {
    this.gameObject.emit(name, data, o);
  }

  // ---------- удобства для скриптов ----------

  /** Найти объект сцены по имени или пути «Двор/Фонарь 3». @param {string} name */
  find(name) { return this.engine.scene.find(name); }

  /**
   * Создать объект из данных или префаба (имя) и добавить в сцену (или к parent).
   * @param {string | Record<string, any>} data
   * @param {{parent?: GameObject, position?: number[], name?: string}} [o]
   * @returns {Promise<GameObject>}
   */
  spawn(data, o = {}) {
    /** @type {Record<string, any>} */
    const od = typeof data === "string" ? { prefab: data } : { ...data };
    if (o.position) od.position = o.position;
    if (o.name) od.name = o.name;
    return this.engine.instantiate(od, o.parent);
  }

  /** Удалить объект сцены (по умолчанию — свой). @param {GameObject} [go] */
  destroyObject(go = this.gameObject) { go.destroy(); }

  /** Сообщение в консоль с именем объекта. @param {...any} args */
  log(...args) { console.log(`[${this.gameObject?.name} · ${this.type}]`, ...args); }
  /** @param {...any} args */
  warn(...args) { console.warn(`[${this.gameObject?.name} · ${this.type}]`, ...args); }

  /** Данные компонента для файла сцены: только отличия от значений по умолчанию; ссылки — именами. */
  toJSON() {
    const C = /** @type {typeof Component} */ (this.constructor);
    /** @type {Record<string, any>} */
    const out = { type: C.type };
    if (this.key !== undefined) out.id = this.key;
    for (const [k, spec] of Object.entries(C.props)) {
      let v = this.props[k];
      if (spec.type === "ref" || spec.type === "component") v = refName(v, this._refNames[k]);
      if (!sameValue(v, spec.default)) out[k] = v;
    }
    return out;
  }
}

/** @param {any} v @param {string | null | undefined} fallback */
function refName(v, fallback) {
  if (v == null) return fallback ?? null;
  if (typeof v === "string") return v;
  if (v.gameObject && v.type) return `${v.gameObject.name}#${v.type}`;      // компонент
  if (typeof v.name === "string") return v.name;                           // объект
  return fallback ?? null;
}

/** @param {any} a @param {any} b */
function sameValue(a, b) {
  if (a === b) return true;
  if (a && typeof a === "object" && (a.gameObject || a.object3D)) return false;  // ссылки сравниваются по тождеству
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
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
    else if (spec.type === "boolean") v = v === null ? null : !!v;
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
