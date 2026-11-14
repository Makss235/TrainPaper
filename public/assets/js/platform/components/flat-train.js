// Поезд 2D-сцены «Вагон»: объект со спрайтами вагонов (дочерние объекты), который ездит вдоль x.
// Сменился поезд у платформы — прежний уезжает вправо (разгоняясь); следующий въезжает в кадр слева целиком,
// начиная с головы состава, и тормозит, пока торец хвостового вагона не встанет в начало объекта (x из данных сцены).
// Расстояние подхода (arrive) должно быть больше длины состава плюс ширина кадра: тогда в начале подхода поезда
// в кадре ещё нет — он не возникает из ниоткуда. Маршрутную табличку в окне
// (объект со Sprite, свойство plate) рисует сам: маршрут, номер поезда, путь.
//
//   { "name": "Поезд", "static": false, "position": [0, 0.95, 0], "components": [{ "type": "FlatTrain", "plate": "Табличка" }],
//     "children": [ ...спрайты вагонов..., { "name": "Табличка", "components": [{ "type": "Sprite", "size": [0.9, 0.36] }] } ] }
//
// Приложение вызывает show(элемент табло) при каждой смене поезда; событие "flatTrain" движка — когда поезд сменился
// на экране (прежний уже уехал): по нему обновляется панель с информацией.
// @ts-check
import { Component } from "../../../../engine/index.js";
import { Plate } from "../plate.js";

export class FlatTrain extends Component {
  static type = "FlatTrain";
  static doc = "Поезд 2D-сцены: спрайты вагонов уезжают вправо и подходят слева при смене поезда; рисует маршрутную табличку.";
  static props = {
    plate: { type: "ref", default: null, doc: "Объект со Sprite — маршрутная табличка в окне" },
    depart: { type: "number", default: 36, min: 1, doc: "На сколько метров уезжает уходящий поезд (хвост должен скрыться за краем кадра)" },
    arrive: { type: "number", default: 150, min: 1, doc: "С какого расстояния подходит следующий, м: больше длины состава плюс ширина кадра — тогда он въезжает из-за края" },
    departTime: { type: "number", default: 6, min: .1, doc: "Сколько секунд уезжает" },
    arriveTime: { type: "number", default: 19, min: .1, doc: "Сколько секунд подходит (тормозя до остановки)" },
  };

  /** Элемент табло, поезд которого сейчас на экране (или null) @type {any} */
  shown = null;
  present = false;
  busy = false;
  /** @type {any} следующий поезд в очереди (undefined — очереди нет) */
  pending = undefined;
  instant = false;
  /** @type {Plate | null} */
  plateTexture = null;
  home = [0, 0, 0];

  start() {
    this.home = this.object3D.position.toArray();
    this.plateTexture = new Plate();
    /** @type {any} */ (this.props.plate)?.getComponent("Sprite")?.setTexture(this.plateTexture.texture);
    this.#place(0, false);
  }

  onDestroy() {
    this.plateTexture?.dispose();
  }

  /**
   * Показать поезд (элемент табло или null — поездов нет). instant — без движения (первая загрузка, скрытая вкладка).
   * @param {any} item @param {{instant?: boolean}} [o]
   */
  show(item, { instant = false } = {}) {
    // тот же поезд, обновились данные (время, опоздание) — только табличка
    if (item && this.shown && item.train.id === this.shown.train.id && this.pending === undefined) {
      this.shown = item;
      this.plateTexture?.set(item.train);
      this.invalidate();
      return;
    }
    this.pending = item ?? null;
    this.instant = instant;
    this.#run().catch(error => { if (error?.name !== "CancelledError") console.error("FlatTrain:", error); });
  }

  async #run() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending !== undefined) {
        const next = this.pending, quick = this.instant || this.engine.options.animate === false;
        this.pending = undefined;
        const p = this.props;
        if (this.present && !quick) await this.#move(0, p.depart, p.departTime, "inCubic");
        this.shown = next;
        this.plateTexture?.set(next?.train ?? null);
        this.engine.events.emit("flatTrain", { source: this, item: next });
        if (!next) { this.#place(0, false); continue; }
        if (quick) this.#place(0, true);
        else await this.#move(-p.arrive, 0, p.arriveTime, "outQuad");
      }
    } finally {
      this.busy = false;
    }
  }

  /** @param {number} offset  метров от места стоянки (+ — вправо) @param {boolean} present */
  #place(offset, present) {
    this.present = present;
    this.object3D.visible = present;
    this.gameObject.setPosition(this.home[0] + offset, this.home[1], this.home[2]);
  }

  /** @param {number} from @param {number} to @param {number} seconds @param {string} ease */
  #move(from, to, seconds, ease) {
    this.#place(from, true);
    return this.tween({ from, to, duration: seconds, ease, realTime: true, onUpdate: (/** @type {number} */ v) => this.#place(v, true) });
  }
}
