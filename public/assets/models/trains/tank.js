// @ts-check
// Цистерна — примитивы: цилиндр котла, колпак, мостик.
import { FREIGHT_BOTTOM, freightFrame } from "./_freight.js";

const L = 12.1, R = 1.45;

export default {
  name: "Цистерна (примитивы)",
  meta: { length: L, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build(p, kit) {
    const g = kit.group(), cy = FREIGHT_BOTTOM + R + .05;
    freightFrame(kit, g, L);
    g.add(kit.cylinder(R, L - .6, { at: [0, cy, L / 2], rotation: [90, 0, 0], color: "#2f3236", segments: 14 }));
    g.add(kit.cylinder(.42, .45, { at: [0, cy + R - .05, L / 2], pivot: "bottom", color: "#3a3e43", segments: 10 }));
    g.add(kit.boxFrom([-.35, .35], [cy + R - .05, cy + R + .02], [.8, L - .8], { color: "#565b61" }));
    return g;
  },
};
