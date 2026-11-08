// Путь: балластная призма (шпалы — узором на её верхе, без ряби вдали) и два рельса тонкими линиями.
// Начало координат — ось пути на уровне головки рельса; путь идёт от z = back до z = −length.
export default {
  name: "Путь",
  params: {
    length: { type: "number", default: 3000, doc: "Длина к горизонту (−z), м" },
    back: { type: "number", default: 60, doc: "Длина за спину камеры (+z), м" },
    gauge: { type: "number", default: 1.52, doc: "Колея, м" },
  },
  build(p, kit) {
    const g = kit.group();
    // призма: тело и верх отдельной плоскостью с uv в метрах — по ним рисуются шпалы
    g.add(kit.boxFrom([-2.4, 2.4], [-.33, -.205], [p.back, -p.length], { color: "ballast" }));
    const len = p.back + p.length;
    g.add(kit.plane([4.8, len], { uvMeters: true, at: [0, -.2, (p.back - p.length) / 2], color: "ballast",
      material: { patternShadows: true, pattern: { type: "sleepers", half: 1.35, step: .55, width: .26, color: "sleeper" } } }));
    const lines = kit.lines(), h = p.gauge / 2;
    for (const r of [-h, h]) {
      lines.along(r + .03, -.1, p.back, -p.length, .06, "rail");        // шейка — в тени
      lines.along(r, -.035, p.back, -p.length, .075, "railTop");        // головка — светлая полоса
    }
    g.add(lines.build());
    return g;
  },
};
