// Рама светодиодного табло: две стойки, балка, корпус. Живой текст — компонент HtmlScreen
// в префабе departure-board. Начало координат — у пола под серединой табло; экран смотрит в +z.
export default {
  name: "Рама табло",
  params: {
    width: { type: "number", default: 2.8, doc: "Ширина экрана, м" },
    height: { type: "number", default: .98, doc: "Высота экрана, м" },
    bottom: { type: "number", default: 2.27, doc: "Низ экрана над полом, м" },
    depth: { type: "number", default: .22, doc: "Толщина корпуса, м" },
  },
  build(p, kit) {
    const g = kit.group(), w = p.width / 2, y0 = p.bottom, y1 = p.bottom + p.height;
    for (const x of [-w - .08, w - .06]) g.add(kit.boxFrom([x, x + .14], [0, y1 + .42], [-.17, -.03], { color: "post" }));
    g.add(kit.boxFrom([-w - .2, w + .2], [y1 + .26, y1 + .42], [-.2, 0], { color: "post" }));
    for (const x of [-w + .3, w - .3]) g.add(kit.boxFrom([x - .02, x + .02], [y1 + .04, y1 + .27], [-.12, -.08], { color: "post" }));
    g.add(kit.boxFrom([-w - .05, w + .05], [y0 - .05, y1 + .05], [-p.depth, 0], { color: "fence" }));
    return g;
  },
};
