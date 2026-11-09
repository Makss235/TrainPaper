// Менеджер поездов — компонент TrainManager (один на сцену). Реестр поездов по id; spawn(spec) ставит поезд
// перед видимой частью пути и ведёт по программе (подход и стоянка, проход), убирает, когда поезд ушёл.
// Простая занятость путей: на пути — один поезд; следующий не появляется, а ждёт в очереди.
//
//   const m = engine.scene.findComponent("TrainManager");
//   await m.spawn({ id: "6601", consist: "emu-fast", track: "Путь 1", stop: "Платформа 1", action: "stop", dwell: 40, dir: -1 });
//   m.spawn({ id: "гр-1", consist: "freight", track: "Путь 2", action: "pass", speed: 20, dir: 1, seed: 7 });
//   m.release("6601");      // стоящий поезд отправляется сейчас; ещё не появившийся — отменяется
//   m.updateTrain("6601", { departAt: … });   // поменять время отправления на ходу
//   m.list(); m.get("6601");
//
// spec: { id, consist, number, info, seed, track, stop, action: "stop" | "pass" | "stand",
//   dir (1 — к росту s), dwell (с) или departAt (мс симуляции; null — стоять, пока не отпустят release()),
//   speed (м/с, для pass и въезда), from (за сколько метров до остановки появиться; по умолчанию — от края видимого участка) }
// action "stand" — поезд уже стоит у платформы (например, при загрузке страницы).
// События (на объекте менеджера и engine.events): "trainSpawned", "trainRemoved" — с записью поезда.
// @ts-check
import { Component } from "../../../engine/index.js";
import { travelTime } from "./kinematics.js";

/**
 * @typedef {object} TrainSpec
 * @property {string} id
 * @property {string | any[]} [consist]
 * @property {string} [number]
 * @property {any} [info]
 * @property {number} [seed]
 * @property {string | import("./track.js").Track} [track]
 * @property {string | import("./stop-point.js").StopPoint} [stop]
 * @property {"stop" | "pass" | "stand"} [action]
 * @property {number} [dir]
 * @property {number} [dwell]
 * @property {number | null} [departAt]
 * @property {number} [speed]
 * @property {number} [from]
 * @property {Record<string, any>} [motion]  свои maxSpeed / accel / brake
 * @property {any} [item]    исходные данные (элемент табло РЖД и т. п.) — менеджер их не трогает
 */

/**
 * @typedef {object} TrainEntry
 * @property {string} id
 * @property {TrainSpec} spec
 * @property {"queued" | "approach" | "standing" | "running" | "done" | "cancelled"} state
 * @property {import("../../../engine/index.js").GameObject | null} go
 * @property {any} train
 * @property {any} motion
 * @property {string} trackName
 * @property {boolean} released
 * @property {() => void} poke   разбудить ожидание (сменились время отправления или released)
 * @property {Promise<void>} [done]
 */

export class TrainManager extends Component {
  static type = "TrainManager";
  static category = "Железная дорога";
  static doc = "Менеджер поездов: появляются перед видимой частью пути, ведутся по программе и убираются; на пути — один поезд, остальные ждут.";
  static props = {
    prefab: { type: "string", default: "train", doc: "Префаб поезда (Train, TrainMotion, TrainLights)" },
    pause: { type: "number", default: 2, min: 0, doc: "Пауза между поездами на одном пути, с" },
    maxSpeed: { type: "number", default: 25, min: .1, doc: "Скорость по умолчанию, м/с" },
    accel: { type: "number", default: .5, min: .01, doc: "Разгон по умолчанию, м/с²" },
    brake: { type: "number", default: 1, min: .01, doc: "Торможение по умолчанию, м/с²" },
  };

  /** @type {Map<string, TrainEntry>} */
  trains = new Map();
  /** @type {Map<string, TrainEntry[]>} очередь по пути */
  queues = new Map();
  /** @type {Map<string, TrainEntry | null>} кто сейчас занимает путь */
  busy = new Map();

  onDestroy() {
    for (const e of this.trains.values()) e.go?.destroy();
    this.trains.clear();
  }

  /** Панель инспектора (engine/dev/inspector.js). */
  inspectorPanel() {
    return {
      title: `Поезда — ${this.gameObject.name}`, empty: "поездов нет",
      rows: this.list().map(e => {
        const m = e.motion;
        return [`${e.id} · ${e.trackName || "—"}`, `${e.state}${m ? ` · s ${m.s.toFixed(0)} · ${(m.v * 3.6).toFixed(0)} км/ч` : ""}`, e.go];
      }),
    };
  }

  /** Все поезда (и ожидающие в очереди). */
  list() { return [...this.trains.values()]; }
  /** @param {string} id */
  get(id) { return this.trains.get(id) ?? null; }

  /** @param {any} t */
  #trackName(t) { return typeof t === "string" ? t : t?.gameObject?.name ?? ""; }

  /**
   * Поставить поезд в очередь своего пути и вести по программе. Возвращает запись поезда (entry.done — промис его программы).
   * @param {TrainSpec} spec
   * @returns {TrainEntry}
   */
  // @ts-expect-error — у менеджера spawn(spec) ставит поезд в очередь (у Component — объект по данным)
  spawn(spec) {
    if (this.trains.has(spec.id)) this.remove(spec.id);
    let wake = () => {};
    /** @type {TrainEntry} */
    const entry = { id: spec.id, spec: { ...spec }, state: "queued", go: null, train: null, motion: null,
      trackName: this.#trackName(spec.track ?? (typeof spec.stop === "string" ? "" : spec.stop?.track?.gameObject.name)), released: false,
      poke: () => wake() };
    /** @type {any} */ (entry).waitPoke = () => new Promise(r => { wake = () => { wake = () => {}; r(undefined); }; });
    this.trains.set(spec.id, entry);
    const q = this.queues.get(entry.trackName) || [];
    q.push(entry);
    this.queues.set(entry.trackName, q);
    this.#next(entry.trackName);
    return entry;
  }

  /** Отправить стоящий поезд сейчас; поезд в очереди — отменить. @param {string} id */
  release(id) {
    const e = this.trains.get(id);
    if (!e) return;
    if (e.state === "queued") { this.#drop(e, "cancelled"); return; }
    e.released = true;
    e.poke();
  }

  /** Поменять программу поезда на ходу: departAt, dwell, info. @param {string} id @param {Partial<TrainSpec>} patch */
  updateTrain(id, patch) {
    const e = this.trains.get(id);
    if (!e) return;
    Object.assign(e.spec, patch);
    if (patch.info !== undefined) e.train?.setInfo(patch.info);
    e.poke();
  }

  /** Убрать поезд сразу (без ухода). @param {string} id */
  remove(id) {
    const e = this.trains.get(id);
    if (e) this.#drop(e, "cancelled");
  }

  /** @param {TrainEntry} e @param {"done" | "cancelled"} state */
  #drop(e, state) {
    e.state = state;
    this.trains.delete(e.id);
    const q = this.queues.get(e.trackName);
    if (q) this.queues.set(e.trackName, q.filter(x => x !== e));
    if (e.go) {
      e.go.destroy();
      e.go = null;
      this.gameObject.emit("trainRemoved", e);
      this.engine.events.emit("trainRemoved", e);
    }
    if (this.busy.get(e.trackName) === e) {
      this.busy.set(e.trackName, null);
      const pause = this.props.pause;
      if (pause > 0 && state === "done") this.after(pause, () => this.#next(e.trackName));
      else this.#next(e.trackName);
    }
  }

  /** Следующий поезд пути, если путь свободен. @param {string} track */
  #next(track) {
    if (this.busy.get(track)) return;
    const q = this.queues.get(track) || [];
    const e = q.shift();
    this.queues.set(track, q);
    if (!e) return;
    this.busy.set(track, e);
    e.done = this.#run(e).catch(error => {
      if (error?.name !== "CancelledError") console.error(`Поезд «${e.id}»:`, error);
    }).finally(() => { if (this.trains.get(e.id) === e) this.#drop(e, "done"); });
  }

  /** Сколько секунд от появления до прибытия к остановке (или до прохода точки stop). @param {TrainSpec} spec @param {number} [length] */
  leadTime(spec, length = 0) {
    const plan = this.#plan(spec, length);
    if (!plan) return 0;
    const L = this.#limits(spec);
    if (plan.action === "pass") return plan.distance / Math.max(.1, spec.speed ?? L.vmax);
    return travelTime(plan.distance, plan.v0, L);
  }

  /** @param {TrainSpec} spec */
  #limits(spec) {
    const p = this.props, m = spec.motion || {};
    // проходящий поезд идёт со своей скоростью, даже если она выше обычной
    const vmax = Math.max(m.maxSpeed ?? p.maxSpeed, spec.action === "pass" ? spec.speed ?? 0 : 0);
    return { vmax, accel: m.accel ?? p.accel, brake: m.brake ?? p.brake };
  }

  /**
   * Откуда начинать: голова на start, скорость въезда v0, путь до остановки distance.
   * @param {TrainSpec} spec @param {number} length
   */
  #plan(spec, length) {
    const stop = typeof spec.stop === "string" ? this.#findStop(spec.stop) : spec.stop ?? null;
    const track = /** @type {any} */ (typeof spec.track === "string" ? this.find(spec.track)?.getComponent("Track") : spec.track) ?? stop?.track;
    if (!track) return null;
    const dir = (spec.dir ?? 1) >= 0 ? 1 : -1, [r0, r1] = track.range, margin = 30;
    const L = this.#limits(spec);
    // за пределами видимого участка: головой за его краем, весь поезд — снаружи
    const outside = dir > 0 ? r0 - margin : r1 + margin;
    if ((spec.action ?? "stop") === "pass" || !stop) {
      const mark = stop ? stop.s : (r0 + r1) / 2;
      return { action: "pass", track, stop, dir, start: outside, v0: spec.speed ?? L.vmax, distance: Math.abs(mark - outside) };
    }
    const head = stop.headFor(length, dir);
    const from = spec.from ?? Math.abs(head - outside);
    return { action: "stop", track, stop, dir, start: head - dir * from, v0: Math.min(spec.speed ?? L.vmax, Math.sqrt(2 * L.brake * from)), distance: from };
  }

  /** @param {string} name */
  #findStop(name) {
    return /** @type {any} */ (this.find(name)?.getComponent("StopPoint") ?? this.engine.scene.components("StopPoint").find(c => /** @type {any} */ (c).name === name) ?? null);
  }

  /** Программа поезда. @param {TrainEntry} e */
  async #run(e) {
    const spec = e.spec, L = this.#limits(spec);
    const go = await this.spawnObject(spec);
    if (this.trains.get(e.id) !== e || this.destroyed) { go.destroy(); return; }
    e.go = go;
    e.train = go.getComponent("Train");
    e.motion = go.getComponent("TrainMotion");
    await e.train.ready;
    this.gameObject.emit("trainSpawned", e);
    this.engine.events.emit("trainSpawned", e);
    const plan = this.#plan(spec, e.train.length);
    if (!plan) { this.warn(`поезд «${e.id}»: нет пути «${spec.track}»`); return; }
    const m = e.motion;
    m.set({ maxSpeed: L.vmax, accel: L.accel, brake: L.brake });
    if (spec.action === "stand") {
      m.placeAt(plan.stop, plan.dir);
    } else if (plan.action === "pass") {
      e.state = "running";
      m.place(plan.track, plan.start, plan.dir, plan.v0);
      await m.pass(plan.v0);
      return;
    } else {
      e.state = "approach";
      m.place(plan.track, plan.start, plan.dir, plan.v0);
      await m.driveTo(plan.stop);
    }
    e.state = "standing";
    // стоянка: до departAt / dwell или пока не отпустят (release); время может поменяться на ходу (update)
    const arrivedAt = this.time.ms;
    while (!e.released) {
      const until = e.spec.departAt != null ? e.spec.departAt : e.spec.dwell != null ? arrivedAt + e.spec.dwell * 1000 : Infinity;
      if (this.time.ms >= until) break;
      const waits = [/** @type {any} */ (e).waitPoke()];
      if (Number.isFinite(until)) waits.push(this.until(until));
      await Promise.race(waits);
    }
    e.state = "running";
    await m.depart();
  }

  /**
   * Создать объект поезда по spec (без движения) — префаб props.prefab с Train из spec.
   * @param {TrainSpec} spec
   */
  async spawnObject(spec) {
    const info = spec.info ?? (spec.number ? { number: spec.number } : null);
    return /** @type {Promise<import("../../../engine/index.js").GameObject>} */ (Component.prototype.spawn.call(this, {
      prefab: this.props.prefab,
      name: `Поезд ${spec.number || spec.id}`,
      static: false,
      components: [{ type: "Train", consist: spec.consist ?? "fpk-long", number: spec.number ?? "", info, seed: spec.seed ?? 1 }],
    }));
  }
}
