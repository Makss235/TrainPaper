// @ts-check
// Промежуточный вагон скоростного электропоезда — примитивы.
const L = 25, HALF = 1.6, BOTTOM = 1.05, TOP = 3.95;
const BANDS = [[.6, 3.45], [5.05, L - 5.05], [L - 3.45, L - .6]];

export default {
  name: "Электропоезд, промежуточный (примитивы)",
  meta: {
    length: L, gap: .5,
    gangway: { half: .7, y: [1.3, 3.7] },
    tailLights: [[-1.0, 1.5], [1.0, 1.5]],
    windowSpill: BANDS,
  },
  build(p, kit) {
    const g = kit.group();
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, L], { color: "#e6e8e9" }));
    g.add(kit.boxFrom([-1.3, 1.3], [TOP, TOP + .7], [.1, L - .1], { color: "#c9ccce" }));
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.32], [0, L], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.32, 1.62], [0, L], { color: "red" }));
    for (const s of [-1, 1]) {
      const x = s < 0 ? [-HALF - .025, -HALF - .005] : [HALF + .005, HALF + .025];
      for (const [z0, z1] of BANDS) g.add(kit.boxFrom(x, [2.08, 2.86], [z0, z1], { color: "#ffffff", material: { glass: true, glassShade: .5 } }));
      for (const z of [3.6, L - 4.9]) g.add(kit.boxFrom(s < 0 ? [-HALF - .015, -HALF] : [HALF, HALF + .015], [1.12, 3.55], [z, z + 1.3], { color: "red" }));
    }
    g.add(kit.boxFrom([-HALF + .05, HALF - .05], [BOTTOM, TOP], [-.02, 0], { color: "#3b4046" }));
    g.add(kit.boxFrom([-HALF + .05, HALF - .05], [BOTTOM, TOP], [L, L + .02], { color: "#3b4046" }));
    g.add(kit.boxFrom([-1.45, 1.45], [.45, BOTTOM], [.6, L - .6], { color: "under" }));
    for (const z of [3.2, L - 3.2]) {
      g.add(kit.boxFrom([-1.15, 1.15], [.42, .85], [z - 1.4, z + 1.4], { color: "under" }));
      for (const dz of [-1.2, 1.2]) for (const x of [-.8, .8]) g.add(kit.cylinder(.42, .13, { at: [x, .42, z + dz], rotation: [0, 0, 90], color: "frame" }));
    }
    return g;
  },
};
