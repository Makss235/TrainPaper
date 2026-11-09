// @ts-check
// Контактная сеть, упрощённо: опоры-цилиндры в ряд, консоли, несущий трос с провисом
// и контактный провод с зигзагом над каждым путём. Детальная версия по чертежу КС-160 —
// examples/catenary.js (включается в index.jsonc).
// Начало координат — линия опор у земли, первая опора в z = 0, дальше — в сторону −z.
export default {
  name: "Контактная сеть",
  params: {
    tracks: { type: "array", default: [-2.64, 2.64], doc: "Оси путей относительно линии опор (x), м" },
    span: { type: "number", default: 60, doc: "Пролёт между опорами, м" },
    count: { type: "number", default: 18, doc: "Число опор" },
    height: { type: "number", default: 10.4, doc: "Высота опоры, м" },
    contact: { type: "number", default: 6, doc: "Высота контактного провода, м" },
    system: { type: "number", default: 1.8, doc: "Высота несущего троса над контактным, м" },
    sag: { type: "number", default: 1.1, doc: "Провис несущего троса, м" },
    masts: { type: "boolean", default: true, doc: "Свои опоры (false — провода висят на порталах)" },
    back: { type: "number", default: 60, doc: "Провода за спину камеры от первой опоры, м" },
  },
  build(p, kit) {
    const g = kit.group(), L = kit.lines(), carrier = p.contact + p.system;
    const zs = Array.from({ length: p.count }, (_, i) => -p.span * i);
    for (const [i, z] of zs.entries()) {
      if (p.masts) {
        g.add(kit.cylinder(.19, p.height, { at: [0, -.3, z], pivot: "bottom", color: "concrete", segments: 8 }));
        g.add(kit.cylinder(.215, .3, { at: [0, 1.25, z], pivot: "bottom", color: "mastBand", segments: 8 }));
      }
      for (const x of p.tracks) {
        if (p.masts) {
          // консоль от опоры к оси пути, тяга, фиксатор
          L.add([0, carrier + .7, z], [x * 1.08, carrier + .5, z], .07, "steel");
          L.add([0, p.contact - .3, z], [x * 1.08, carrier + .5, z], .06, "steel");
          L.add([x * .7, p.contact + .45, z], [x + (i % 2 ? .3 : -.3), p.contact, z], .035, "steel");
        }
        L.add([x, carrier + .5, z], [x, carrier, z], .045, "insulator");      // подвесной изолятор
      }
    }
    // провода: несущий трос провисает в пролёте, контактный — зигзаг ±0,3 м, струны между ними
    const starts = [p.back, ...zs];
    for (const x of p.tracks) {
      const car = [], con = [];
      for (let k = 0; k < starts.length - 1; k++) {
        const a = starts[k], b = starts[k + 1], zig = k % 2 ? .3 : -.3;
        for (let n = 0; n < 12; n++) {
          const st = n / 12, z = a + (b - a) * st;
          car.push([x, carrier - p.sag * 4 * st * (1 - st), z]);
          con.push([x + zig * (1 - 2 * st), p.contact, z]);
        }
        for (let n = 1; n < 9; n++) {
          const st = n / 9, z = a + (b - a) * st;
          L.add([x, carrier - p.sag * 4 * st * (1 - st), z], [x + zig * (1 - 2 * st), p.contact, z], .006, "wire");
        }
      }
      L.line(car, .015, "wire");
      L.line(con, .014, "wire");
    }
    g.add(L.build());
    return g;
  },
};
