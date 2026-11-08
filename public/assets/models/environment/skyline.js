// Город у горизонта: коробки домов разной высоты (в дымке выглядят силуэтами).
// Начало координат — точка, от которой отсчитываются x и z (обычно у камеры).
export default {
  name: "Город у горизонта",
  params: {
    seed: { type: "number", default: 7, doc: "Зерно случайности — разный город при разных числах" },
    count: { type: "number", default: 170, doc: "Сколько домов" },
    x: { type: "vec2", default: [-1300, 1300], doc: "Поперёк пути: от … до, м" },
    z: { type: "vec2", default: [-900, -1800], doc: "Вдоль пути: от … до, м" },
    height: { type: "vec2", default: [12, 82], doc: "Высота домов, м" },
    width: { type: "vec2", default: [20, 80], doc: "Ширина домов, м" },
    gap: { type: "number", default: 60, doc: "Свободная полоса по оси пути (|x| меньше этого — без домов), м" },
    colors: { type: "array", default: ["city", "city2", "city3"], doc: "Цвета домов" },
  },
  build(p, kit) {
    const g = kit.group(), random = kit.rng(p.seed);
    for (let i = 0; i < p.count; i++) {
      const x = p.x[0] + random() * (p.x[1] - p.x[0]), z = p.z[0] + random() * (p.z[1] - p.z[0]);
      const w = p.width[0] + random() * (p.width[1] - p.width[0]), h = p.height[0] + random() * (p.height[1] - p.height[0]);
      const d = 20 + random() * 40, color = p.colors[Math.floor(random() * p.colors.length)];
      if (Math.abs(x) < p.gap) continue;
      g.add(kit.box([w, h, d], { at: [x, -.3, z], pivot: "bottom", color, material: { haze: 1.02, receive: false } }));
    }
    return g;
  },
};
