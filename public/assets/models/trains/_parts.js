// @ts-check
// Общие детали вагонов-примитивов: тележки, ряды окон, табличка-слот, торцы.
// Оси вагона: z — вдоль кузова от хвостового торца 0 до переднего length, x — поперёк (0 — ось),
// y — вверх от головки рельса. Левый борт (−x) и правый (+x) одинаковы.

/** Двухосная тележка: рама и четыре колеса. */
export function bogie(kit, g, z, { wheelbase = 2.4, top = .8 } = {}) {
  g.add(kit.boxFrom([-1.15, 1.15], [.42, top], [z - 1.5, z + 1.5], { color: "under" }));
  for (const dz of [-wheelbase / 2, wheelbase / 2]) {
    for (const x of [-.8, .8]) g.add(kit.cylinder(.47, .13, { at: [x, .47, z + dz], rotation: [0, 0, 90], color: "frame", segments: 12 }));
  }
}

/**
 * Окна на обоих бортах: стёкла — коробки чуть выступают из борта.
 * windows — [[z0, z1], ...], y — [низ, верх], half — полуширина кузова.
 */
export function windows(kit, g, list, [y0, y1], half, { shade = .15, frame = true } = {}) {
  for (const s of [-1, 1]) {
    for (const [z0, z1] of list) {
      if (frame) g.add(kit.boxFrom(s < 0 ? [-half - .02, -half] : [half, half + .02], [y0 - .05, y1 + .05], [z0 - .05, z1 + .05], { color: "frame" }));
      g.add(kit.boxFrom(s < 0 ? [-half - .03, -half - .01] : [half + .01, half + .03], [y0, y1], [z0, z1],
        { color: "#ffffff", material: { glass: true, glassShade: shade } }));
    }
  }
}

/**
 * Маршрутная табличка: плоскость-слот в окне на обоих бортах (приложение подставит текстуру
 * с маршрутом). Текст читается слева направо с обеих сторон.
 */
export function plateSlots(kit, g, [z0, z1], [y0, y1], half) {
  const T = kit.THREE;
  for (const s of [-1, 1]) {
    const geo = new T.PlaneGeometry(z1 - z0, y1 - y0);
    geo.rotateY(s < 0 ? -Math.PI / 2 : Math.PI / 2);
    const m = kit.mesh(geo, { color: "#c8141c", material: { receive: false } });
    m.position.set(s * (half + .035), (y0 + y1) / 2, (z0 + z1) / 2);
    m.userData.slot = "plate";
    m.userData.noBatch = true;
    g.add(m);
  }
}

/** Торцевые плиты чуть выступают (без совпадающих плоскостей с кузовом). */
export function ends(kit, g, length, half, [y0, y1], color = "darkend") {
  g.add(kit.boxFrom([-half + .05, half - .05], [y0, y1], [-.02, 0], { color }));
  g.add(kit.boxFrom([-half + .05, half - .05], [y0, y1], [length, length + .02], { color }));
}
