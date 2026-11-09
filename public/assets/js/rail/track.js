// Путь для поездов — компонент Track. Ось пути — ломаная points (в осях объекта), углы скругляются дугами
// радиуса radius; или явные участки segments. Внешний вид — соседний компонент Model с моделью пути
// ("station/track"): Track сам передаёт ей свою ось (params.path), чтобы не повторять данные.
//
//   { "name": "Путь 1", "position": [4.42, 0, 0], "components": [
//     { "type": "Model", "model": "station/track" },
//     { "type": "Track", "points": [[0, 0, 300], [0, 0, -400], [-60, 0, -900]], "radius": 800 } ] }
//
// s — метры вдоль оси от первой точки. Поезда видны на участке visible [s0, s1] (по умолчанию — весь путь):
// TrainManager ставит поезд перед ним и убирает, когда поезд целиком ушёл за него.
// @ts-check
import * as THREE from "three";
import { Component } from "../../../engine/index.js";
import { buildPath } from "./track-math.js";

export class Track extends Component {
  static type = "Track";
  static category = "Железная дорога";
  static doc = "Путь для поездов: ось — ломаная points со скруглением radius (или segments). Модель пути на том же объекте получает ось сама.";
  static props = {
    points: { type: "array", default: [[0, 0, 300], [0, 0, -3000]], doc: "Точки оси [[x, y, z], ...] в осях объекта, м" },
    radius: { type: "number", default: 0, min: 0, doc: "Радиус скругления углов, м (0 — без скругления)" },
    segments: { type: "array", default: [], doc: "Вместо points: [{ straight: L }, { arc: { radius, angle } }] от начала объекта к −z" },
    visible: { type: "vec2", default: null, doc: "Участок, где поезда видны [s0, s1], м (по умолчанию — весь путь)" },
    next: { type: "ref", default: null, doc: "Путь, который продолжает этот за его концом" },
    prev: { type: "ref", default: null, doc: "Путь, который продолжается этим перед его началом" },
    model: { type: "boolean", default: true, doc: "Передать ось соседнему Model с моделью пути" },
  };

  /** Ось пути в осях объекта (rail/track-math.js) @type {import("./track-math.js").TrackPath} */
  path = buildPath({ points: [[0, 0, 0], [0, 0, -1]] });

  awake() {
    this.#build();
    this.#syncModel();
  }

  onChange() {
    this.#build();
    this.#syncModel();
  }

  #build() {
    const p = this.props;
    this.path = buildPath(p.segments?.length ? { segments: p.segments } : { points: p.points, radius: p.radius });
  }

  /** Передать ось соседней модели пути (модель строит рельсы по той же кривой). */
  #syncModel() {
    if (!this.props.model) return;
    const model = this.gameObject.getComponents("Model").find(m => /track/.test(m.props.model));
    if (!model) return;
    const path = this.path.sample(4);
    if (JSON.stringify(model.props.params?.path) === JSON.stringify(path)) return;
    model.set({ params: { ...model.props.params, path } });
  }

  /** Длина оси, м. */
  get length() { return this.path.length; }
  get name() { return this.gameObject.name; }
  /** Участок, где видны поезда [s0, s1]. */
  get range() { return /** @type {[number, number]} */ (this.props.visible || [0, this.length]); }

  /** Матрица объекта (мир). */
  #matrix() {
    this.object3D.updateMatrixWorld(true);
    return this.object3D.matrixWorld;
  }

  /**
   * Точка оси в мире: положение и касательная (единичная, к росту s).
   * @param {number} s
   * @returns {{position: number[], tangent: number[]}}
   */
  pointAt(s) {
    const p = this.path.pointAt(s), m = this.#matrix();
    const pos = new THREE.Vector3(...p.position).applyMatrix4(m);
    const tan = new THREE.Vector3(...p.tangent).transformDirection(m);
    return { position: pos.toArray(), tangent: tan.toArray() };
  }

  /**
   * Ближайшая к точке мира позиция на оси.
   * @param {number[]} world
   * @returns {{s: number, distance: number}}
   */
  project(world) {
    const local = new THREE.Vector3(...world).applyMatrix4(this.#matrix().clone().invert());
    return this.path.project(local.toArray());
  }

  /** Направление «влево» от оси в точке s (мир, к росту s). @param {number} s */
  leftAt(s) {
    const t = this.pointAt(s).tangent;
    return [t[2], 0, -t[0]];
  }
}
