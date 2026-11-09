// @ts-check
// Навес над платформой: крыша на колоннах. Под крышей нет дождя и снега (карта высот осадков).
// Начало координат — середина ближнего края навеса на уровне пола платформы; навес идёт в −z.
export default {
  name: "Навес",
  params: {
    width: { type: "number", default: 6.4, doc: "Ширина, м" },
    length: { type: "number", default: 180, doc: "Длина, м" },
    height: { type: "number", default: 4.4, doc: "Высота низа крыши над полом, м" },
    thickness: { type: "number", default: .3, doc: "Толщина крыши, м" },
    columns: { type: "array", default: [0], doc: "Ряды колонн по x (от середины), м" },
    step: { type: "number", default: 10.5, doc: "Шаг колонн, м" },
    offset: { type: "number", default: 3, doc: "Первая колонна от края, м" },
  },
  build(p, kit) {
    const g = kit.group(), w = p.width / 2, h = p.height, L = p.length;
    g.add(kit.boxFrom([-w, w], [h, h + p.thickness], [0, -L], { color: "canopy" }));
    for (const x of [-w, w]) g.add(kit.boxFrom([x - .05, x + .05], [h - .25, h], [0, -L], { color: "canopy" }));
    g.add(kit.boxFrom([-w + .06, w - .06], [h - .02, h], [0, -L], { color: "canopyUnder", material: { receive: false } }));
    for (let z = -p.offset; z > -L; z -= p.step) {
      for (const x of p.columns) {
        g.add(kit.box([.28, h, .28], { at: [x, 0, z], pivot: "bottom", color: "column" }));
        g.add(kit.box([.44, .12, .44], { at: [x, 0, z], pivot: "bottom", color: "column" }));
      }
    }
    return g;
  },
};
