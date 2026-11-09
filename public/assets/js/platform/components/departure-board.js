// Табло поездов: текст из данных РЖД на экране HtmlScreen того же объекта (элемент #board).
// Какой поезд показать — тот, что сейчас у платформы или подходит к ней: его даёт источник расписания
// RzdBoard (rail/sources/rzd-board.js) через Schedule и TrainManager. Приложение вызывает refresh() раз
// в секунду (обратный отсчёт, часы) и при обновлении табло.
// @ts-check
import { Component } from "../../../../engine/index.js";
import { updateBoard } from "../board.js";

export class DepartureBoard extends Component {
  static type = "DepartureBoard";
  static doc = "Табло поездов РЖД: поезд у платформы (из RzdBoard), время, путь, опоздание и бегущая строка (на HtmlScreen объекта).";
  static props = {
    source: { type: "component", component: "RzdBoard", default: null, doc: "Источник (по умолчанию — первый RzdBoard в сцене)" },
  };

  /** Поезд, который сейчас показывает сцена (элемент табло) или null. */
  get item() {
    const src = this.props.source ?? this.engine.scene.findComponent("RzdBoard");
    return /** @type {any} */ (src)?.shown ?? null;
  }

  /** @param {number} now @param {any[]} list @param {any} info */
  refresh(now, list, info) {
    if (this.gameObject.activeInHierarchy) updateBoard(now, this.item, list, info);
  }
}
