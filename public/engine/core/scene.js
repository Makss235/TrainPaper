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
//     "tags": ["platform"], "active": true, "static": true,
//     "components": [{ "type": "Model", "model": "lamp-post" }],
//     "children": [ …такие же объекты… ],
//     "repeat": { "count": 14, "step": [0, 0, -24] }   // копии со сдвигом (см. expandRepeat)
//   }
// @ts-check
import * as THREE from "three";
import { getComponentClass } from "./component.js";
import { clone, deepMerge, isPlainObject, loadData, rng } from "./data.js";
import { GameObject } from "./game-object.js";

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
    this.batches = new THREE.Group();
    this.batches.name = "batches";
    this.root.object3D.add(this.batches);
    this.batchTimer = 0;
  }

  get object3D() { return this.root.object3D; }

  /**
   * Загрузить сцену из адреса JSONC или объекта данных. Старое содержимое удаляется.
   * @param {string | Record<string, any>} source
   */
  async load(source) {
    const data = typeof source === "string" ? await loadData(source) : source;
    await this.engine.assets.ready();
    this.clear();
    this.data = data;
    this.settings = data.environment || {};
    // сначала всё, что нужно загрузить заранее: префабы, модели, файлы
    const objects = await this.resolve(data.objects || []);
    await this.#preload(objects);
    for (const od of objects) this.root.add(this.instantiate(od));
    this.started = true;
    this.root.awake();
    this.root.start();
    this.engine.events.emit("sceneLoaded", this);
    this.rebatch();
    return this;
  }

  /** Удалить все объекты. */
  clear() {
    for (const c of [...this.root.children]) c.destroy();
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

  /** Все компоненты типа во всей сцене. @param {string} type */
  components(type) {
    /** @type {import("./component.js").Component[]} */
    const out = [];
    this.root.traverse(o => out.push(...o.getComponents(type)));
    return out;
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

  /** @param {Record<string, any>[]} objects */
  async #preload(objects) {
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

  /** Неподвижный объект изменился — пересобрать склейку (не чаще раза за кадр). @param {GameObject} [go] */
  markDirty(go) {
    if (go && !go.static) return;
    if (!this.started || this.batchTimer) return;
    this.batchTimer = requestAnimationFrame(() => { this.batchTimer = 0; this.rebatch(); });
  }

  #unbatch() {
    for (const m of this.batches.children) /** @type {THREE.InstancedMesh} */ (m).dispose?.();
    this.batches.clear();
    this.object3D.traverse(o => { if (o.userData.batched) { o.visible = true; o.userData.batched = false; } });
  }

  /** Склеить одинаковые неподвижные меши в instanced-меши. */
  rebatch() {
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
    this.engine.invalidate("scene", "shadow");
  }
}

/**
 * Префаб + данные экземпляра: поля экземпляра заменяют поля префаба, компоненты с тем же
 * type (и id, если указан) сливаются по свойствам, новые добавляются, { type, remove: true } — убирает.
 * @param {Record<string, any>} prefab
 * @param {Record<string, any>} inst
 */
export function applyPrefab(prefab, inst) {
  const { prefab: _p, components: instComps, children: instChildren, ...rest } = inst;
  void _p;
  const out = { ...clone(prefab), ...clone(rest) };
  const comps = clone(prefab.components || []);
  for (const c of instComps || []) {
    const i = comps.findIndex((/** @type {any} */ p) => p.type === c.type && (c.id === undefined || p.id === c.id));
    if (i >= 0) comps[i] = c.remove ? { ...comps[i], remove: true } : deepMerge(comps[i], c);
    else comps.push(clone(c));
  }
  out.components = comps;
  out.children = [...clone(prefab.children || []), ...clone(instChildren || [])];
  return out;
}

/**
 * Повтор: { count, step: [dx, dy, dz], rotate: [°], jitter: [x, y, z], scaleJitter, seed, name }
 * → count копий. jitter — случайный сдвиг ±, scaleJitter — случайный масштаб ±доля,
 * name — шаблон имени ("Фонарь {i}"), по умолчанию «Имя 1», «Имя 2»…
 * @param {Record<string, any>} od
 * @returns {Record<string, any>[]}
 */
export function expandRepeat(od) {
  const r = od.repeat;
  if (!r) return [od];
  const { repeat: _r, ...base } = od;
  void _r;
  const random = rng(r.seed ?? 1);
  const out = [];
  const pos = base.position || [0, 0, 0], rot = base.rotation || [0, 0, 0];
  const sc = typeof base.scale === "number" ? [base.scale, base.scale, base.scale] : base.scale || [1, 1, 1];
  for (let i = 0; i < (r.count ?? 1); i++) {
    const j = r.jitter || [0, 0, 0], step = r.step || [0, 0, 0], rotate = r.rotate || [0, 0, 0];
    const k = 1 + (r.scaleJitter || 0) * (random() * 2 - 1);
    const rr = r.randomRotate ? r.randomRotate.map((/** @type {number} */ a) => (random() * 2 - 1) * a) : [0, 0, 0];
    out.push({
      ...clone(base),
      name: (r.name || `${base.name || "Объект"} {i}`).replace("{i}", String(i + 1)),
      position: pos.map((/** @type {number} */ v, /** @type {number} */ a) => v + step[a] * i + (j[a] || 0) * (random() * 2 - 1)),
      rotation: rot.map((/** @type {number} */ v, /** @type {number} */ a) => v + rotate[a] * i + rr[a]),
      scale: sc.map((/** @type {number} */ v) => v * k),
    });
  }
  return out;
}
