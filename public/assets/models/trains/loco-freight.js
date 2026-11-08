// Секция грузового электровоза — примитивы: серый кузов с красной полосой, кабина у z = length.
// Двухсекционный локомотив в составе: "trains/loco-freight", "trains/loco-freight:flip".
import { bogie } from "./_parts.js";

const L = 17.4, HALF = 1.56, BOTTOM = 1.05, TOP = 4.05;

export default {
  name: "Электровоз грузовой, секция (примитивы)",
  meta: {
    length: L, gap: .9,
    tailLights: [[-1.0, 1.55], [1.0, 1.55]],
    headLights: [[-1.1, 1.6, L + .08], [1.1, 1.6, L + .08], [0, 4.15, L - .4]],
  },
  build(p, kit) {
    const g = kit.group();
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, L - .45], { color: "#8a9096" }));
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, 2.7], [L - .45, L], { color: "#d8d9d6" }));
    g.add(kit.box([HALF * 2, 1.4, .22], { at: [0, 3.35, L - .25], rotation: [-17, 0, 0], color: "#ffffff", material: { glass: true, glassShade: .55 } }));
    g.add(kit.boxFrom([-HALF + .25, HALF - .25], [TOP, TOP + .44], [.4, L - .7], { color: "#5c6268" }));
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.65], [0, L], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.65, 2.05], [0, L], { color: "red" }));
    for (const s of [-1, 1]) {
      g.add(kit.boxFrom(s < 0 ? [-HALF - .02, -HALF] : [HALF, HALF + .02], [2.9, 3.6], [L - 2.3, L - 1.0], { color: "#ffffff", material: { glass: true, glassShade: .45 } }));
    }
    g.add(kit.boxFrom([-1.45, 1.45], [.45, BOTTOM], [.6, L - .6], { color: "under" }));
    bogie(kit, g, 3.8, { wheelbase: 2.9 });
    bogie(kit, g, L - 3.8, { wheelbase: 2.9 });
    return g;
  },
};
