// Дерево: ствол-цилиндр и крона из шаров (тон в две полосы — освещённая сторона и тень).
// Начало координат — основание ствола. Ряды деревьев — повтором в сцене (repeat с jitter).
export default {
  name: "Дерево",
  params: {
    trunk: { type: "number", default: 4.8, doc: "Высота ствола до кроны, м" },
    crown: { type: "number", default: 3.6, doc: "Радиус кроны, м" },
    color: { type: "color", default: "tree1", doc: "Цвет кроны" },
    lumps: { type: "number", default: 3, doc: "Сколько шаров в кроне (1 — один шар)" },
    seed: { type: "number", default: 1, doc: "Зерно: форма кроны" },
  },
  meta: { blocksRain: true },
  build(p, kit) {
    const g = kit.group(), random = kit.rng(p.seed), r = p.crown;
    g.add(kit.cylinder(.24, p.trunk + r * .3, { at: [0, 0, 0], pivot: "bottom", color: "trunk", segments: 6 }));
    g.add(kit.sphere(r * .95, { at: [0, p.trunk + r * .5, 0], color: p.color }));
    for (let i = 1; i < p.lumps; i++) {
      const rr = r * (.5 + random() * .3);
      g.add(kit.sphere(rr, { at: [(random() - .5) * r * 1.3, p.trunk + r * (.5 + (random() - .2) * .9), (random() - .5) * r * 1.1], color: p.color }));
    }
    return g;
  },
};
