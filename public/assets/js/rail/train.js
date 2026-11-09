// Поезд как объект сцены — компонент Train. Строит дочерние объекты-вагоны: какие вагоны — решает каталог
// (assets/data/trains.jsonc) или список прямо в данных, как вагон выглядит — его модель (assets/models/trains/…)
// или префаб вагона (assets/prefabs/cars/<имя>.jsonc, если в составе указан "cars/<имя>").
// Размеры и огни — данные модели (meta):
//   length, gap        — длина кузова и промежуток до соседа, м
//   gangway            — { half, y: [низ, верх] }: переход-гармошка к соседу с таким же полем
//   tailLights         — [[x, y], ...] хвостовые огни у торца z = 0
//   headLights         — [[x, y, z], ...] фары
//   windowSpill        — [[z0, z1], ...] окна, свет из которых ночью ложится на платформу (TrainLights → GroundGlow)
//   cab                — у вагона кабина: у хвоста не ставится заглушка перехода
// Огни — обычные компоненты Glow на вагонах с метками "head-…" и "tail-…"; какие горят, решает TrainLights.
//
//   { "name": "Поезд", "prefab": "train", "position": [4.42, 0, -7.2],
//     "components": [{ "type": "Train", "consist": "emu-fast", "number": "6601" }] }
//   await this.spawn({ prefab: "train", components: [{ type: "Train", consist: "freight", seed: 7 }] });
//
// Локальные оси поезда: z = 0 — хвост, z = length — голова; без TrainMotion вагоны стоят по прямой вдоль +z.
// @ts-check
import { Component } from "../../../engine/index.js";
import { TrainCatalog } from "./catalog.js";

/**
 * @typedef {object} Car  вагон или переход (отрезок поезда)
 * @property {import("../../../engine/index.js").GameObject} go
 * @property {"car" | "gangway"} kind
 * @property {number} z0      начало по длине поезда (от хвоста), м
 * @property {number} z1      конец, м
 * @property {number} anchor  где начало координат объекта по длине поезда
 * @property {Record<string, any>} meta
 * @property {boolean} flip
 * @property {any} [model]    компонент Model вагона
 * @property {string} [name]
 */

export class Train extends Component {
  static type = "Train";
  static category = "Железная дорога";
  static doc = "Поезд: строит вагоны-объекты по составу (каталог trains.jsonc или список). Огни — Glow с метками head-/tail-, движение — TrainMotion.";
  /** Каталог составов — задаёт приложение (TrainCatalog.load). Без него consist — только списком. @type {TrainCatalog} */
  static catalog = new TrainCatalog();
  /**
   * Маршрутная табличка (задаёт приложение): класс с { texture, set(info), dispose() }. Без неё таблички нет.
   * @type {(new () => {texture: any, set: (info: any) => void, dispose: () => void}) | null}
   */
  static Plate = null;
  static props = {
    consist: { type: "object", default: "fpk-long", doc: "Состав: имя из каталога (\"emu-fast\") или список вагонов от головы к хвосту" },
    number: { type: "string", default: "", doc: "Номер поезда" },
    info: { type: "object", default: null, doc: "Данные для таблички: { number, from, to, … }" },
    seed: { type: "number", default: 1, doc: "Зерно случайной смеси вагонов (грузовой)" },
  };

  /** @type {Car[]} вагоны и переходы от хвоста к голове */
  parts = [];
  /** @type {Car[]} только вагоны, от хвоста к голове */
  cars = [];
  length = 0;
  built = false;
  /** @type {{texture: any, set: (info: any) => void, dispose: () => void} | null} */
  plate = null;
  /** Промис: вагоны построены (размеры известны). @type {Promise<Train>} */
  ready = Promise.resolve(this);

  awake() {
    this.plate = Train.Plate ? new Train.Plate() : null;
    if (this.props.info) this.plate?.set(this.props.info);
    /** Промис: вагоны построены (размеры известны). @type {Promise<Train>} */
    this.ready = this.#build().catch(error => { console.error(`Поезд «${this.gameObject.name}»:`, error); return this; });
  }

  onChange(keys) {
    if (keys.includes("info")) this.setInfo(this.props.info);
    if (keys.includes("consist") || keys.includes("seed")) this.rebuild();
  }

  onDestroy() {
    this.plate?.dispose();
  }

  /** Головной вагон (объект). */
  get head() { return this.cars[this.cars.length - 1]?.go ?? null; }
  /** Хвостовой вагон (объект). */
  get tail() { return this.cars[0]?.go ?? null; }

  /** Маршрутная табличка и данные поезда. @param {any} info */
  setInfo(info) {
    this.props.info = info;
    this.plate?.set(info);
    this.invalidate("scene");
  }

  /** Пересобрать вагоны (сменился состав). */
  rebuild() {
    for (const p of this.parts) p.go.destroy();
    this.parts = [];
    this.cars = [];
    this.built = false;
    this.ready = this.#build();
    return this.ready;
  }

  async #build() {
    const E = this.engine, A = E.assets;
    const list = Train.catalog.consist(this.props.consist, this.props.seed);
    // описания моделей нужны заранее — по ним размеры вагонов
    /** @type {({model: string, flip: boolean, prefab?: string, def: any, meta: Record<string, any>} | null)[]} */
    const cars = await Promise.all(list.map(async c => {
      try {
        if (c.model.startsWith("cars/")) {
          const prefab = await A.prefab(c.model);
          const model = (prefab.components || []).find((/** @type {any} */ x) => x.type === "Model");
          const def = model?.model ? await A.definition(model.model) : null;
          return { ...c, prefab: c.model, def, meta: def ? A.meta(def, model.params || {}) : (prefab.meta || {}) };
        }
        const def = await A.definition(c.model);
        return { ...c, def, meta: A.meta(def) };
      } catch (error) {
        A.report(`car:${c.model}`, `Вагон «${c.model}»: ${error.message}`);
        return null;
      }
    }));
    if (this.destroyed) return this;
    /** @type {Record<string, any>[]} */
    const objects = [];
    /** @type {Omit<Car, "go">[]} */
    const layout = [];
    let z = 0, lastGap = 0;
    /** @type {any} */
    let prev = null;
    cars.forEach((c, i) => {
      if (!c) return;
      const m = c.meta, L = m.length ?? 20;
      if (prev && prev.meta.gangway && m.gangway) {
        const gw = m.gangway, z0 = prev.z1, z1 = z, len = z1 - z0 + .1;
        objects.push({ name: "Переход", static: false, components: [{ type: "Primitive", id: "gangway",
          size: [gw.half * 2, gw.y[1] - gw.y[0], len], offset: [0, (gw.y[0] + gw.y[1]) / 2, 0], color: "bellows",
          material: { pattern: { type: "stripes", step: .07 / len, width: .025 / len, strength: .55, color: "fold" } } }] });
        layout.push({ kind: "gangway", z0, z1, anchor: (z0 + z1) / 2, meta: {}, flip: false });
      }
      /** @type {Record<string, any>} */
      const od = c.prefab ? { prefab: c.prefab } : {
        // развёрнутый вагон: поворот на 180° и сдвиг на длину — его торец z = 0 оказывается впереди
        components: [{ type: "Model", model: c.model, ...(c.flip ? { rotation: [0, 180, 0], offset: [0, 0, L] } : {}) }],
      };
      od.name = `${i + 1}. ${c.def?.name || c.model}`;
      od.static = false;
      od.components = [...(od.components || []), ...lights(m, c.flip)];
      objects.push(od);
      layout.push({ kind: "car", z0: z, z1: z + L, anchor: z, meta: m, flip: c.flip, name: c.model });
      prev = { meta: m, z1: z + L };
      lastGap = m.gap ?? .64;
      z += L + lastGap;
    });
    this.length = Math.max(0, z - lastGap);
    // все вагоны — одним вызовом: префабы, скрипты и модели грузятся заранее
    const list2 = await E.scene.resolve(objects);
    await E.scene.preload(list2);
    if (this.destroyed) return this;
    const gos = list2.map(od => E.scene.instantiate(od));
    gos.forEach((go, i) => {
      const part = /** @type {Car} */ ({ ...layout[i], go });
      go.object3D.position.set(0, 0, part.anchor);
      this.gameObject.add(go);
      this.parts.push(part);
      if (part.kind === "car") {
        part.model = go.getComponent("Model");
        this.cars.push(part);
        part.model?.ready?.then(() => this.#plates(part));
      }
    });
    this.gameObject.moved();
    this.built = true;
    this.gameObject.emit("built", this);
    return this;
  }

  /** Табличка — во все слоты "plate" модели вагона. @param {Car} car */
  #plates(car) {
    if (!this.plate || !car.model) return;
    const mat = this.engine.materials.toon({ map: this.plate.texture, receive: false, litNight: [.95, .88, .72] });
    for (const mesh of car.model.slots("plate")) mesh.material = mat;
    this.invalidate("scene");
  }
}

/**
 * Огни вагона из его meta: хвостовые у торца z = 0 и заглушка перехода (метки "tail-…"), фары (метки "head-…").
 * Какие из них горят — решает TrainLights (у хвостового и головного вагона по ходу).
 * @param {Record<string, any>} m @param {boolean} flip
 */
function lights(m, flip) {
  const out = [];
  let i = 0;
  for (const [x, y] of m.tailLights || []) {
    out.push({ type: "Glow", id: `tail-${i++}`, offset: [x, y, -.06], radius: .28, color: [1, .18, .1], intensity: .6, night: false });
    out.push({ type: "Glow", id: `tail-${i++}`, offset: [x, y, -.06], radius: .9, color: [1, .2, .12], intensity: .55, night: true });
  }
  if (m.gangway && !m.cab && !m.headLights) {
    out.push({ type: "Primitive", id: "tail-cap", size: [m.gangway.half * 2, m.gangway.y[1] - m.gangway.y[0], .22],
      offset: [0, (m.gangway.y[0] + m.gangway.y[1]) / 2, -.11], color: "bellows" });
  }
  i = 0;
  if (!flip) {
    for (const [x, y, z] of m.headLights || []) {
      const near = y < 3;
      out.push({ type: "Glow", id: `head-${i++}`, offset: [x, y, z], radius: near ? .45 : .4, color: [1, .97, .9], intensity: .5, night: false });
      out.push({ type: "Glow", id: `head-${i++}`, offset: [x, y, z], radius: near ? 1.1 : .9, color: [1, .95, .84], intensity: .55, night: true });
    }
  }
  return out;
}
