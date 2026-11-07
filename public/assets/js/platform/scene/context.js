// Контекст сборки сцены — то, с чем работает каждый префаб (prefabs/*.js).
//
// Префаб — функция (params, ctx) => void (или Promise). Из ctx он берёт:
//   ctx.solid.box([x0,x1], [y0,y1], [z0,z1], "цвет")  — коробка в общий склеенный меш (тени отбрасывает)
//   ctx.flatParts.box(...)                            — то же, но без тени (дальние мелочи)
//   ctx.add(mesh, { cast: true })                     — свой меш (с отдельным материалом)
//   ctx.material({ color: "platform", wet: true })    — cel-материал (один на одинаковые параметры)
//   ctx.wires.add(a, b, толщина, "цвет")              — тонкие линии (провода, перила)
//   ctx.glows.add(p, радиус, цвет, { night: true })   — ореолы огней
//   ctx.lamps.push({ position, range, intensity })    — источник света ночью (фонарь)
//   ctx.patterns.push({...})                          — тень-узор ограды (см. engine/light.js)
//   ctx.track("main")                                 — путь по имени (scene/tracks.js)
//   ctx.setBoardScreen([4 угла])                      — куда натянуть светодиодное табло
//   ctx.onStation(fn)                                 — fn(info) при смене станции (таблички с названием)
//   ctx.random(seed)                                  — генератор случайных чисел с зерном
// Всё, что набрано в solid/wires/glows, в конце склеивается в несколько мешей — сцена из сотен
// деталей рисуется за пару десятков вызовов отрисовки.
import * as THREE from "three";
import { Batch, rng } from "../engine/geometry.js";
import { GlowBatch } from "../engine/glows.js";
import { toonCached } from "../engine/materials.js";
import { castShadow } from "../engine/shadows.js";
import { WireBatch } from "../engine/wires.js";
import { Track } from "./tracks.js";

export class SceneContext {
  constructor(def, { invalidate = () => {} } = {}) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.name = def.id || "scene";
    this.solid = new Batch();
    this.flatParts = new Batch();
    this.wires = new WireBatch();
    this.glows = new GlowBatch();
    this.lamps = [];
    this.patterns = [];
    this.boardScreen = null;
    this.stationHandlers = [];
    this.pending = [];
    this.invalidate = (...layers) => invalidate(...(layers.length ? layers : ["scene"]));
    this.tracks = new Map(Object.entries(def.tracks || {}).map(([name, t]) => [name, new Track(name, t)]));
  }

  track(name) {
    const t = this.tracks.get(name);
    if (!t) throw new Error(`Сцена «${this.def.name}»: нет пути «${name}» (есть: ${[...this.tracks.keys()].join(", ")})`);
    return t;
  }

  material(opts) {
    return toonCached(opts);
  }

  /** Добавить свой объект; cast — отбрасывает тень от солнца. */
  add(object, { cast = true } = {}) {
    if (cast) castShadow(object);
    this.group.add(object);
    return object;
  }

  random(seed = 1) {
    return rng(seed);
  }

  setBoardScreen(corners) {
    this.boardScreen = corners;
  }

  onStation(fn) {
    this.stationHandlers.push(fn);
  }

  /** Сменилась станция: таблички с названием перерисовываются. */
  setStation(info) {
    this.stationName = info.name;
    for (const fn of this.stationHandlers) fn(info);
  }

  /** Склеить набранные детали в меши и добавить их в сцену. */
  finish() {
    if (!this.solid.empty) this.add(this.solid.mesh(this.material({ vertexColors: true, wet: true, snow: true })), { cast: true });
    if (!this.flatParts.empty) this.add(this.flatParts.mesh(this.material({ vertexColors: true })), { cast: false });
    if (this.wires.count) this.group.add(this.wires.build());
    if (this.glows.items.length) this.group.add(this.glows.build());
    return this.group;
  }
}
