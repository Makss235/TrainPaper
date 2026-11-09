// Точка остановки на пути — компонент StopPoint. Отметка s на пути (или положение объекта — тогда s
// находится проекцией на ось) и какой частью поезда вставать у отметки: головой, хвостом или серединой.
//
//   { "name": "Платформа 1", "position": [4.42, 0, -7.2], "components": [
//     { "type": "StopPoint", "track": "Путь 1", "align": "tail",
//       "platform": { "top": 1.1, "edge": 1.92, "side": "left" } } ] }
//
// align: "head" — голова поезда у отметки, "tail" — хвост, "center" — середина (по направлению движения).
// platform — платформа у пути для света из окон ночью: top — высота пола над головкой рельса, edge — от оси пути
// до края платформы (м), side — с какой стороны пути платформа, если смотреть к росту s: "left" | "right".
// @ts-check
import { Component } from "../../../engine/index.js";

export class StopPoint extends Component {
  static type = "StopPoint";
  static category = "Железная дорога";
  static doc = "Точка остановки на пути: отметка (s или положение объекта) и чем поезду вставать у неё — головой, хвостом или серединой.";
  static props = {
    track: { type: "component", component: "Track", default: null, doc: "Путь (объект с Track)" },
    s: { type: "number", default: null, doc: "Отметка на пути, м от начала оси (по умолчанию — проекция положения объекта)" },
    name: { type: "string", default: "", doc: "Имя для расписания (по умолчанию — имя объекта)" },
    align: { type: "enum", options: ["head", "tail", "center"], default: "head", doc: "Чем поезду вставать у отметки" },
    platform: { type: "object", default: null, doc: "Платформа: { top, edge, side } — для света из окон на пол" },
  };

  get name() { return this.props.name || this.gameObject.name; }

  /** @returns {import("./track.js").Track | null} */
  get track() { return this.props.track; }

  /** Отметка на пути, м. */
  get s() {
    if (this.props.s != null) return this.props.s;
    if (!this.track) return 0;
    this.object3D.updateMatrixWorld(true);
    const e = this.object3D.matrixWorld.elements;
    return this.track.project([e[12], e[13], e[14]]).s;
  }

  /**
   * Где должна быть голова поезда длины length, идущего в сторону dir (+1 — к росту s), чтобы встать у отметки.
   * @param {number} length @param {number} dir
   */
  headFor(length, dir) {
    const s = this.s, a = this.props.align;
    if (a === "tail") return s + dir * length;
    if (a === "center") return s + dir * length / 2;
    return s;
  }
}
