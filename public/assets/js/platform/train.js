// Поезд: объект сцены, собранный из вагонов-объектов с компонентом Model. Какие вагоны — решает
// каталог (assets/data/trains.jsonc), как вагон выглядит — его модель (assets/models/trains/…),
// а размеры и огни — данные модели (meta):
//   length, gap        — длина кузова и промежуток до соседа, м
//   gangway            — { half, y: [низ, верх] }: переход-гармошка к соседу с таким же полем
//   tailLights         — [[x, y], ...] хвостовые огни у торца z = 0 (если вагон последний)
//   headLights         — [[x, y, z], ...] фары (если вагон головной)
//   windowSpill        — [[z0, z1], ...] окна, свет из которых ночью ложится на платформу
//   cab                — у вагона кабина: у хвоста не ставится заглушка перехода
// Маршрутная табличка подставляется в меши-слоты "plate" моделей.
//
// Положение: хвост s (z мира) и направление heading (+1 — голова к большим z, к камере;
// −1 — голова к горизонту). Локальные оси поезда: z = 0 — хвост, z = length — голова.
// @ts-nocheck
import * as THREE from "three";
import { GameObject } from "../../../engine/index.js";
import { Plate } from "./plate.js";

const SPILL_FRAGMENT = /* glsl */`
  uniform float uLamps;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float a = max(0.0, 1.0 - dot(p, p));
    gl_FragColor = vec4(uColor * a * a * uLamps, 0.0);
  }
`;

let spillMaterial = null;
function spill(engine) {
  return spillMaterial ||= new THREE.ShaderMaterial({
    uniforms: { uLamps: engine.light.uLamps, uColor: { value: new THREE.Vector3(.27, .21, .13) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: SPILL_FRAGMENT,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

export class Train {
  /**
   * Собрать поезд: дождаться описаний моделей (нужны размеры), создать вагоны.
   * @param {import("../../../engine/index.js").Engine} engine
   * @param {import("./catalog.js").TrainCatalog} catalog
   * @param {string} typeId
   * @param {{seed?: number}} [opts]
   */
  static async create(engine, catalog, typeId, { seed = 1 } = {}) {
    const list = catalog.consist(typeId, seed);
    const defs = await Promise.all(list.map(c => engine.assets.definition(c.model).catch(e => { console.error(e.message); return null; })));
    return new Train(engine, typeId, list.map((c, i) => ({ ...c, def: defs[i], meta: defs[i] ? engine.assets.meta(defs[i]) : null })).filter(c => c.def));
  }

  constructor(engine, typeId, cars) {
    this.engine = engine;
    this.typeId = typeId;
    this.plate = new Plate();
    this.go = new GameObject(`Поезд (${typeId})`);
    this.go.static = false;
    this.cars = [];
    let z = 0, lastGap = 0;
    cars.forEach((c, i) => {
      const m = c.meta, L = m.length ?? 20;
      const car = new GameObject(`${i + 1}. ${c.def.name || c.model}`);
      car.static = false;
      car.object3D.position.z = z;
      // развёрнутый вагон: поворот на 180° и сдвиг на длину — его торец z = 0 оказывается впереди
      const model = car.addComponent("Model", { model: c.model, ...(c.flip ? { rotation: [0, 180, 0], offset: [0, 0, L] } : {}) });
      this.go.add(car);
      const prev = this.cars.at(-1);
      if (prev && prev.meta.gangway && m.gangway) this.#gangway(m.gangway, prev.z1, z);
      this.cars.push({ ...c, go: car, model, z0: z, z1: z + L });
      lastGap = m.gap ?? .64;
      z += L + lastGap;
    });
    this.length = z - lastGap;
    this.#lights();
    this.track = null;
    this.heading = 1;
    this.s = 0;
    this.spill = null;
    // табличка — во все слоты "plate", как только модели вагонов готовы
    for (const c of this.cars) c.model.ready?.then(() => this.#plates(c));
  }

  /** Переход-гармошка между вагонами (примитив с узором складок). */
  #gangway(gw, z0, z1) {
    const go = new GameObject("Переход");
    go.static = false;
    go.object3D.position.set(0, 0, (z0 + z1) / 2);
    const len = z1 - z0 + .1;
    go.addComponent("Primitive", {
      size: [gw.half * 2, gw.y[1] - gw.y[0], len], offset: [0, (gw.y[0] + gw.y[1]) / 2, 0], color: "bellows",
      material: { pattern: { type: "stripes", step: .07 / len, width: .025 / len, strength: .55, color: "fold" } },
    });
    this.go.add(go);
  }

  /** Хвостовые огни и заглушка перехода у хвоста, фары у головы. */
  #lights() {
    const rear = this.cars[0], head = this.cars.at(-1);
    if (rear) {
      // огни и заглушка — у хвоста поезда (z = 0 вагона-объекта), как бы ни был развёрнут вагон
      const m = rear.meta;
      for (const [x, y] of m.tailLights || []) {
        rear.go.addComponent("Glow", { offset: [x, y, -.06], radius: .28, color: [1, .18, .1], intensity: .6, night: false });
        rear.go.addComponent("Glow", { offset: [x, y, -.06], radius: .9, color: [1, .2, .12], intensity: .55, night: true });
      }
      if (m.gangway && !m.cab && !m.headLights) {
        rear.go.addComponent("Primitive", { size: [m.gangway.half * 2, m.gangway.y[1] - m.gangway.y[0], .22],
          offset: [0, (m.gangway.y[0] + m.gangway.y[1]) / 2, -.11], color: "bellows" });
      }
    }
    if (head && head.meta.headLights && !head.flip) {
      for (const [x, y, z] of head.meta.headLights) {
        const near = y < 3;
        head.go.addComponent("Glow", { offset: [x, y, z], radius: near ? .45 : .4, color: [1, .97, .9], intensity: .5, night: false });
        head.go.addComponent("Glow", { offset: [x, y, z], radius: near ? 1.1 : .9, color: [1, .95, .84], intensity: .55, night: true });
      }
    }
  }

  #plates(car) {
    const mat = this.engine.materials.toon({ map: this.plate.texture, receive: false, litNight: [.95, .88, .72] });
    for (const mesh of car.model.slots("plate")) mesh.material = mat;
    this.engine.invalidate("scene");
  }

  setPlate(train) {
    this.plate.set(train);
    this.engine.invalidate("scene");
  }

  /** Поставить поезд на путь: s — z хвоста, heading — ±1. */
  place(track, s, heading = 1) {
    if (track !== this.track || heading !== this.heading) {
      this.track = track;
      this.heading = heading;
      this.#buildSpill();
    }
    this.s = s;
    this.go.object3D.position.set(track.x, track.y, s);
    this.go.object3D.rotation.y = heading > 0 ? 0 : Math.PI;
    this.go.moved();
  }

  /** Ночью свет из окон ложится на платформу у пути — мягкими пятнами. */
  #buildSpill() {
    if (this.spill) { this.spill.geometry.dispose(); this.spill.removeFromParent(); this.spill = null; }
    const pf = this.track?.platform;
    if (!pf) return;
    const side = this.heading > 0 ? 1 : -1;
    const edgeLocal = (pf.edge - this.track.x) * side;
    const ps = Math.sign(edgeLocal), x0 = edgeLocal + ps * 1.5;
    const pos = [], uv = [];
    for (const c of this.cars) {
      for (const [a, b] of c.meta.windowSpill || []) {
        // окна заданы для борта −x; у вагонов-примитивов борта одинаковые, у развёрнутого — зеркально по длине
        const za = c.flip ? c.z1 - b : c.z0 + a, zb = c.flip ? c.z1 - a : c.z0 + b;
        const g = new THREE.PlaneGeometry(Math.abs(edgeLocal - x0), zb - za + .9).toNonIndexed();
        g.rotateX(-Math.PI / 2);
        g.translate((edgeLocal + x0) / 2, pf.top + .015, (za + zb) / 2);
        pos.push(...g.attributes.position.array);
        uv.push(...g.attributes.uv.array);
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    this.spill = new THREE.Mesh(geo, spill(this.engine));
    this.spill.renderOrder = 4;
    this.spill.frustumCulled = false;
    this.spill.userData.noBatch = true;
    this.go.object3D.add(this.spill);
  }

  dispose() {
    this.go.destroy();
    this.plate.dispose();
    this.spill?.geometry.dispose();
  }
}
