// HTML-элемент на плоскости в 3D (табло, вывеска с живым текстом): элемент страницы натягивается
// на прямоугольник объекта через CSS matrix3d. Текст остаётся настоящим текстом — чёткий при любом
// ракурсе и дешёвый: перерисовка 3D-сцены ему не нужна.
// Ограничение: элемент всегда поверх сцены (его не заслоняют объекты), поэтому ставьте экран так,
// чтобы перед ним ничего не было. Сзади (экран отвернулся от камеры) элемент прячется.
//
//   { "type": "HtmlScreen", "element": "#board", "size": [2.68, 0.86], "pixelWidth": 1200 }
// Элемент должен лежать в контейнере движка: position: absolute; left: 0; top: 0; transform-origin: 0 0.
// @ts-check
import * as THREE from "three";
import { Component } from "../core/component.js";

/** CSS matrix3d, который натягивает прямоугольник w×h на четырёхугольник p0…p3 (по часовой от левого верхнего). */
export function homography(w, h, [x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map(v => +v.toFixed(8)).join(",")})`;
}

export class HtmlScreen extends Component {
  static type = "HtmlScreen";
  static doc = "HTML-элемент страницы на прямоугольнике в 3D (табло с живым текстом). Прямоугольник — в плоскости xy объекта, лицом к +z.";
  static props = {
    element: { type: "string", default: "", doc: "CSS-селектор элемента: \"#board\"" },
    size: { type: "vec2", default: [2, 1], doc: "Ширина и высота экрана, м" },
    offset: { type: "vec3", default: [0, 0, .002], doc: "Центр экрана внутри объекта, м" },
    pixelWidth: { type: "number", default: 1200, min: 1, doc: "Ширина элемента в CSS-пикселях (высота — по пропорции)" },
  };

  start() {
    this.el = this.props.element ? document.querySelector(this.props.element) : null;
    if (!this.el) { console.warn(`HtmlScreen «${this.gameObject.name}»: нет элемента ${this.props.element}`); return; }
    Object.assign(this.el.style, { position: "absolute", left: "0", top: "0", transformOrigin: "0 0" });
    this.hook = layers => { if (layers.has("scene")) this.place(); };
    this.engine.afterRender.push(this.hook);
    this.place();
  }

  onChange() { this.place(); }
  onDisable() { if (this.el) this.el.style.display = "none"; }
  onEnable() { this.place(); }
  onDestroy() {
    if (this.hook) this.engine.afterRender = this.engine.afterRender.filter(f => f !== this.hook);
  }

  /** Углы экрана в мире: левый верхний, правый верхний, правый нижний, левый нижний. */
  corners() {
    const [w, h] = this.props.size, [ox, oy, oz] = this.props.offset;
    const m = this.object3D.matrixWorld;
    return [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]]
      .map(([x, y]) => new THREE.Vector3(ox + x, oy + y, oz).applyMatrix4(m).toArray());
  }

  place() {
    const el = this.el;
    if (!el) return;
    if (!this.enabled || !this.gameObject.activeInHierarchy) { el.style.display = "none"; return; }
    this.object3D.updateMatrixWorld(true);
    const c = this.corners(), E = this.engine;
    const pts = c.map(p => E.project(p));
    // экран смотрит от камеры — прячем, иначе текст был бы зеркальным
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.object3D.matrixWorld);
    const toCam = E.camera.position.clone().sub(new THREE.Vector3(...c[0]));
    if (!pts.every(Boolean) || n.dot(toCam) <= 0) { el.style.display = "none"; return; }
    const [w, h] = this.props.size, pw = this.props.pixelWidth, ph = Math.round(pw * h / w);
    if (el.style.height !== `${ph}px`) { el.style.width = `${pw}px`; el.style.height = `${ph}px`; }
    el.style.display = "";
    const q = /** @type {[number, number][]} */ (pts);
    el.style.transform = homography(pw, ph, q[0], q[1], q[2], q[3]);
  }
}
