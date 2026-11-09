// @ts-check
// Головной вагон скоростного электропоезда — примитивы: светлый кузов, тёмная лента окон,
// красный низ, нос — ступенчатый клин с лобовым стеклом у z = length.
// В составе голова ставится в начале и развёрнутой в конце: "trains/emu-head", …, "trains/emu-head:flip".
const L = 26.2, HALF = 1.6, BOTTOM = 1.05, TOP = 3.95, NOSE = 5.4;

export default {
  name: "Электропоезд, головной (примитивы)",
  meta: {
    length: L, gap: .5,
    gangway: { half: .7, y: [1.3, 3.7] },
    tailLights: [[-1.0, 1.5], [1.0, 1.5]],
    headLights: [[-.6, 1.6, L + .06], [.6, 1.6, L + .06]],
    windowSpill: [[.6, 3.45], [5.05, L - 9.35], [L - 7.75, L - NOSE - .2]],
    cab: true,                                   // кабина: у хвоста не ставится заглушка перехода
  },
  build(p, kit) {
    const g = kit.group(), B = L - NOSE;
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, B], { color: "#e6e8e9" }));
    g.add(kit.boxFrom([-1.3, 1.3], [TOP, TOP + .7], [.1, B], { color: "#c9ccce" }));
    // нос: нижний блок, средний, наклонное лобовое стекло
    g.add(kit.boxFrom([-HALF + .15, HALF - .15], [BOTTOM, 2.2], [B, L], { color: "red" }));
    g.add(kit.boxFrom([-HALF + .05, HALF - .05], [2.2, TOP], [B, B + 2.2], { color: "#e6e8e9" }));
    g.add(kit.box([HALF * 2 - .3, 2.4, .25], { at: [0, 2.95, B + 3.1], rotation: [-38, 0, 0], color: "#ffffff", material: { glass: true, glassShade: .7 } }));
    // лента окон, красная полоса и тёмный низ по бортам
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.32], [0, B], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.32, 1.62], [0, B], { color: "red" }));
    for (const s of [-1, 1]) {
      const x = s < 0 ? [-HALF - .025, -HALF - .005] : [HALF + .005, HALF + .025];
      for (const [z0, z1] of [[.6, 3.45], [5.05, L - 9.35], [L - 7.75, B - .2]]) {
        g.add(kit.boxFrom(x, [2.08, 2.86], [z0, z1], { color: "#ffffff", material: { glass: true, glassShade: .5 } }));
      }
      for (const z of [3.6, L - 9.2]) g.add(kit.boxFrom(s < 0 ? [-HALF - .015, -HALF] : [HALF, HALF + .015], [1.12, 3.55], [z, z + 1.3], { color: "red" }));
    }
    g.add(kit.boxFrom([-1.45, 1.45], [.45, BOTTOM], [.6, L - 1], { color: "under" }));
    for (const z of [3.2, L - 7.6]) {
      g.add(kit.boxFrom([-1.15, 1.15], [.42, .85], [z - 1.4, z + 1.4], { color: "under" }));
      for (const dz of [-1.2, 1.2]) for (const x of [-.8, .8]) g.add(kit.cylinder(.42, .13, { at: [x, .42, z + dz], rotation: [0, 0, 90], color: "frame" }));
    }
    return g;
  },
};
