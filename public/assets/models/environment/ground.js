// @ts-check
// Земля до горизонта — плоскость. Начало координат — уровень земли.
export default {
  name: "Земля",
  params: {
    size: { type: "number", default: 12000, doc: "Сторона квадрата, м" },
    color: { type: "color", default: "ground", doc: "Цвет" },
  },
  build(p, kit) {
    // плоскость принимает тени и тени-узоры оград, мокнет и покрывается снегом
    return kit.plane([p.size, p.size], { at: [0, 0, -p.size / 2 + 200], color: p.color, material: { patternShadows: true, wet: true, snow: true } });
  },
};
