// Жёсткая поперечина (портал): две стойки и ферма над путями.
// Начало координат — середина пролёта у земли; стойки — по краям ширины width.
export default {
  name: "Портал",
  params: {
    width: { type: "number", default: 18.4, doc: "Расстояние между стойками, м" },
    height: { type: "number", default: 9.2, doc: "Высота, м" },
  },
  build(p, kit) {
    const g = kit.group(), h = p.height, w = p.width / 2, L = kit.lines();
    for (const x of [-w, w]) g.add(kit.box([.44, h + .3, .44], { at: [x, -.3, 0], pivot: "bottom", color: "steel" }));
    g.add(kit.box([p.width + .4, .45, .4], { at: [0, h - .225, 0], color: "steel" }));
    g.add(kit.box([p.width + .4, .23, .3], { at: [0, h - 1.33, 0], color: "steel" }));
    for (let x = -w; x < w; x += 1.2) {
      L.add([x, h - 1.22, .15], [x + .6, h - .45, .15], .05, "steel");
      L.add([x + .6, h - .45, .15], [x + 1.2, h - 1.22, .15], .05, "steel");
    }
    g.add(L.build());
    return g;
  },
};
