// @ts-check
// Пассажирская платформа из коробок: тело, пол с плиткой, полосы разметки у края к пути, пандусы.
// Начало координат — середина ближнего торца платформы на уровне головки рельса (y = 0);
// платформа идёт от z = 0 в сторону −z на length. Пол — на высоте height.
// Полосы разметки не перекрываются: каждая точка пола принадлежит одной коробке — без мерцания.
export default {
  name: "Платформа",
  params: {
    length: { type: "number", default: 100, doc: "Длина, м" },
    width: { type: "number", default: 6.7, doc: "Ширина, м" },
    height: { type: "number", default: 1.1, doc: "Высота пола над головкой рельса, м" },
    edges: { type: "array", default: ["+x"], doc: "Края к путям: [\"+x\"], [\"-x\"] или оба (островная)" },
    coping: { type: "number", default: .29, doc: "Светлая кромка у края, м" },
    tactile: { type: "vec2", default: [.29, .65], doc: "Тактильная полоса: от края … до, м (null — нет)" },
    line: { type: "vec2", default: [.65, .8], doc: "Жёлтая линия: от края … до, м (null — нет)" },
    tiles: { type: "boolean", default: true, doc: "Швы плитки (узором, без ряби вдали)" },
    ramps: { type: "number", default: 4, doc: "Длина пандусов на торцах, м (0 — отвесные торцы)" },
  },
  meta: p => ({ top: p.height, length: p.length }),
  build(p, kit) {
    const g = kit.group(), W = p.width, L = p.length, H = p.height, t = .03;
    const x0 = -W / 2, x1 = W / 2;
    // тело под полом
    g.add(kit.boxFrom([x0, x1], [-.32, H - t], [0, -L], { color: "platformSide" }));
    // полосы от каждого края к пути
    /** @type {{d: number[], color: string}[]} */
    const bands = [{ d: [0, p.coping], color: "coping" }];
    if (p.tactile) bands.push({ d: [Math.max(p.coping, p.tactile[0]), p.tactile[1]], color: "tactile" });
    if (p.line) bands.push({ d: [Math.max(bands[bands.length - 1].d[1], p.line[0]), p.line[1]], color: "yellow" });
    const inner = bands[bands.length - 1].d[1];
    let m0 = x0, m1 = x1;
    for (const e of p.edges) {
      const s = e === "-x" ? -1 : 1, edge = s > 0 ? x1 : x0;
      for (const b of bands) {
        const xa = edge - s * b.d[1], xb = edge - s * b.d[0];
        g.add(kit.boxFrom([Math.min(xa, xb), Math.max(xa, xb)], [H - t, H], [0, -L], { color: b.color, material: { patternShadows: true } }));
      }
      if (s > 0) m1 = x1 - inner; else m0 = x0 + inner;
    }
    const tiles = p.tiles ? { pattern: { type: "tiles", step: [.6, .6], width: .02, fade: 70, color: "tileLine" } } : {};
    if (m1 > m0) g.add(kit.boxFrom([m0, m1], [H - t, H], [0, -L], { color: "platform", material: { patternShadows: true, ...tiles } }));
    // пандусы: наклонные плиты на торцах
    if (p.ramps > 0) {
      const a = Math.atan2(H + .32, p.ramps) * 180 / Math.PI, len = Math.hypot(H + .32, p.ramps);
      for (const [z, dir] of [[0, 1], [-L, -1]]) {
        g.add(kit.box([W, .2, len], { at: [0, (H - .32) / 2 - .1, z + dir * p.ramps / 2], rotation: [dir * a, 0, 0], color: "platform" }));
      }
    }
    return g;
  },
};
