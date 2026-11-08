// Пешеходный мост через пути: опоры, пролёт, ферма тонкими линиями.
// Начало координат — середина пролёта у земли; мост идёт поперёк путей (вдоль x).
export default {
  name: "Пешеходный мост",
  params: {
    span: { type: "number", default: 80, doc: "Длина пролёта, м" },
    height: { type: "number", default: 7.2, doc: "Низ пролёта над рельсом, м" },
    piers: { type: "array", default: [-9, 15], doc: "Опоры по x, м" },
  },
  build(p, kit) {
    const g = kit.group(), h = p.height, s = p.span / 2, L = kit.lines();
    for (const x of p.piers) g.add(kit.box([1.6, h + .7, 1.6], { at: [x, -.3, 0], pivot: "bottom", color: "bridge" }));
    g.add(kit.boxFrom([-s, s], [h, h + .7], [-1.4, 1.4], { color: "bridge" }));
    g.add(kit.boxFrom([-s, s], [h + 2.6, h + 3], [-1.4, 1.4], { color: "bridge" }));
    for (const dz of [-1.38, 1.38]) {
      for (let x = -s; x < s; x += 3) {
        L.add([x, h + .7, dz], [x + 1.5, h + 2.6, dz], .09, "bridge");
        L.add([x + 1.5, h + 2.6, dz], [x + 3, h + .7, dz], .09, "bridge");
      }
    }
    g.add(L.build());
    return g;
  },
};
