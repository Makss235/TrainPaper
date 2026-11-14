// Камера — объект сцены с компонентом Camera. Камер может быть несколько (ракурсы), активна одна.
// Положение и поворот — трансформ объекта (камера смотрит вдоль своей оси −z), объектив — свойства.
// Плоская (2D) картинка — ортографическая камера: предметы не уменьшаются с расстоянием; fov/focal у неё задают
// только то, каким объективом показано небо за сценой. Ставьте её горизонтально: под наклоном вниз неба не видно.
// Движение за курсором у такой камеры — сдвиг слоёв (CameraParallax.layers), а не поворот: поворот выдаёт объём.
//
//   { "name": "Сбоку", "position": [-4, 0, 0], "rotation": [0, -90, 0],
//     "components": [{ "type": "Camera", "projection": "orthographic", "size": [18, 9], "center": [0.5, 0.95] }] }
//
//   { "name": "Основной", "position": [0, 2.75, 0], "rotation": [0, 0, 0],
//     "components": [{ "type": "Camera", "main": true, "focal": [0.6, 1.02], "center": [0.41, 0.44] },
//                    { "type": "CameraParallax" }] }
// @ts-check
import { Component } from "../core/component.js";

const DEG = Math.PI / 180;

export class Camera extends Component {
  static type = "Camera";
  static doc = "Ракурс: где стоит и куда смотрит камера (трансформ объекта, ось −z) и объектив — перспективный или ортографический (2D). Переключение: engine.cameras.use(имя, мс).";
  static props = {
    label: { type: "string", default: "", doc: "Подпись в панели «Ракурс» (по умолчанию — имя объекта)" },
    main: { type: "boolean", default: false, doc: "Камера по умолчанию" },
    target: { type: "vec3", default: null, doc: "Точка, куда смотреть (мир, м) — вместо поворота объекта" },
    projection: { type: "enum", options: ["perspective", "orthographic"], default: "perspective", doc: "Проекция: perspective — обычная, orthographic — плоская картинка без перспективы (2D)" },
    size: { type: "vec2", default: [16, 9], doc: "Ортографическая: кадр вмещает не больше [ширина, высота] метров — масштаб одинаков на любом экране" },
    fov: { type: "number", default: 0, min: 0, max: 170, doc: "Вертикальный угол обзора, ° (0 — по фокусному focal)" },
    focal: { type: "vec2", default: [.6, 1.02], doc: "Фокусное: f = max(ширина × [0], высота × [1]) пикселей — кадр одинаково собран на любом экране" },
    center: { type: "vec2", default: [.5, .5], doc: "Где на экране точка, куда смотрит камера (доли ширины и высоты)" },
    portrait: { type: "object", default: null, doc: "Поправки для вертикального экрана: { focal, center, size }" },
    near: { type: "number", default: .3, min: .01, doc: "Ближняя плоскость, м" },
    far: { type: "number", default: 6000, doc: "Дальняя плоскость, м" },
  };

  awake() { this.#aim(); }
  start() { this.engine.cameras.register(this); }
  onChange(keys) {
    if (keys.includes("target")) this.#aim();
    this.object3D.userData.moved = true;
    if (this.engine.cameras.active === this) { this.engine.cameras.use(this); }
  }
  onDestroy() { this.engine?.cameras.unregister(this); }

  /** Повернуть объект на target (ось −z смотрит на точку). */
  #aim() {
    const t = this.props.target;
    if (!t) return;
    const o = this.object3D;
    o.updateMatrixWorld(true);
    const p = o.getWorldPosition(o.position.clone());
    const dx = t[0] - p.x, dy = t[1] - p.y, dz = t[2] - p.z, len = Math.hypot(dx, dy, dz) || 1;
    o.rotation.set(Math.asin(dy / len), Math.atan2(-dx, -dz), 0, "YXZ");
    o.updateMatrixWorld(true);
  }
}

export class CameraParallax extends Component {
  static type = "CameraParallax";
  static doc = "Камера слегка движется за курсором (на объекте с Camera): сдвиг и поворот — для перспективной камеры, сдвиг слоёв — для плоской (2D).";
  static props = {
    shift: { type: "vec2", default: [.09, .03], doc: "Сдвиг камеры при курсоре у края экрана [вбок, вверх], м" },
    turn: { type: "vec2", default: [1.4, .75], doc: "Поворот [по горизонтали, по вертикали], °" },
    layers: { type: "vec2", default: [0, 0], doc: "Сдвиг слоёв (для плоской камеры): на сколько метров смещается предмет на каждый метр ближе глубины focus [по горизонтали, по вертикали]. Ближнее движется сильнее дальнего, ничего не поворачивается" },
    focus: { type: "number", default: 40, min: 0, doc: "Глубина, которая при сдвиге слоёв остаётся на месте, м (небо тоже неподвижно)" },
    ease: { type: "number", default: 3, min: .1, doc: "Скорость догона курсора (больше — резче)" },
  };
}

void DEG;
