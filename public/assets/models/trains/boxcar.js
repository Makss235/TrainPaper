// Крытый грузовой вагон — примитивы: коробка с рёбрами (узор, без ряби вдали), крыша, двери.
import { FREIGHT_BOTTOM, freightFrame, ribs } from "./_freight.js";

const L = 14.7, TOP = 4.35;

export default {
  name: "Крытый вагон (примитивы)",
  meta: { length: L, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build(p, kit) {
    const g = kit.group();
    freightFrame(kit, g, L);
    g.add(kit.boxFrom([-1.55, 1.55], [FREIGHT_BOTTOM, TOP], [.15, L - .15], { color: "#7b3e30", material: { pattern: ribs(L - .3, .62, .1, "#5a2a20") } }));
    g.add(kit.boxFrom([-1.6, 1.6], [TOP, TOP + .35], [.1, L - .1], { color: "#8a8f94" }));
    for (const s of [-1, 1]) g.add(kit.boxFrom(s < 0 ? [-1.6, -1.55] : [1.55, 1.6], [FREIGHT_BOTTOM + .1, TOP - .2], [L / 2 - 1.95, L / 2 + 1.95], { color: "#6e3428" }));
    return g;
  },
};
