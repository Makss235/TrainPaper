// @ts-check
// Путь: балластная призма (шпалы — узором на её верхе, без ряби вдали) и два рельса тонкими линиями.
// Начало координат — ось пути на уровне головки рельса.
// Ось пути — params.path: точки [[x, y, z], ...] (её передаёт компонент Track, rail/track.js — по ней же ходят поезда);
// без path путь прямой: от z = back до z = −length.
// Модель — только представление (I4): строит геометрию по точкам, математику пути не знает.
/** @type {import("../../../engine/index.js").ModelDefinition} */
export default {
  name: "Путь",
  params: {
    length: { type: "number", default: 3000, doc: "Длина к горизонту (−z), м — если нет path" },
    back: { type: "number", default: 60, doc: "Длина за спину камеры (+z), м — если нет path" },
    gauge: { type: "number", default: 1.52, doc: "Колея, м" },
    path: { type: "array", default: null, doc: "Ось пути [[x, y, z], ...] (задаёт Track)" },
  },
  build(p, kit) {
    const { THREE } = kit;
    const g = kit.group();
    /** @type {number[][]} */
    const pts = p.path?.length >= 2 ? p.path : [[0, 0, p.back], [0, 0, -p.length]];
    // поперечное направление (влево к росту s) в каждой точке — среднее соседних участков (стык без щелей)
    const left = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      return [dz / l, -dx / l];
    });
    const sAt = [0];
    for (let i = 1; i < pts.length; i++) sAt.push(sAt[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const at = (/** @type {number} */ i, /** @type {number} */ off, /** @type {number} */ y) => [pts[i][0] + left[i][0] * off, pts[i][1] + y, pts[i][2] + left[i][1] * off];

    // призма: верх (со шпалами), два откоса-борта; плоские грани — свой тон у каждой
    const body = [], top = [], topUv = [];
    const W = 2.4;
    for (let i = 1; i < pts.length; i++) {
      const quad = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number[]} */ c, /** @type {number[]} */ d, /** @type {number[]} */ out) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
      // R — справа от оси (offset −W), L — слева; 0 — ближняя точка, 1 — дальняя. Обход против часовой снаружи
      const R0b = at(i - 1, -W, -.33), R1b = at(i, -W, -.33), R0t = at(i - 1, -W, -.205), R1t = at(i, -W, -.205);
      const L0b = at(i - 1, W, -.33), L1b = at(i, W, -.33), L0t = at(i - 1, W, -.205), L1t = at(i, W, -.205);
      quad(R0b, R1b, R1t, R0t, body);                     // борт справа
      quad(L0t, L1t, L1b, L0b, body);                     // борт слева
      // верх со шпалами (чуть выше тела призмы)
      quad(at(i - 1, -W, -.2), at(i, -W, -.2), at(i, W, -.2), at(i - 1, W, -.2), top);
      const s0 = sAt[i - 1], s1 = sAt[i];
      // uv в метрах: u — поперёк от оси (справа +), v — вдоль пути; порядок — как у вершин quad (a, b, c, a, c, d)
      topUv.push(W, s0, W, s1, -W, s1, W, s0, -W, s1, -W, s0);
    }
    const geo = (/** @type {number[]} */ pos, /** @type {number[] | null} */ uv) => {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (uv) gg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      gg.computeVertexNormals();
      return gg;
    };
    g.add(kit.mesh(geo(body, null), { color: "ballast", material: { snow: true } }));
    g.add(kit.mesh(geo(top, topUv), { color: "ballast",
      material: { snow: true, patternShadows: true, pattern: { type: "slats", half: 1.35, step: .55, width: .26, color: "sleeper" } } }));

    // рельсы: шейка — в тени, головка — светлая полоса. Длинные прямые режутся на куски, растущие с расстоянием
    const lines = kit.lines(), h = p.gauge / 2;
    for (const [off, y, w, color] of /** @type {[number, number, number, string][]} */ ([[-h - .03, -.1, .06, "rail"], [-h, -.035, .075, "railTop"], [h + .03, -.1, .06, "rail"], [h, -.035, .075, "railTop"]])) {
      for (let i = 1; i < pts.length; i++) {
        const a = at(i - 1, off, y), b = at(i, off, y);
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        let t = 0;
        while (t < 1 - 1e-9) {
          const px = a[0] + (b[0] - a[0]) * t, pz = a[2] + (b[2] - a[2]) * t;
          const step = Math.max(2, Math.hypot(px, pz) * .35) / Math.max(len, 1e-6);
          const t1 = Math.min(1, t + step);
          lines.add([px, a[1] + (b[1] - a[1]) * t, pz], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1], w, color);
          t = t1;
        }
      }
    }
    g.add(lines.build());
    return g;
  },
};
