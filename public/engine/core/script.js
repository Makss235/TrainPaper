// Скрипт — пользовательский компонент из папки скриптов проекта (assets/scripts/). Подключается по соглашению,
// как модель: в данных сцены { "type": "examples/blink" } → файл assets/scripts/examples/blink.js
// (или замена из assets/scripts/index.jsonc: { "aliases": { "blink": "examples/blink.js" } }).
// Файл экспортирует по умолчанию класс-наследник Script (или Component); движок регистрирует его под этим именем,
// в main.js ничего прописывать не нужно.
//
//   // assets/scripts/examples/blink.js
//   import { Script } from "../../../engine/index.js";
//   export default class extends Script {
//     static props = { period: { type: "number", default: 1, min: .1, doc: "Период, с" } };
//     async start() {
//       while (true) { this.object3D.visible = !this.object3D.visible; this.invalidate(); await this.wait(this.props.period / 2); }
//     }
//   }
//
// У скрипта есть всё, что есть у компонента (core/component.js): update(dt), this.wait/every/at/tween,
// this.find, this.spawn, this.on/emit, this.log/warn, свойства-ссылки (ref, component), static actions для инспектора.
// @ts-check
import { Component } from "./component.js";

export class Script extends Component {
  /** Имя типа: для скрипта из файла — путь без .js ("examples/blink"), его ставит движок при загрузке. */
  static type = "Script";
  static category = "Скрипт";
  /** Адрес файла скрипта (для перезагрузки в инспекторе) — ставит движок. */
  static source = "";
}
