// Здание-заготовка: коробка, карниз, крыша (плоская или двускатная), ряды окон на фасаде.
// Ночью окна светятся. Начало координат — середина основания; фасад с окнами смотрит в +x
// (поверните объект, чтобы фасад смотрел на пути).
export default {
  name: "Здание",
  params: {
    size: { type: "vec3", default: [30, 12, 60], doc: "Размер [x, y, z], м" },
    color: { type: "color", default: "wall", doc: "Цвет стен" },
    roof: { type: "color", default: "roofDark", doc: "Цвет крыши" },
    gable: { type: "number", default: 0, doc: "Высота двускатной крыши (0 — плоская), м" },
    cornice: { type: "color", default: "trim", doc: "Цвет карниза (null — без карниза)" },
    windows: {
      type: "object",
      default: { rows: 2, step: 4.2, bottom: 2.5, width: 1.6, height: 2.2, gap: 3.4, color: "windowDark" },
      doc: "Окна: { rows, step (между этажами), bottom, width, height, gap, color } или null",
    },
  },
  build(p, kit) {
    const g = kit.group(), [W, H, D] = p.size;
    g.add(kit.box([W, H, D], { pivot: "bottom", color: p.color }));
    if (p.cornice) g.add(kit.box([W + .5, .5, D + .5], { at: [0, H - .5, 0], pivot: "bottom", color: p.cornice }));
    if (p.gable) {
      // двускатная крыша — две наклонные плиты
      const a = Math.atan2(p.gable, W / 2) * 180 / Math.PI, len = Math.hypot(p.gable, W / 2) + .4;
      for (const s of [-1, 1]) g.add(kit.box([len, .3, D + .6], { at: [s * W / 4, H + p.gable / 2, 0], rotation: [0, 0, -s * a], color: p.roof }));
    } else {
      g.add(kit.box([W - .6, .4, D - .6], { at: [0, H, 0], pivot: "bottom", color: p.roof }));
    }
    const w = p.windows;
    if (w) {
      for (let r = 0; r < (w.rows ?? 2); r++) {
        const y = (w.bottom ?? 2.5) + r * (w.step ?? 4.2), ww = w.width ?? 1.6, wh = w.height ?? 2.2, gap = w.gap ?? 3.4;
        if (y + wh > H - .6) break;
        for (let z = -D / 2 + gap / 2; z + ww < D / 2 - gap / 3; z += ww + gap) {
          g.add(kit.box([.06, wh, ww], { at: [W / 2 + .03, y, z + ww / 2], pivot: "bottom", color: w.color ?? "windowDark",
            material: { emissiveNight: [.62, .5, .3], receive: false } }));
        }
      }
    }
    return g;
  },
};
