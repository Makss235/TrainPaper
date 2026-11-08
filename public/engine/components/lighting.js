// Свет: точечный источник (фонарь) и тень-узор ограды.
// @ts-check
import { Component } from "../core/component.js";
import { rgb } from "../render/palette.js";

export class Light extends Component {
  static type = "Light";
  static doc = "Точечный источник света: пятно на полу под фонарём, отсвет на борту поезда. Учитываются 8 ближайших к камере.";
  static props = {
    color: { type: "color", default: [1, .82, .55], doc: "Цвет (по умолчанию тёплый)" },
    intensity: { type: "number", default: 1, min: 0, doc: "Яркость" },
    range: { type: "number", default: 10, min: .1, doc: "Радиус освещения, м" },
    night: { type: "boolean", default: true, doc: "Горит только ночью (и в сумрачную погоду)" },
    offset: { type: "vec3", default: [0, 0, 0], doc: "Где источник внутри объекта, м" },
  };

  get color() { return rgb(this.props.color); }
  start() { this.engine.lights.add(this); }
  onChange() { this.engine.lights.markDirty(); }
  onEnable() { this.engine.lights.markDirty(); }
  onDisable() { this.engine.lights.markDirty(); }
  onDestroy() { this.engine?.lights.remove(this); }
}

export class StripeShadow extends Component {
  static type = "StripeShadow";
  static doc = "Тень решётки (ограды) узором: считается в шейдере пола, без муара. Плоскость решётки — вдоль оси z объекта (не поворачивайте объект). Не больше двух на сцену.";
  static props = {
    length: { type: "number", default: 100, min: 0, doc: "Длина решётки от объекта в сторону −z, м" },
    bottom: { type: "number", default: .12, doc: "Низ прутьев над объектом, м" },
    top: { type: "number", default: 1.12, doc: "Верх прутьев над объектом, м" },
    step: { type: "number", default: .14, min: .01, doc: "Шаг прутьев, м" },
    bar: { type: "number", default: .02, min: .001, doc: "Толщина прута, м" },
    postStep: { type: "number", default: 2.5, min: .1, doc: "Шаг стоек, м" },
    post: { type: "number", default: .06, doc: "Толщина стойки, м" },
    rails: { type: "vec2", default: [1.12, .12], doc: "Высоты двух перил над объектом, м" },
    railWidth: { type: "number", default: .05, doc: "Толщина перил, м" },
  };

  start() { this.engine.lights.addPattern(this); }
  onChange() { this.engine.lights.markDirty(); }
  onDestroy() { this.engine?.lights.removePattern(this); }

  /** Параметры в мировых координатах для шейдера. */
  world() {
    const p = this.props, o = this.object3D;
    o.updateMatrixWorld(true);
    const e = o.matrixWorld.elements, x = e[12], y = e[13], z = e[14];
    return {
      x, y0: y + p.bottom, y1: y + p.top, step: p.step, bar: p.bar, postStep: p.postStep, post: p.post,
      rail: p.railWidth / 2, rails: [y + p.rails[0], y + p.rails[1]], from: z, to: z - p.length,
    };
  }
}
