// @ts-check
// Полувагон — примитивы: открытый кузов из четырёх стенок с рёбрами.
import { FREIGHT_BOTTOM, freightFrame, ribs } from "./_freight.js";

const L = 13.9, TOP = 3.25;

export default {
  name: "Полувагон (примитивы)",
  meta: { length: L, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build(p, kit) {
    const g = kit.group();
    freightFrame(kit, g, L);
    for (const x of [[-1.58, -1.5], [1.5, 1.58]]) g.add(kit.boxFrom(x, [FREIGHT_BOTTOM, TOP], [.1, L - .1], { color: "#5d6b4b", material: { pattern: ribs(L - .2, 1.15, .12, "#465237", .4) } }));
    for (const z of [[.1, .18], [L - .18, L - .1]]) g.add(kit.boxFrom([-1.5, 1.5], [FREIGHT_BOTTOM, TOP], z, { color: "#4f5a40" }));
    g.add(kit.boxFrom([-1.5, 1.5], [FREIGHT_BOTTOM, FREIGHT_BOTTOM + .1], [.18, L - .18], { color: "#3c4432" }));
    return g;
  },
};
