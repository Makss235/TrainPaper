// Огни поезда — компонент TrainLights (на объекте с Train). Включает фары ("head-…") у головного вагона
// и хвостовые огни с заглушкой перехода ("tail-…") у хвостового; у остальных вагонов они выключены.
// Ночью свет из окон ложится на платформу: setPlatform(platform, dir) ставит на вагоны пятна GroundGlow
// по meta.windowSpill (TrainMotion вызывает это сам, когда поезд подходит к StopPoint с платформой).
// В rail/ нет ни одного меша и шейдера: огни — Glow, пятна — GroundGlow (компоненты движка).
// @ts-check
import { Component } from "../../../engine/index.js";

export class TrainLights extends Component {
  static type = "TrainLights";
  static category = "Железная дорога";
  static doc = "Огни поезда: фары у головного вагона, хвостовые у хвостового; свет из окон на платформу (GroundGlow) у остановки.";
  static props = {
    spill: { type: "boolean", default: true, doc: "Свет из окон на платформу ночью" },
    spillColor: { type: "color", default: [.27, .21, .13], doc: "Цвет света из окон" },
  };

  start() {
    this.on("built", () => this.apply());
    this.apply();
  }

  /** @returns {import("./train.js").Train | undefined} */
  get train() { return this.gameObject.getComponent("Train"); }

  /** Включить огни по положению вагонов в составе. */
  apply() {
    const train = this.train;
    if (!train?.built) return;
    const cars = train.cars, last = cars.length - 1;
    cars.forEach((car, i) => {
      for (const c of car.go.components) {
        const key = c.key || "";
        if (key.startsWith("tail-")) c.setEnabled(i === 0);
        else if (key.startsWith("head-")) c.setEnabled(i === last);
      }
    });
    if (this.platform !== undefined) this.setPlatform(this.platform, this.dir);
  }

  /**
   * Свет из окон на платформу: platform — { top, edge, side } (StopPoint.platform) или null — убрать.
   * dir — куда идёт поезд по пути (+1 — к росту s): от этого зависит, с какого борта вагона платформа.
   * @param {{top: number, edge: number, side?: string} | null} platform @param {number} [dir]
   */
  setPlatform(platform, dir = 1) {
    /** @type {{top: number, edge: number, side?: string} | null | undefined} */
    this.platform = platform;
    this.dir = dir;
    const train = this.train;
    if (!train?.built) return;
    for (const car of train.cars) {
      const glow = car.go.getComponents("GroundGlow").find(c => c.key === "spill");
      const spans = /** @type {number[][]} */ (car.meta.windowSpill || []);
      if (!platform || !this.props.spill || !spans.length) { glow?.setEnabled(false); continue; }
      // ось вагона — ось пути; локальная +x вагона — левый борт по ходу. Платформа слева от пути (к росту s)
      // при движении к росту s — со стороны +x вагона, при обратном — со стороны −x
      const side = (platform.side === "right" ? -1 : 1) * Math.sign(dir || 1);
      const edge = side * platform.edge, x0 = edge + side * 1.5;
      const L = car.z1 - car.z0;
      const rects = spans.map(([a, b]) => {
        // окна заданы от торца z = 0 вагона; у развёрнутого — зеркально по длине
        const za = car.flip ? L - b : a, zb = car.flip ? L - a : b;
        return [Math.min(edge, x0), za - .45, Math.max(edge, x0), zb + .45];
      });
      const props = { rects, height: platform.top + .015, color: this.props.spillColor, mode: "night" };
      if (glow) { glow.set(props); glow.setEnabled(true); } else car.go.addComponent("GroundGlow", props).key = "spill";
    }
  }
}
