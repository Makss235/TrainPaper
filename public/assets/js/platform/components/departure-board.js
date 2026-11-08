// Табло поездов: текст из данных РЖД на экране HtmlScreen того же объекта (элемент #board).
// Приложение вызывает update() раз в секунду и при смене поезда.
// @ts-nocheck
import { Component } from "../../../../engine/index.js";
import { updateBoard } from "../board.js";

export class DepartureBoard extends Component {
  static type = "DepartureBoard";
  static doc = "Табло поездов РЖД: показывает ближайший поезд, время, путь, опоздание и бегущую строку (на HtmlScreen объекта).";
  static props = {};

  /** @param {number} now @param {any} item @param {any[]} list @param {any} info */
  update(now, item, list, info) {
    if (this.gameObject.activeInHierarchy) updateBoard(now, item, list, info);
  }
}
