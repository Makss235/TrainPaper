// Свет: источник (фонарь, прожектор, направленная подсветка) и тень-узор ограды.
//
//   { "type": "Light", "range": 11, "intensity": 1.15, "offset": [1.0, 4.7, 0] }                      // фонарь, ночью
//   { "type": "Light", "kind": "spot", "target": "Платформа", "angle": 40, "penumbra": 0.3, "range": 25, "castShadow": true }
//   { "type": "Light", "kind": "directional", "direction": [1, -0.3, 0.2], "intensity": 0.25, "mode": "always" }  // контровой свет
//
//   const lamp = go.getComponent("Light");
//   await lamp.turnOff(1);          // погасить за 1 с (плавно, кадры — только пока гаснет)
//   lamp.turnOn();  lamp.setIntensity(.5, 2);
// @ts-check
import * as THREE from "three";
import { Component } from "../core/component.js";

export class Light extends Component {
  static type = "Light";
  static category = "Свет";
  static doc = "Источник света: точечный (пятно под фонарём), прожектор (конус, может давать тень) или направленный (подсветка). Горит ночью, всегда или по команде.";
  static props = {
    kind: { type: "enum", options: ["point", "spot", "directional"], default: "point", doc: "point — во все стороны, spot — конусом, directional — параллельными лучами (без спада)" },
    color: { type: "color", default: [1, .82, .55], doc: "Цвет (по умолчанию тёплый)" },
    intensity: { type: "number", default: 1, min: 0, doc: "Яркость" },
    range: { type: "number", default: 10, min: .1, doc: "Радиус освещения, м (point, spot)" },
    angle: { type: "number", default: 35, min: 1, max: 85, doc: "Прожектор: половина угла конуса, °" },
    penumbra: { type: "number", default: .25, min: 0, max: 1, doc: "Прожектор: доля мягкого края конуса" },
    direction: { type: "vec3", default: [0, -1, 0], doc: "Куда светит в осях объекта (spot, directional), если нет target" },
    target: { type: "ref", default: null, doc: "Объект, на который светить (spot, directional)" },
    mode: { type: "enum", options: ["night", "always", "manual"], default: "night", doc: "night — ночью и в сумрачную погоду, always — всегда, manual — только по команде (on)" },
    on: { type: "boolean", default: true, doc: "Включён (для mode manual — главный выключатель)" },
    fade: { type: "number", default: 0, min: 0, doc: "Плавность turnOn/turnOff по умолчанию, с" },
    castShadow: { type: "boolean", default: false, doc: "Тень (только spot; не больше quality.maxShadowLights таких источников)" },
    offset: { type: "vec3", default: [0, 0, 0], doc: "Где источник внутри объекта, м" },
    night: { type: "boolean", default: null, doc: "Устарело: true — mode \"night\", false — mode \"always\"" },
  };
  static actions = { "Включить": "turnOn", "Выключить": "turnOff" };

  /** Множитель плавного включения 0…1. */
  level = 1;
  /** @type {AbortController | null} */
  #fading = null;

  awake() {
    if (this.props.night != null) {
      this.props.mode = this.props.night ? "night" : "always";
      this.props.night = null;
    }
    this.level = this.props.on ? 1 : 0;
  }

  /** Горит только ночью (× сумерки) — для шейдера. */
  get nightOnly() { return this.props.mode === "night"; }

  /** Цвет × яркость × включённость. */
  get color() {
    const k = this.props.intensity * this.level;
    return this.engine.palette.rgb(this.props.color).map(c => c * k);
  }

  start() { this.engine.lights.add(this); }
  onChange(keys) {
    if (keys.includes("night") && this.props.night != null) { this.props.mode = this.props.night ? "night" : "always"; this.props.night = null; }
    if (keys.includes("on") && !this.#fading) this.level = this.props.on ? 1 : 0;
    this.#changed();
  }
  onEnable() { this.#changed(); }
  onDisable() { this.#changed(); }

  /** Сообщить системе света и связанным ореолам (Glow { light: id }). */
  #changed() {
    this.engine.lights.markDirty();
    this.gameObject.emit("lightChanged", this);
  }
  onDestroy() { this.engine?.lights.remove(this); }

  /** @param {number} to @param {number} fade */
  #fade(to, fade) {
    this.#fading?.abort();
    this.#fading = null;
    if (!(fade > 0)) { this.level = to; this.#changed(); return Promise.resolve(); }
    const ac = (this.#fading = new AbortController());
    const from = this.level;
    return this.tween({ from, to, duration: fade, realTime: true, ease: "smoothstep", signal: ac.signal,
      onUpdate: v => { this.level = v; this.#changed(); } })
      .then(() => { if (this.#fading === ac) this.#fading = null; }, () => {});
  }

  /** Включить (плавно за fade с). @param {number} [fade] */
  turnOn(fade = this.props.fade) {
    this.props.on = true;
    return this.#fade(1, fade);
  }

  /** Выключить (плавно за fade с). @param {number} [fade] */
  turnOff(fade = this.props.fade) {
    return this.#fade(0, fade).then(() => { if (this.level === 0) this.props.on = false; this.#changed(); });
  }

  /** Яркость (плавно за fade с). @param {number} v @param {number} [fade] */
  setIntensity(v, fade = this.props.fade) {
    if (!(fade > 0)) { this.set({ intensity: v }); return Promise.resolve(); }   // set → onChange → #changed
    return this.tween({ from: this.props.intensity, to: v, duration: fade, realTime: true, ease: "smoothstep",
      onUpdate: x => { this.props.intensity = x; this.#changed(); } });
  }

  /** Источник в мире: положение и направление (единичное, куда светит). */
  world() {
    const o = this.object3D;
    o.updateMatrixWorld(true);
    const pos = new THREE.Vector3(...this.props.offset).applyMatrix4(o.matrixWorld);
    let dir;
    const t = this.props.target;
    if (t && t.object3D) {
      t.object3D.updateMatrixWorld(true);
      dir = new THREE.Vector3().setFromMatrixPosition(t.object3D.matrixWorld).sub(pos);
    } else {
      dir = new THREE.Vector3(...this.props.direction).transformDirection(o.matrixWorld);
    }
    if (dir.lengthSq() < 1e-9) dir.set(0, -1, 0);
    return { position: pos.toArray(), direction: dir.normalize().toArray() };
  }
}

export class StripeShadow extends Component {
  static type = "StripeShadow";
  static category = "Свет";
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
