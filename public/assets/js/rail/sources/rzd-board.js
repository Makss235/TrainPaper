// Табло РЖД через расписание — компонент RzdBoard. Приложение отдаёт ему данные онлайн-табло (текущий поезд
// и список), он превращает их в строки расписания для Schedule. Поведение как у прежнего «поезда с табло»:
// показывается ближайшее событие табло (прибывший стоит ещё 10 минут, отправляющийся — до минуты после
// отправления: это решает выбор текущего поезда в lib/trains.js); когда поезд меняется, текущий уезжает,
// следующий подходит и тормозит; при загрузке страницы поезд уже стоит.
//
//   { "name": "Табло РЖД", "components": [
//     { "type": "RzdBoard", "schedule": "Движение", "track": "Путь 1",
//       "arrival":   { "stop": "Платформа 1", "direction": -1 },     // откуда и куда подходит прибывающий
//       "departure": { "stop": "Платформа 1", "direction": -1 } } ] }  // как стоит и куда уходит отправляющийся
//
// Тупиковый вокзал: у отправления своя точка остановки и обратное направление
//   "departure": { "stop": "Отправление", "direction": 1 }.
// Состав по номеру поезда — правила каталога (assets/data/trains.jsonc) и свои правила сцены rules; force — всегда этот состав.
// @ts-check
import { Component } from "../../../../engine/index.js";
import { Train } from "../train.js";

export class RzdBoard extends Component {
  static type = "RzdBoard";
  static category = "Железная дорога";
  static doc = "Табло РЖД → расписание: поезд с табло подходит, стоит и уходит; при загрузке страницы уже стоит.";
  static props = {
    schedule: { type: "component", component: "Schedule", default: null, doc: "Расписание (по умолчанию — первое в сцене)" },
    track: { type: "string", default: "Путь 1", doc: "Путь поездов с табло" },
    arrival: { type: "object", default: { stop: "", direction: -1 }, doc: "Прибытие: { stop, direction, approach, speed }" },
    departure: { type: "object", default: { stop: "", direction: -1 }, doc: "Отправление: { stop, direction, approach, speed }" },
    rules: { type: "array", default: [], doc: "Свои правила выбора состава для этой сцены (как в trains.jsonc)" },
    force: { type: "string", default: "", doc: "Всегда этот состав (для предпросмотра)" },
    motion: { type: "object", default: null, doc: "Свои maxSpeed / accel / brake поездов табло" },
  };

  /** @type {any} элемент табло, чей поезд сейчас у платформы (или подходит) */
  shown = null;
  /** @type {any} текущий элемент табло */
  current = null;
  /** @type {Record<string, any>[]} */
  rows = [];
  first = true;
  /** счётчик повторов (replay): у повторного поезда свой id, чтобы уходящий не исчез сразу */
  run = 0;
  /** @type {any} Schedule */
  schedule = null;

  start() {
    this.schedule = this.props.schedule ?? this.engine.scene.findComponent("Schedule") ?? null;
    if (!this.schedule) { this.warn("нет Schedule в сцене"); return; }
    this.schedule.setSource(() => this.rows);
    // что показывать на табло — поезд, который появился на пути (или null, когда ушёл последний)
    this.on(this.engine, "trainSpawned", (/** @type {any} */ e) => {
      if (!e.spec.item || !this.#mine(e)) return;
      this.#show(e.spec.item);
    });
    this.on(this.engine, "trainRemoved", (/** @type {any} */ e) => {
      if (!this.#mine(e) || this.shown?.train.id !== e.spec.item?.train.id) return;
      if (!this.current) this.#show(null);
    });
  }

  /** @param {any} e */
  #mine(e) { return String(e.id).startsWith("rzd:"); }

  /** @param {any} item */
  #show(item) {
    this.shown = item;
    this.engine.events.emit("trainShown", { source: this, item });
  }

  /**
   * Данные табло (приложение вызывает при каждом обновлении).
   * @param {any} current  ближайшее событие табло (lib/trains.js pickCurrent) или null
   * @param {{instant?: boolean}} [o]  instant — без анимации: поезд сразу стоит (скриншоты, скрытая вкладка)
   */
  setBoard(current, { instant = false } = {}) {
    if (!this.schedule) { this.current = current; return; }
    const prev = this.current, same = prev && current && prev.train.id === current.train.id;
    this.current = current;
    if (same) {
      // тот же поезд, табло обновилось (путь назначили, время сдвинулось) — только табличка
      const row = this.rows[0];
      if (row) this.rows = [{ ...row, info: current.train, item: current }];
      if (this.shown?.train.id === current.train.id) this.shown = current;
    } else {
      const quick = instant || (this.first && !!current);
      if (quick && prev) this.schedule.manager?.remove(this.#id(prev));
      this.rows = current ? [this.#row(current, quick ? "standing" : "now")] : [];
      if (!current && !prev) this.#show(null);
    }
    if (current) this.first = false;
    this.schedule.refresh();
  }

  /** Текущий поезд уезжает и подходит снова (проверка анимации в инспекторе). */
  replay() {
    if (!this.current || !this.schedule) return;
    this.rows = [];
    this.schedule.refresh();
    this.run++;
    this.rows = [this.#row(this.current, "now")];
    this.schedule.refresh();
  }

  /** @param {any} item */
  #id(item) { return `rzd:${item.train.id}${this.run ? `#${this.run}` : ""}`; }

  /** Строка расписания для элемента табло. @param {any} item @param {"standing" | "now"} enter */
  #row(item, enter) {
    const spec = (item.event === "arrival" ? this.props.arrival : this.props.departure) || {};
    const consist = this.props.force || Train.catalog.typeFor(item.train, this.props.rules);
    return {
      id: this.#id(item), number: item.train.number, consist, info: item.train, item,
      track: spec.track || this.props.track, stop: spec.stop, direction: spec.direction ?? -1,
      action: "stop", enter, depart: null, approach: spec.approach, speed: spec.speed, motion: this.props.motion ?? undefined,
    };
  }
}
