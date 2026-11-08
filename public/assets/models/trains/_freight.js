// Общие детали грузовых вагонов-примитивов: рама, сцепки, тележки.
import { bogie } from "./_parts.js";

export const FREIGHT_BOTTOM = 1.2;

export function freightFrame(kit, g, L) {
  g.add(kit.boxFrom([-1.45, 1.45], [FREIGHT_BOTTOM - .32, FREIGHT_BOTTOM], [.25, L - .25], { color: "under" }));
  for (const [z0, z1] of [[-.35, .25], [L - .25, L + .35]]) g.add(kit.boxFrom([-.16, .16], [1.0, 1.16], [z0, z1], { color: "frame" }));
  for (const z of [2.1, L - 2.1]) bogie(kit, g, z, { wheelbase: 1.85, top: FREIGHT_BOTTOM - .35 });
}

/** Узор рёбер на боковых стенках: шаг в метрах → в единицах u грани коробки (0…1 по длине). */
export const ribs = (length, step, width, color, strength = .35) => ({ type: "stripes", step: step / length, width: width / length, strength, color });
