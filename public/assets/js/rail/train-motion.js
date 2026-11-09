// Движение поезда по пути — компонент TrainMotion (на объекте с Train). Состояние: путь, s головы, направление dir
// (+1 — к росту s), скорость. Параметры: maxSpeed (м/с), accel и brake (м/с²). Кривая торможения рассчитана
// так, чтобы встать точно у отметки (rail/kinematics.js). Каждый вагон ставится на путь отдельно через
// Track.pointAt — на кривой состав изгибается. Стоит на месте — update спит (кадров нет).
//
//   const m = train.getComponent("TrainMotion");
//   m.place("Путь 1", 300, -1);                 // голова на s = 300, едет к уменьшению s
//   await m.stopAt("Платформа 1", 40);          // подъехать, встать, стоять 40 с (секунды симуляции)
//   await m.depart();                           // разгон и уход за пределы видимого участка пути
//   await m.pass(33);                           // проход без остановки со скоростью 33 м/с
//
// События объекта поезда: "arriving" (начал подход к остановке), "arrived", "departed", "left" (ушёл за видимый участок).
// @ts-check
import { Component } from "../../../engine/index.js";
import { advance, approachSpeed } from "./kinematics.js";

/** @typedef {import("./track.js").Track} Track */
/** @typedef {import("./stop-point.js").StopPoint} StopPoint */

export class TrainMotion extends Component {
  static type = "TrainMotion";
  static category = "Железная дорога";
  static doc = "Движение поезда по пути: подход с торможением точно к отметке, стоянка, разгон, проход. Стоящий поезд кадров не рисует.";
  static order = 10;
  static props = {
    track: { type: "component", component: "Track", default: null, doc: "Путь (объект с Track)" },
    s: { type: "number", default: null, doc: "Где голова поезда, м от начала пути (для поезда, поставленного в сцене)" },
    stop: { type: "component", component: "StopPoint", default: null, doc: "Или: поставить у этой точки остановки" },
    dir: { type: "number", default: 1, doc: "Направление: 1 — к росту s, −1 — обратно" },
    maxSpeed: { type: "number", default: 25, min: .1, doc: "Наибольшая скорость, м/с" },
    accel: { type: "number", default: .5, min: .01, doc: "Разгон, м/с²" },
    brake: { type: "number", default: 1, min: .01, doc: "Торможение, м/с²" },
    margin: { type: "number", default: 30, min: 0, doc: "Запас за пределами видимого участка пути, м" },
  };
  static actions = { "Отправить": "depart", "Остановить": "halt" };

  /** @type {Track | null} */
  track = null;
  /** s головы, м */
  s = 0;
  dir = 1;
  /** скорость, м/с */
  v = 0;
  /** @type {"idle" | "approach" | "stopped" | "run" | "left"} */
  state = "idle";
  /** @type {StopPoint | null} */
  stop = null;
  /** @type {{traveled: number, v: number, arrived: boolean}} */
  st = { traveled: 0, v: 0, arrived: false };
  /** @type {{stopAt: number | null, target?: number} | null} */
  cmd = null;
  /** @type {((v?: any) => void) | null} */
  resolve = null;

  async start() {
    const train = this.train;
    await train?.ready;
    if (this.destroyed) return;
    // вагоны ставятся в мировых координатах: сам объект поезда — просто контейнер
    this.object3D.position.set(0, 0, 0);
    this.object3D.rotation.set(0, 0, 0);
    const p = this.props;
    if (p.stop) this.placeAt(p.stop, p.dir);
    else if (p.track && p.s != null) this.place(p.track, p.s, p.dir);
  }

  /** @returns {import("./train.js").Train | undefined} */
  get train() { return this.gameObject.getComponent("Train"); }
  /** @returns {number} */
  get length() { return this.train?.length ?? 0; }
  /** s хвоста. */
  get tailS() { return this.s - this.dir * this.length; }
  get moving() { return this.state === "approach" || this.state === "run"; }

  // ---------- поиск пути и остановки по имени ----------

  /** @param {Track | string | null | undefined} t @returns {Track | null} */
  #track(t) {
    if (!t) return null;
    if (typeof t !== "string") return t;
    return /** @type {Track | null} */ (this.find(t)?.getComponent("Track") ?? null);
  }

  /** @param {StopPoint | string | null | undefined} s @returns {StopPoint | null} */
  #stop(s) {
    if (!s) return null;
    if (typeof s !== "string") return s;
    const go = this.find(s);
    const stop = go?.getComponent("StopPoint") ?? this.engine.scene.components("StopPoint").find(c => /** @type {any} */ (c).name === s);
    if (!stop) this.warn(`нет точки остановки «${s}»`);
    return /** @type {StopPoint | null} */ (stop ?? null);
  }

  // ---------- команды ----------

  /**
   * Поставить поезд: голова на s, направление dir, скорость v.
   * @param {Track | string} track @param {number} s @param {number} [dir] @param {number} [v]
   */
  place(track, s, dir = 1, v = 0) {
    const t = this.#track(track);
    if (!t) { this.warn(`нет пути «${track}»`); return; }
    this.track = t;
    this.s = s;
    this.dir = dir >= 0 ? 1 : -1;
    this.v = v;
    this.state = v > 0 ? "run" : "idle";
    this.#placeCars();
  }

  /**
   * Поставить у точки остановки (сразу, без движения).
   * @param {StopPoint | string} stopRef @param {number} [dir]
   */
  placeAt(stopRef, dir = 1) {
    const stop = this.#stop(stopRef);
    if (!stop?.track) return;
    this.place(stop.track, stop.headFor(this.length, dir >= 0 ? 1 : -1), dir);
    this.stop = stop;
    this.state = "stopped";
    this.#platform(stop);
    this.gameObject.emit("arrived", { stop });
  }

  /**
   * Ехать и встать у отметки: точка остановки (или её имя) или s головы. Промис — когда встал.
   * @param {StopPoint | string | number} target @param {{speed?: number}} [o]
   * @returns {Promise<void>}
   */
  driveTo(target, { speed } = {}) {
    const stop = typeof target === "number" ? null : this.#stop(target);
    if (!this.track && stop?.track) this.track = stop.track;
    const head = stop ? stop.headFor(this.length, this.dir) : /** @type {number} */ (target);
    const distance = (head - this.s) * this.dir;
    this.#finish();
    if (distance <= 1e-3) { this.s = head; this.#placeCars(); this.state = "stopped"; return Promise.resolve(); }
    this.stop = stop;
    if (stop) this.#platform(stop);
    this.st = { traveled: 0, v: this.v, arrived: false };
    this.cmd = { stopAt: distance, target: speed };
    this.state = "approach";
    this.gameObject.emit("arriving", { stop, s: head });
    this.wake();
    return new Promise(resolve => { this.resolve = resolve; });
  }

  /**
   * Подъехать к остановке и стоять dwell секунд (симуляции).
   * @param {StopPoint | string} stop @param {number} [dwell]
   */
  async stopAt(stop, dwell = 0) {
    await this.driveTo(stop);
    if (dwell > 0) await this.wait(dwell);
  }

  /**
   * Отправиться: разгон до maxSpeed (или speed) и уход за видимый участок. Промис — когда ушёл ("left").
   * @param {{speed?: number}} [o]
   * @returns {Promise<void>}
   */
  depart({ speed } = {}) {
    this.#finish();
    this.st = { traveled: 0, v: this.v, arrived: false };
    this.cmd = { stopAt: null, target: speed };
    const was = this.state;
    this.state = "run";
    if (was === "stopped" || was === "idle") this.gameObject.emit("departed", { stop: this.stop });
    this.wake();
    return new Promise(resolve => { this.resolve = resolve; });
  }

  /**
   * Проход без остановки: сразу со скоростью speed (въезд на ходу) до ухода за видимый участок.
   * @param {number} [speed]
   */
  pass(speed = this.props.maxSpeed) {
    this.v = Math.min(speed, this.props.maxSpeed);
    return this.depart({ speed });
  }

  /** Сменить скорость движения без остановки. @param {number} v */
  setSpeed(v) {
    if (this.cmd) this.cmd.target = v;
    else this.depart({ speed: v });
  }

  /** Встать (плавно, по тормозному пути). */
  halt() {
    if (!this.moving) return;
    const d = this.v * this.v / (2 * this.props.brake);
    this.driveTo(this.s + this.dir * d);
  }

  /** Скорость въезда, чтобы с distance метров плавно затормозить до остановки. @param {number} distance */
  approachSpeed(distance) {
    return approachSpeed(distance, this.props.maxSpeed, this.props.brake);
  }

  #finish() {
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  /** Свет из окон на платформу этой остановки. @param {StopPoint | null} stop */
  #platform(stop) {
    const lights = this.gameObject.getComponent("TrainLights");
    /** @type {any} */ (lights)?.setPlatform(stop?.props.platform ?? null, this.dir);
  }

  // ---------- шаг ----------

  /** @param {number} dt */
  update(dt) {
    if (!this.track || !this.cmd || !this.moving) { this.sleep(); return; }
    const p = this.props;
    const ds = advance(this.st, dt, { vmax: p.maxSpeed, accel: p.accel, brake: p.brake, stopAt: this.cmd.stopAt, target: this.cmd.target });
    this.v = this.st.v;
    this.s += this.dir * ds;
    this.#placeCars();
    if (this.st.arrived && this.cmd.stopAt != null) {
      this.state = "stopped";
      this.cmd = null;
      this.v = 0;
      this.sleep();
      this.gameObject.emit("arrived", { stop: this.stop });
      this.#finish();
      return;
    }
    const [r0, r1] = this.track.range, m = p.margin, tail = this.tailS;
    if ((this.dir > 0 && tail > r1 + m) || (this.dir < 0 && tail < r0 - m)) {
      this.state = "left";
      this.cmd = null;
      this.sleep();
      this.gameObject.emit("left", {});
      this.#finish();
    }
  }

  /** Каждый вагон и переход — на путь по своим концам (на кривой — хордой). */
  #placeCars() {
    const train = this.train, track = this.track;
    if (!train?.built || !track) return;
    const L = train.length, dir = this.dir;
    for (const part of train.parts) {
      const sTail = this.s - dir * (L - part.z0), sHead = this.s - dir * (L - part.z1);
      const a = track.pointAt(sTail).position, b = track.pointAt(sHead).position;
      const k = part.z1 > part.z0 ? (part.anchor - part.z0) / (part.z1 - part.z0) : 0;
      const o = part.go.object3D;
      o.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
      o.rotation.set(0, Math.atan2(b[0] - a[0], b[2] - a[2]), 0, "YXZ");
    }
    this.gameObject.moved();
  }
}
