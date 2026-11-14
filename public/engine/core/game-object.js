// Объект сцены (GameObject, как в Unity): имя, трансформ, компоненты, дочерние объекты.
//
// Трансформ — это THREE.Object3D (object3D): position, rotation, scale и иерархия родитель–потомки.
// Компоненты внешнего вида (Model, Primitive, Sprite…) кладут свои меши внутрь object3D,
// поэтому двигаешь объект — двигается всё, что к нему прикреплено, вместе с детьми.
//
//   const lamp = new GameObject("Фонарь");
//   lamp.setPosition(-3.5, 1.1, -14);
//   lamp.addComponent("Model", { model: "lamp-post" });
//   lamp.addComponent("Light", { range: 11, offset: [0.9, 5.7, 0] });
//   engine.scene.add(lamp);
// @ts-check
import * as THREE from "three";
import { Component, getComponentClass } from "./component.js";
import { Emitter } from "./events.js";

const DEG = Math.PI / 180;

export class GameObject {
  /** @param {string} [name] */
  constructor(name = "Объект") {
    this.name = name;
    /** @type {string[]} */
    this.tags = [];
    /** Трансформ: положение, поворот, масштаб, родитель (THREE.Object3D) */
    this.object3D = new THREE.Group();
    this.object3D.name = name;
    this.object3D.userData.gameObject = this;
    /** @type {Component[]} */
    this.components = [];
    /** @type {GameObject[]} */
    this.children = [];
    /** @type {GameObject | null} */
    this.parent = null;
    /** @type {import("./engine.js").Engine | null} */
    this.engine = null;
    /** Объект не двигается после загрузки — движок может склеить его меши с похожими (быстрее) */
    this.static = true;
    this.active = true;
    /** Данные, из которых объект создан (для инспектора и сохранения) */
    this.source = null;
    this.awoken = false;
    this.started = false;
    this.destroyed = false;
    /** @type {Emitter | null} */
    this._events = null;
  }

  // ---------- события ----------

  /**
   * Подписаться на событие объекта. Возвращает отписку.
   * @param {string} name @param {(data: any, source: GameObject) => void} fn
   */
  on(name, fn) { return (this._events ||= new Emitter()).on(name, fn); }

  /** @param {string} name @param {(data: any, source: GameObject) => void} fn */
  off(name, fn) { this._events?.off(name, fn); }

  /**
   * Событие объекта. bubble — то же событие получают родители (вплоть до корня сцены).
   * @param {string} name @param {any} [data] @param {{bubble?: boolean}} [o]
   */
  emit(name, data, { bubble = false } = {}) {
    /** @type {GameObject | null} */
    let o = this;
    while (o) {
      o._events?.emit(name, data, this);
      if (!bubble) break;
      o = o.parent;
    }
  }

  /**
   * Вызвать метод у всех компонентов объекта, у которых он есть (как SendMessage в Unity).
   * Возвращает число вызванных.
   * @param {string} method @param {...any} args
   */
  send(method, ...args) {
    let n = 0;
    for (const c of [...this.components]) {
      const f = /** @type {any} */ (c)[method];
      if (typeof f === "function") { n++; f.apply(c, args); }
    }
    return n;
  }

  // ---------- трансформ ----------
  get position() { return this.object3D.position; }
  get rotation() { return this.object3D.rotation; }
  get scale() { return this.object3D.scale; }

  /** @param {number} x @param {number} y @param {number} z */
  setPosition(x, y, z) { this.object3D.position.set(x, y, z); this.#moved(); return this; }
  /** Поворот в градусах (порядок YXZ: сначала вокруг вертикали). @param {number} x @param {number} y @param {number} z */
  setRotation(x, y, z) { this.object3D.rotation.set(x * DEG, y * DEG, z * DEG, "YXZ"); this.#moved(); return this; }
  /** @param {number} x @param {number} [y] @param {number} [z] */
  setScale(x, y = x, z = x) { this.object3D.scale.set(x, y, z); this.#moved(); return this; }
  /** Поворот в градусах [x, y, z] */
  get rotationDeg() { const r = this.object3D.rotation; return [r.x / DEG, r.y / DEG, r.z / DEG]; }

  /** Объект сдвинули из кода: обновить матрицы и перерисовать. */
  #moved() {
    this.object3D.updateMatrixWorld(true);
    this.engine?.invalidate("scene", "shadow");
    this.engine?.scene.markDirty(this);
  }

  /** Сообщить движку, что объект подвинули напрямую через object3D. */
  moved() { this.#moved(); }

  /** Мировая точка из локальной (с учётом всех родителей). @param {number[]} p */
  toWorld(p) {
    return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.object3D.matrixWorld).toArray();
  }

  // ---------- компоненты ----------

  /**
   * Добавить компонент по имени типа или классу.
   * @template {Component} T
   * @param {string | (new (go: GameObject, props?: any) => T)} type
   * @param {Record<string, any>} [props]
   * @returns {T}
   */
  addComponent(type, props = {}) {
    const C = typeof type === "string" ? getComponentClass(type) : type;
    if (!C) throw new Error(`Нет компонента «${type}». Зарегистрируйте его: registerComponent(Класс)`);
    const comp = /** @type {T} */ (new C(this, props));
    this.components.push(comp);
    // объект уже в живой сцене — сразу запускаем
    if (this.awoken) { comp.awake(); if (this.started) comp._start(); }
    return comp;
  }

  /**
   * Первый компонент типа (по имени или классу).
   * @template {Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T | undefined}
   */
  getComponent(type) {
    return /** @type {T | undefined} */ (this.components.find(c => isType(c, type)));
  }

  /**
   * Все компоненты типа.
   * @template {Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T[]}
   */
  getComponents(type) {
    return /** @type {T[]} */ (this.components.filter(c => isType(c, type)));
  }

  /**
   * Компонент на этом объекте или ближайшем родителе.
   * @template {Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T | undefined}
   */
  getComponentInParent(type) {
    /** @type {GameObject | null} */
    let o = this;
    while (o) {
      const c = o.getComponent(type);
      if (c) return c;
      o = o.parent;
    }
    return undefined;
  }

  /**
   * Компонент на этом объекте или в потомках (обход в глубину).
   * @template {Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T | undefined}
   */
  getComponentInChildren(type) {
    const own = this.getComponent(type);
    if (own) return own;
    for (const ch of this.children) {
      const c = ch.getComponentInChildren(type);
      if (c) return c;
    }
    return undefined;
  }

  /**
   * Все компоненты типа на этом объекте и в потомках.
   * @template {Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T[]}
   */
  getComponentsInChildren(type) {
    /** @type {T[]} */
    const out = [];
    this.traverse(o => out.push(...o.getComponents(type)));
    return out;
  }

  /** @param {Component} comp */
  removeComponent(comp) {
    const i = this.components.indexOf(comp);
    if (i < 0) return;
    comp._destroy();
    this.components.splice(i, 1);
    this.engine?.invalidate("scene", "shadow");
  }

  // ---------- иерархия ----------

  /** @param {GameObject} child */
  add(child) {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    this.object3D.add(child.object3D);
    if (this.engine) child.attach(this.engine);
    return child;
  }

  /** @param {GameObject} child */
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    this.object3D.remove(child.object3D);
    child.parent = null;
  }

  /** Подключить к движку (вызывается сценой). @param {import("./engine.js").Engine} engine */
  attach(engine) {
    this.engine = engine;
    for (const c of this.children) c.attach(engine);
    if (engine.scene.started && !this.awoken) { this.awake(); this.start(); }
  }

  awake() {
    if (this.awoken) return;
    this.awoken = true;
    for (const c of [...this.components]) c.awake();
    for (const ch of this.children) ch.awake();
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const c of [...this.components]) c._start();
    for (const ch of [...this.children]) ch.start();
    if (!this.active) for (const c of this.components) c.onDisable();
  }

  /** Включён ли объект с учётом родителей */
  get activeInHierarchy() {
    /** @type {GameObject | null} */
    let o = this;
    while (o) { if (!o.active) return false; o = o.parent; }
    return true;
  }

  /** Включить/выключить объект: выключенный не виден и его компоненты не работают. @param {boolean} on */
  setActive(on) {
    on = !!on;
    if (this.active === on) return;
    const parentActive = !this.parent || this.parent.activeInHierarchy;
    this.active = on;
    this.object3D.visible = on;
    // onEnable/onDisable и сон update — у всех компонентов, чья активность в иерархии поменялась
    if (parentActive && this.started) this.#activeChanged(on);
    // неподвижные меши склеены в общие instanced-меши: без пересборки выключенный объект остался бы
    // в кадре (и в карте теней), а включённый рисовался бы поштучно
    let hasStatic = false;
    this.traverse(o => { if (o.static) hasStatic = true; });
    if (hasStatic) this.engine?.scene?.markDirty();
    this.engine?.invalidate("scene", "shadow");
  }

  /** @param {boolean} on */
  #activeChanged(on) {
    for (const c of [...this.components]) if (c.enabled && c.started) c._activeChanged(on);
    for (const ch of this.children) if (ch.active) ch.#activeChanged(on);
  }

  /** Удалить объект со всеми детьми и компонентами. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const ch of [...this.children]) ch.destroy();
    for (const c of this.components) c._destroy();
    this.components = [];
    this._events?.emit("destroyed", null, this);
    this._events = null;
    this.parent?.removeChild(this);
    this.object3D.removeFromParent();
    this.engine?.invalidate("scene", "shadow");
  }

  /** Поиск потомка по имени (или пути "Двор/Фонарь 3"). @param {string} name @returns {GameObject | null} */
  find(name) {
    if (name.includes("/")) {
      /** @type {GameObject | null} */
      let o = this;
      for (const part of name.split("/")) { o = o?.children.find(c => c.name === part) ?? null; }
      return o;
    }
    for (const c of this.children) {
      if (c.name === name) return c;
      const deep = c.find(name);
      if (deep) return deep;
    }
    return null;
  }

  /** Обход объекта и всех потомков. @param {(o: GameObject) => void} fn */
  traverse(fn) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }

  /** Данные объекта для файла сцены. @returns {Record<string, any>} */
  toJSON() {
    const p = this.object3D.position, s = this.object3D.scale;
    const r = this.rotationDeg.map(v => Math.round(v * 1000) / 1000);
    const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
    /** @type {Record<string, any>} */
    const out = { name: this.name };
    if (this.tags.length) out.tags = this.tags;
    if (!this.active) out.active = false;
    if (!this.static) out.static = false;
    out.position = [round(p.x), round(p.y), round(p.z)];
    if (r.some(v => v)) out.rotation = r;
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) out.scale = s.x === s.y && s.y === s.z ? round(s.x) : [round(s.x), round(s.y), round(s.z)];
    if (this.components.length) out.components = this.components.map(c => c.toJSON());
    if (this.children.length) out.children = this.children.map(c => c.toJSON());
    return out;
  }
}

/** @param {Component} c @param {string | Function} type */
function isType(c, type) {
  return typeof type === "string" ? c.type === type : c instanceof /** @type {any} */ (type);
}
