// Ограда: прутья — узором на одной плоскости (без ряби вдали), стойки и перила — тонкими линиями.
// Тень решётки на пол даёт компонент StripeShadow на том же объекте (см. префаб fence).
// Начало координат — низ ограды у ближнего конца; ограда идёт в сторону −z.
export default {
  name: "Ограда",
  params: {
    length: { type: "number", default: 250, doc: "Длина, м" },
    height: { type: "number", default: 1.12, doc: "Высота, м" },
    step: { type: "number", default: .14, doc: "Шаг прутьев, м" },
    bar: { type: "number", default: .02, doc: "Толщина прута, м" },
    postStep: { type: "number", default: 2.5, doc: "Шаг стоек, м" },
  },
  build(p, kit) {
    const g = kit.group(), low = .12, T = kit.THREE;
    // прутья: вертикальная плоскость x = 0, прозрачность — узором по z
    const geo = new T.PlaneGeometry(p.length, p.height - low);
    geo.rotateY(Math.PI / 2);
    const bars = kit.mesh(geo, { color: "fence", material: { pattern: { type: "bars", step: p.step, width: p.bar, color: "fence" }, side: T.DoubleSide, receive: false } });
    bars.position.set(0, (p.height + low) / 2, -p.length / 2);
    bars.userData.noShadow = true;
    g.add(bars);
    const L = kit.lines();
    for (const y of [p.height, low]) L.along(0, y, 0, -p.length, .05, "fence");
    for (let z = 0; z >= -p.length; z -= p.postStep) L.add([0, 0, z], [0, p.height + .08, z], .06, "fence");
    g.add(L.build());
    return g;
  },
};
