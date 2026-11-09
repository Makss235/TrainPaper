// @ts-check
// Сопки на горизонте: пологие конусы, дальние гряды светлее и тонут в дымке.
export default {
  name: "Сопки",
  params: {
    seed: { type: "number", default: 3, doc: "Зерно случайности" },
    ridges: {
      type: "array",
      default: [{ z: -2400, height: [80, 240], color: "hills", haze: .6, count: 9 }],
      doc: "Гряды: [{ z, height: [мин, макс], color, haze, count }]",
    },
    width: { type: "number", default: 9000, doc: "Ширина полосы сопок, м" },
  },
  build(p, kit) {
    const g = kit.group(), random = kit.rng(p.seed);
    for (const r of p.ridges) {
      const n = r.count ?? 9;
      for (let i = 0; i < n; i++) {
        const h = r.height[0] + random() * (r.height[1] - r.height[0]);
        const x = -p.width / 2 + (i + .5 + (random() - .5) * .6) * p.width / n;
        g.add(kit.cone(h * (2.2 + random()), h, { at: [x, -.5, r.z - random() * 300], pivot: "bottom", color: r.color ?? "hills",
          segments: 7, material: { haze: r.haze ?? .7, receive: false, snow: true } }));
      }
    }
    return g;
  },
};
