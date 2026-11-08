// Фонарный столб: столб, кронштейн, светильник (ночью светится). Свет на пол и ореол — компоненты
// Light и Glow в префабе lamp. Начало координат — основание столба; кронштейн смотрит в +x.
export default {
  name: "Фонарный столб",
  params: {
    height: { type: "number", default: 5.2, doc: "Высота столба, м" },
    arm: { type: "number", default: .9, doc: "Вылет кронштейна, м" },
  },
  build(p, kit) {
    const g = kit.group(), h = p.height;
    g.add(kit.box([.12, h, .12], { pivot: "bottom", color: "post" }));
    g.add(kit.boxFrom([0, p.arm], [h - .12, h - .04], [-.04, .04], { color: "post" }));
    g.add(kit.boxFrom([p.arm - .22, p.arm + .42], [h - .18, h - .04], [-.15, .15], { color: "lamp", material: { emissiveNight: [1, .86, .56] } }));
    return g;
  },
};
