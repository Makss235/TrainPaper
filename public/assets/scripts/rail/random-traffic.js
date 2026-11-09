// Случайное движение — скрипт-генератор проходящих поездов (бывшая роль passing): раз в every секунд
// (случайно в диапазоне, по часам симуляции) пускает поезд без остановки по одному из путей.
//
//   { "type": "rail/random-traffic", "consists": ["freight"], "tracks": ["Путь 2"], "every": [240, 720], "speed": [15, 25] }
//
// direction: 1 или −1 — куда идут поезда по пути (к росту s или обратно), 0 — случайно.
// Поезда ведёт TrainManager сцены: на занятом пути следующий ждёт в очереди.
// @ts-check
import { Script } from "../../../engine/index.js";

export default class RandomTraffic extends Script {
  static doc = "Случайные проходящие поезда: раз в every секунд (по часам симуляции) — состав из consists по пути из tracks.";
  static props = {
    consists: { type: "array", default: ["freight"], doc: "Составы (имена из каталога trains.jsonc)" },
    tracks: { type: "array", default: ["Путь 2"], doc: "Пути (имена объектов с Track)" },
    every: { type: "vec2", default: [240, 720], doc: "Пауза между поездами, с — случайно в диапазоне" },
    speed: { type: "vec2", default: [15, 25], doc: "Скорость, м/с — случайно в диапазоне" },
    direction: { type: "number", default: 1, doc: "1 — к росту s пути, −1 — обратно, 0 — случайно" },
    first: { type: "number", default: 40, min: 0, doc: "Через сколько секунд первый поезд" },
    manager: { type: "component", component: "TrainManager", default: null, doc: "Менеджер поездов (по умолчанию — первый в сцене)" },
  };
  static actions = { "Пустить поезд": "send" };
  count = 0;

  async start() {
    await this.wait(this.props.first);
    while (true) {
      this.send();
      const [a, b] = this.props.every;
      await this.wait(a + Math.random() * (b - a));
    }
  }

  /** Пустить проходящий поезд сейчас. */
  send() {
    const p = this.props;
    const manager = /** @type {any} */ (p.manager ?? this.engine.scene.findComponent("TrainManager"));
    if (!manager) { this.warn("нет TrainManager в сцене"); return; }
    const pick = (/** @type {any[]} */ list) => list[Math.floor(Math.random() * list.length)];
    const dir = p.direction || (Math.random() < .5 ? -1 : 1);
    const seed = 1 + Math.floor(Math.random() * 1e6);
    manager.spawn({
      id: `${this.gameObject.name}-${++this.count}`, consist: pick(p.consists), seed,
      track: pick(p.tracks), action: "pass", dir,
      speed: p.speed[0] + Math.random() * (p.speed[1] - p.speed[0]),
    });
  }
}
