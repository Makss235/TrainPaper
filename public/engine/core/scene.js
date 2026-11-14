// Сцена: дерево объектов, загрузка из данных (JSONC-файл или объект), префабы, повторы,
// поиск объектов, сохранение обратно в данные. Неподвижные одинаковые меши (одна геометрия и
// один материал) после загрузки склеиваются в instanced-меши — сотни фонарей и опор рисуются
// за несколько вызовов отрисовки.
//
// Формат данных объекта:
//   {
//     "name": "Фонарь",                 // имя (для поиска и инспектора)
//     "prefab": "lamp",                 // необязательно: взять за основу префаб assets/prefabs/lamp.jsonc
//     "position": [x, y, z],            // метры
//     "rotation": [x, y, z],            // градусы, порядок YXZ
//     "scale": 1 | [x, y, z],
//     "tags": ["ground"], "active": true, "static": true,
//     "components": [{ "type": "Model", "model": "lamp-post" }],
//     "children": [ …такие же объекты… ],
//     "repeat": { "count": 14, "step": [0, 0, -24] }   // копии со сдвигом (см. expandRepeat)
//   }
// @ts-check
import * as THREE from "three";
import { getComponentClass } from "./component.js";
import { isPlainObject, loadData } from "./data.js";
import { GameObject } from "./game-object.js";
import { applyPrefab, expandRepeat } from "./prefab.js";

export { applyPrefab, expandRepeat };

const DEG = Math.PI / 180;

export class Scene {
  /** @param {import("./engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.root = new GameObject("Сцена");
    this.root.engine = engine;
    this.root.static = false;
    /** Данные, из которых загружена сцена */
    this.data = null;
    /** Настройки окружения сцены (environment из данных) */
    /** @type {Record<string, any>} */
    this.settings = {};
    this.started = false;
    /** Идёт clear(): объекты удаляются все разом (системам не нужно искать замену каждому) */
    this.clearing = false;
    /** Номер загрузки: если, пока сцена готовилась, попросили другую — первая не применяется */
    this.loadId = 0;
    this.batches = new THREE.Group();
    this.batches.name = "batches";
    this.root.object3D.add(this.batches);
    /** Неподвижные объекты менялись — склейку надо пересобрать перед кадром */
    this.batchDirty = false;
  }

  get object3D() { return this.root.object3D; }

  /**
   * Загрузить сцену из адреса JSONC или объекта данных. Старое содержимое удаляется.
   * Всё, что нужно новой сцене (префабы, модели, скрипты), загружается ДО удаления старой: прежняя сцена
   * остаётся на экране, пока новая готовится, и кадра «небо без сцены» не бывает. Если за это время
   * попросили загрузить другую сцену, эта загрузка отменяется (применяется только последняя).
   * @param {string | Record<string, any>} source
   * @returns {Promise<boolean>} true — сцена загружена; false — её опередила более новая загрузка
   */
  async load(source) {
    const id = ++this.loadId;
    const data = typeof source === "string" ? await loadData(source) : source;
    await this.engine.assets.ready();
    const objects = await this.resolve(data.objects || []);
    await this.preload(objects);
    if (id !== this.loadId) return false;
    this.clear();
    this.data = data;
    this.settings = data.environment || {};
    const created = objects.map(od => this.root.add(this.instantiate(od)));
    // корень сцены живёт между загрузками (он уже «проснулся»), поэтому будим сами объекты:
    // сначала awake() у всех, потом start() у всех — в start() уже можно искать соседей
    this.started = true;
    for (const go of created) go.awake();
    for (const go of created) go.start();
    this.engine.events.emit("sceneLoaded", this);
    this.rebatch();
    return true;
  }

  /** Удалить все объекты. */
  clear() {
    this.loadId++;                                      // загрузка, которая ещё готовится, уже не нужна
    this.clearing = true;
    try {
      for (const c of [...this.root.children]) c.destroy();
    } finally {
      this.clearing = false;
    }
    this.#unbatch();
    this.started = false;
  }

  /** @param {GameObject} go */
  add(go) {
    this.root.add(go);
    if (go.static) this.markDirty(go);
    return go;
  }

  /** @param {string} name */
  find(name) { return this.root.find(name); }

  /** @param {(o: GameObject) => boolean} test */
  findAll(test) {
    /** @type {GameObject[]} */
    const out = [];
    this.root.traverse(o => { if (o !== this.root && test(o)) out.push(o); });
    return out;
  }

  /** @param {string} tag */
  findByTag(tag) { return this.findAll(o => o.tags.includes(tag)); }

  /**
   * Все компоненты типа (имя или класс) во всей сцене.
   * @template {import("./component.js").Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T[]}
   */
  components(type) {
    return this.root.getComponentsInChildren(type);
  }

  /**
   * Первый компонент типа во всей сцене.
   * @template {import("./component.js").Component} T
   * @param {string | (new (...a: any[]) => T)} type
   * @returns {T | undefined}
   */
  findComponent(type) {
    return this.root.getComponentInChildren(type);
  }

  /** Сцена как данные (для сохранения из инспектора). */
  toJSON() {
    return { ...(this.data || {}), environment: this.settings, objects: this.root.children.map(c => c.toJSON()) };
  }

  // ---------- данные → объекты ----------

  /**
   * Развернуть префабы и повторы в плоские данные объектов (рекурсивно, с дочерними).
   * @param {any[]} list
   * @returns {Promise<Record<string, any>[]>}
   */
  async resolve(list) {
    /** @type {Record<string, any>[]} */
    const out = [];
    for (const raw of list) {
      if (!isPlainObject(raw)) continue;
      let od = raw;
      if (od.prefab) {
        // нет префаба — объект остаётся (с тем, что указано в сцене), остальная сцена грузится
        const prefab = await this.engine.assets.prefab(od.prefab).catch(error => { this.engine.assets.report(`prefab:${od.prefab}`, error.message); return {}; });
        od = applyPrefab(prefab, od);
      }
      if (od.children) od = { ...od, children: await this.resolve(od.children) };
      out.push(...expandRepeat(od));
    }
    return out;
  }

  /**
   * Загрузить заранее всё, что нужно объектам: скрипты (неизвестные type), модели (Model.preload) и т. п.
   * @param {Record<string, any>[]} objects
   */
  async preload(objects) {
    await this.engine.assets.preloadScripts(objects);
    /** @type {Promise<any>[]} */
    const tasks = [];
    const walk = (/** @type {Record<string, any>} */ od) => {
      for (const cd of od.components || []) {
        const C = getComponentClass(cd.type);
        // @ts-ignore — необязательный статический метод компонента
        if (C?.preload) tasks.push(Promise.resolve(C.preload(cd, this.engine)).catch(() => {}));      // об ошибке сообщит сам компонент
      }
      for (const ch of od.children || []) walk(ch);
    };
    objects.forEach(walk);
    await Promise.all(tasks);
  }

  /**
   * Создать объект из уже развёрнутых данных (префабы и повторы — через resolve()).
   * @param {Record<string, any>} od
   * @returns {GameObject}
   */
  instantiate(od) {
    const go = new GameObject(od.name || "Объект");
    go.source = od;
    go.engine = this.engine;
    if (od.tags) go.tags = [...od.tags];
    if (od.static === false) go.static = false;
    const [px, py, pz] = od.position || [0, 0, 0];
    go.object3D.position.set(px, py, pz);
    if (od.rotation) go.object3D.rotation.set(od.rotation[0] * DEG, od.rotation[1] * DEG, (od.rotation[2] || 0) * DEG, "YXZ");
    else go.object3D.rotation.order = "YXZ";
    if (od.scale !== undefined) {
      const s = typeof od.scale === "number" ? [od.scale, od.scale, od.scale] : od.scale;
      go.object3D.scale.set(s[0], s[1], s[2]);
    }
    for (const cd of od.components || []) {
      if (cd.remove) continue;
      const { type, id, ...props } = cd;
      // скрипт не загрузился — об этом уже сказано один раз; объект остаётся без компонента
      if (!getComponentClass(type)) {
        this.engine.assets.report(`component:${type}`, `Нет компонента «${type}» (объект «${go.name}»)`);
        continue;
      }
      try {
        const comp = go.addComponent(type, props);
        if (id !== undefined) comp.key = id;
      } catch (error) {
        console.error(`Объект «${go.name}», компонент «${type}»:`, error);
      }
    }
    for (const ch of od.children || []) go.add(this.instantiate(ch));
    if (od.active === false) { go.active = false; go.object3D.visible = false; }
    return go;
  }

  // ---------- склейка неподвижных мешей ----------

  /**
   * Неподвижный объект изменился — склейка пересоберётся перед ближайшим кадром (один раз, сколько бы
   * объектов ни поменялось). @param {GameObject} [go]
   */
  markDirty(go) {
    if (go && !go.static) return;
    if (!this.started) return;
    this.batchDirty = true;
    this.engine.invalidate("scene", "shadow");
  }

  /** Перед кадром (вызывает движок): пересобрать склейку, если неподвижные объекты менялись. */
  flush() {
    if (this.batchDirty) this.#batch();
  }

  #unbatch() {
    for (const m of this.batches.children) /** @type {THREE.InstancedMesh} */ (m).dispose?.();
    this.batches.clear();
    this.object3D.traverse(o => { if (o.userData.batched) { o.visible = true; o.userData.batched = false; } });
  }

  /** Склеить одинаковые неподвижные меши в instanced-меши (и перерисовать сцену). */
  rebatch() {
    this.#batch();
    this.engine.invalidate("scene", "shadow");
  }

  #batch() {
    this.batchDirty = false;
    this.#unbatch();
    if (this.engine.options.batching === false) return;
    this.object3D.updateMatrixWorld(true);
    /** @type {Map<string, THREE.Mesh[]>} */
    const groups = new Map();
    this.root.traverse(go => {
      if (go === this.root || !go.static || !go.activeInHierarchy) return;
      const visit = (/** @type {THREE.Object3D} */ o) => {
        for (const child of o.children) {
          if (child.userData.gameObject) continue;            // это другой объект — у него своя очередь
          const mesh = /** @type {THREE.Mesh} */ (child);
          if (mesh.isMesh && !(/** @type {any} */ (mesh).isInstancedMesh) && mesh.visible && !mesh.userData.noBatch && !Array.isArray(mesh.material)) {
            const key = `${mesh.geometry.uuid}|${/** @type {THREE.Material} */ (mesh.material).uuid}|${mesh.layers.mask}|${mesh.renderOrder}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)?.push(mesh);
          }
          if (child.visible) visit(child);
        }
      };
      visit(go.object3D);
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const first = list[0];
      const inst = new THREE.InstancedMesh(first.geometry, first.material, list.length);
      list.forEach((m, i) => {
        inst.setMatrixAt(i, m.matrixWorld);
        m.visible = false;
        m.userData.batched = true;
      });
      inst.layers.mask = first.layers.mask;
      inst.renderOrder = first.renderOrder;
      inst.computeBoundingSphere();
      inst.userData.noBatch = true;
      this.batches.add(inst);
    }
  }
}
