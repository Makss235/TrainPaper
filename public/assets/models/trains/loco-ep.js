// Пассажирский электровоз — примитивы: красный кузов, светлая полоса, тёмный низ, кабина с лобовым
// стеклом у переднего торца (z = length), пантографы на крыше. Детальная версия — examples/trains/loco-ep.js.
import { bogie } from "./_parts.js";

const L = 19.6, HALF = 1.58, BOTTOM = 1.0, TOP = 4.0;

export default {
  name: "Электровоз пассажирский (примитивы)",
  meta: {
    length: L, gap: .9,
    tailLights: [[-1.05, 1.5], [1.05, 1.5]],
    headLights: [[-1.13, 1.55, L + .08], [1.13, 1.55, L + .08], [0, 4.1, L - .55]],   // фары (x, y, z)
  },
  build(p, kit) {
    const g = kit.group();
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, L - .6], { color: "red" }));
    // кабина: низ до лобового стекла и наклонное стекло
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, 2.6], [L - .6, L], { color: "red" }));
    g.add(kit.box([HALF * 2, 1.55, .25], { at: [0, 3.3, L - .35], rotation: [-21, 0, 0], color: "#ffffff", material: { glass: true, glassShade: .55 } }));
    g.add(kit.boxFrom([-HALF + .3, HALF - .3], [TOP, TOP + .5], [.4, L - .9], { color: [.78, .08, .08] }));
    // полосы по борту
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.62], [0, L], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.62, 1.86], [0, L - 3], { color: "#c9cbce" }));
    // окна кабины на бортах и жалюзи
    for (const s of [-1, 1]) {
      g.add(kit.boxFrom(s < 0 ? [-HALF - .02, -HALF] : [HALF, HALF + .02], [2.85, 3.62], [L - 2.45, L - 1.05], { color: "#ffffff", material: { glass: true, glassShade: .45 } }));
      for (let z = 4.4; z < 14.6; z += 1.45) g.add(kit.boxFrom(s < 0 ? [-HALF - .015, -HALF] : [HALF, HALF + .015], [2.85, 3.6], [z, z + .95], { color: "#a81414" }));
    }
    // буферный брус, сцепка, рама, тележки
    g.add(kit.boxFrom([-HALF + .1, HALF - .1], [BOTTOM - .05, BOTTOM + .32], [L, L + .18], { color: "band" }));
    g.add(kit.boxFrom([-1.45, 1.45], [.45, BOTTOM], [.6, L - .6], { color: "under" }));
    bogie(kit, g, 4.2, { wheelbase: 2.9 });
    bogie(kit, g, L - 4.2, { wheelbase: 2.9 });
    // пантографы: передний поднят к контактному проводу (6 м над рельсом)
    const lines = kit.lines(), top = TOP + .5;
    for (const [zc, raised] of [[6.2, false], [13.4, true]]) {
      const h = raised ? 5.98 : top + .45;
      lines.add([-.6, top + .22, zc - .6], [.6, top + .22, zc - .6], .06, "steel");
      lines.add([-.6, top + .22, zc + .6], [.6, top + .22, zc + .6], .06, "steel");
      for (const x of [-.3, .3]) {
        const knee = raised ? [x, (top + h) / 2 + .2, zc - 1.1] : [x, top + .32, zc - 1.4];
        lines.add([x, top + .25, zc + .5], knee, .05, "steel");
        lines.add(knee, [x * .4, h, zc], .04, "steel");
      }
      lines.add([-.95, h, zc], [.95, h, zc], .05, "frame");
    }
    g.add(lines.build());
    return g;
  },
};
