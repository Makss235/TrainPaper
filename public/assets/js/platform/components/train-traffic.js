// Движение поездов по пути (логика). Две роли:
//
// role "board" — поезд с табло РЖД. Показывается ближайшее событие: прибывший стоит ещё 10 минут,
//   отправляющийся — до минуты после отправления. Когда поезд меняется, текущий уезжает, следующий
//   подходит и тормозит. При загрузке страницы поезд уже стоит. Данные даёт приложение: show(item).
//   arrival/departure: { heading, stop, from, to, ms }
//     heading — куда смотрит голова: 1 — к камере (+z), −1 — к горизонту;
//     stop    — { far: z } дальнего от камеры конца поезда или { near: z } ближнего;
//     from    — с какого расстояния начинается подход (м), to — куда уходит при heading −1 (м);
//     ms      — длительность подхода/ухода.
//
// role "passing" — поезд без остановки (грузовой, транзитный) раз в every секунд.
//
//   { "type": "TrainTraffic", "role": "board", "track": "Путь 1",
//     "arrival": { "heading": 1, "stop": { "far": -7.2 }, "from": 260, "ms": 21000 },
//     "departure": { "heading": 1, "stop": { "far": -7.2 }, "ms": 9000 } }
//   { "type": "TrainTraffic", "role": "passing", "track": "Путь 2", "train": "freight", "heading": -1, "speed": 20, "every": [240, 720] }
// @ts-nocheck
import { Component } from "../../../../engine/index.js";
import { Train } from "../train.js";

const easeIn = t => t * t, easeOut = t => 1 - (1 - t) ** 2;

/** Хвост s для стоящего поезда длины L. */
function stopTail(stop = {}, heading, L) {
  if (stop.near != null) return heading > 0 ? stop.near - L : stop.near;
  const far = stop.far ?? -7.2;
  return heading > 0 ? far : far + L;
}

export class TrainTraffic extends Component {
  static type = "TrainTraffic";
  static doc = "Движение поездов по пути: поезд с табло (board) или проходящий без остановки (passing).";
  /** Каталог составов (assets/data/trains.jsonc) — задаёт приложение. */
  static catalog = null;
  /** Без анимации (скриншоты, скрытая вкладка) — задаёт приложение. */
  static instant = () => false;
  static props = {
    role: { type: "enum", options: ["board", "passing"], default: "board", doc: "board — поезд с табло, passing — проходящий" },
    track: { type: "string", default: "", doc: "Имя объекта-пути (с компонентом RailTrack)" },
    arrival: { type: "object", default: { heading: 1, stop: { far: -7.2 }, from: 260, ms: 21000 }, doc: "Прибытие (board)" },
    departure: { type: "object", default: { heading: 1, stop: { far: -7.2 }, ms: 9000 }, doc: "Отправление (board)" },
    pause: { type: "number", default: 1800, doc: "Пауза между поездами, мс (board)" },
    rules: { type: "array", default: [], doc: "Свои правила выбора состава для этой сцены (как в trains.jsonc)" },
    train: { type: "string", default: "freight", doc: "Состав (passing)" },
    heading: { type: "number", default: -1, doc: "Направление (passing): 1 — к камере, −1 — к горизонту" },
    speed: { type: "number", default: 20, doc: "Скорость (passing), м/с" },
    every: { type: "vec2", default: [240, 720], doc: "Пауза между поездами (passing), с — случайно в диапазоне" },
    first: { type: "number", default: 40, doc: "Через сколько секунд первый поезд (passing)" },
    force: { type: "string", default: "", doc: "Всегда этот состав (для предпросмотра; board)" },
  };

  start() {
    this.trackObj = this.engine.find(this.props.track)?.getComponent("RailTrack");
    if (!this.trackObj) { console.warn(`TrainTraffic «${this.gameObject.name}»: нет пути «${this.props.track}» (объект с RailTrack)`); return; }
    this.pool = new Map();
    this.current = null;
    this.pending = undefined;
    this.busy = false;
    this.first = true;
    this.seed = 1;
    if (this.props.role === "passing") this.#schedule(this.props.first * 1000);
  }

  get camZ() { return this.engine.camera.position.z; }

  async #train(type) {
    if (!this.pool.has(type)) this.pool.set(type, Train.create(this.engine, TrainTraffic.catalog, type));
    const train = await this.pool.get(type);
    if (!train.go.parent) this.engine.scene.add(train.go);
    train.go.setActive(true);
    return train;
  }

  /** Плавно провести хвост от a до b за ms. */
  #move(train, heading, a, b, ms, ease, key = "move") {
    return new Promise(resolve => {
      const t0 = performance.now();
      this.animate(now => {
        const k = Math.min(1, (now - t0) / ms);
        train.place(this.trackObj, a + (b - a) * ease(k), heading);
        if (k >= 1) { resolve(); return false; }
        return true;
      }, undefined, key);
    });
  }

  // ---------- board ----------

  /** Показать поезд табло (или никакой — null). Повторные вызовы во время смены ставятся в очередь. */
  show(item) {
    if (this.props.role !== "board" || !this.trackObj) return;
    this.pending = item;
    this.#run();
  }

  /** Тот же поезд, но табло обновилось (путь назначили, время сдвинулось): только табличка. */
  update(item) {
    if (this.current?.item && item && this.current.item.train.id === item.train.id) {
      this.current.item = item;
      this.current.train.setPlate(item.train);
    }
  }

  async #run() {
    if (this.busy) return;
    this.busy = true;
    const C = TrainTraffic.catalog;
    while (this.pending !== undefined) {
      const next = this.pending;
      this.pending = undefined;
      // первым считается первый настоящий поезд: пока табло грузится, приходит пустое значение
      const quick = TrainTraffic.instant() || (this.first && next);
      const cur = this.current;
      if (cur) {
        if (!quick) {
          const dep = (cur.item?.event === "arrival" ? this.props.arrival : this.props.departure) || {};
          const L = cur.train.length, s0 = cur.train.s;
          // heading +1 — уходит мимо камеры, −1 — к горизонту
          const s1 = cur.heading > 0 ? Math.max(s0 + 1, this.camZ + 14) : s0 - (dep.to ?? 700) - L;
          const dist = Math.abs(s1 - s0);
          await this.#move(cur.train, cur.heading, s0, s1, (dep.ms ?? 9000) * Math.min(3, Math.sqrt(dist / 16)), easeIn);
        }
        cur.train.go.setActive(false);
        this.current = null;
        this.invalidate("scene", "shadow");
      }
      if (!quick && this.props.pause && next) await new Promise(r => setTimeout(r, this.props.pause));
      this.engine.events.emit("trainShown", { traffic: this, item: next });
      if (!next || !C) continue;
      const type = this.props.force || C.typeFor(next.train, this.props.rules);
      const train = await this.#train(type);
      train.setPlate(next.train);
      const spec = (next.event === "arrival" ? this.props.arrival : this.props.departure) || {};
      const heading = spec.heading ?? 1;
      const sStop = stopTail(spec.stop, heading, train.length);
      if (quick) {
        train.place(this.trackObj, sStop, heading);
      } else {
        // подход: heading +1 — из-за горизонта, −1 — из-за спины камеры
        const L = train.length;
        const s0 = heading > 0 ? sStop - L - (spec.from ?? 260) : Math.max(sStop + (spec.from ?? 60), this.camZ + 20 + L);
        train.place(this.trackObj, s0, heading);
        await this.#move(train, heading, s0, sStop, spec.ms ?? 21000, easeOut);
      }
      this.current = { item: next, train, heading };
      this.first = false;
    }
    this.busy = false;
  }

  /** Текущий поезд уезжает и подходит снова (для проверки анимации). */
  replay() {
    this.first = false;
    this.show(this.current?.item ?? null);
  }

  // ---------- passing ----------

  #schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pass(), ms);
  }

  /** Пустить проходящий поезд сейчас. */
  async pass() {
    if (document.hidden) return this.#schedule(30000);
    const { heading, speed, every } = this.props;
    const train = await Train.create(this.engine, TrainTraffic.catalog, this.props.train, { seed: this.seed++ });
    this.engine.scene.add(train.go);
    const L = train.length;
    const s0 = heading > 0 ? -900 - L : this.camZ + 30 + L;
    const s1 = heading > 0 ? this.camZ + 30 : -900;
    await this.#move(train, heading, s0, s1, Math.abs(s1 - s0) / speed * 1000, t => t, "pass");
    train.dispose();
    this.invalidate("scene", "shadow");
    if (this.props.role === "passing") this.#schedule((every[0] + Math.random() * (every[1] - every[0])) * 1000);
  }

  onDestroy() {
    clearTimeout(this.timer);
    this.stopAnimation("move");
    this.stopAnimation("pass");
    for (const p of this.pool?.values() || []) p.then(t => t.dispose());
  }
}
