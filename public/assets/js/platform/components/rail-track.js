// Путь для поездов (логика): ось пути — линия вдоль мировой оси z через объект. Внешний вид пути —
// отдельный компонент Model ("station/track") на том же объекте. Поезда ставятся на путь по имени объекта.
//
//   { "name": "Путь 1", "position": [4.42, 0, 0], "components": [
//       { "type": "Model", "model": "station/track" },
//       { "type": "RailTrack", "platform": { "top": 1.1, "edge": 2.5 } } ] }
// @ts-nocheck
import { Component } from "../../../../engine/index.js";

export class RailTrack extends Component {
  static type = "RailTrack";
  static doc = "Путь для поездов: ось — линия вдоль мировой оси z через объект. Поезда находят путь по имени объекта.";
  static props = {
    platform: { type: "object", default: null, doc: "Платформа у пути: { top: высота пола, edge: x края платформы (мир) } — для света из окон ночью" },
  };

  /** x оси пути в мире */
  get x() { this.object3D.updateMatrixWorld(true); return this.object3D.matrixWorld.elements[12]; }
  /** высота головки рельса в мире */
  get y() { return this.object3D.matrixWorld.elements[13]; }
  get platform() { return this.props.platform; }
  get name() { return this.gameObject.name; }
}
