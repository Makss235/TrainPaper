// Мигалка — пример скрипта: объект включается и выключается с периодом period (секунды симуляции).
// В сцене: { "name": "Мигалка", "components": [ { "type": "examples/blink", "period": 0.8 } ] }
// Таймеры идут по часам симуляции: в режиме «сутки за минуту» (engine.time.scale = 1440) мигает в 1440 раз чаще.
// @ts-check
import { Script } from "../../../engine/index.js";

export default class Blink extends Script {
  static doc = "Мигает объектом: включает и выключает его с периодом period (по часам симуляции).";
  static props = { period: { type: "number", default: 1, min: .1, doc: "Период, с" } };
  static actions = { "Мигнуть сейчас": "toggle" };
  /** Сколько раз переключился (для проверки) */
  count = 0;

  async start() {
    while (true) {
      this.toggle();
      await this.wait(this.props.period / 2);
    }
  }

  toggle() {
    this.gameObject.setActive(!this.gameObject.active);
    this.count++;
  }
}
