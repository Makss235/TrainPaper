// @ts-check
// Двухэтажный вагон ФПК — примитивы: высокий кузов, два ряда окон, красная дверь, маршрутная табличка.
// Детальная версия — examples/trains/coach-double.js.
import { bogie, ends, plateSlots, windows } from "./_parts.js";

const L = 25.5, HALF = 1.65, BOTTOM = .72, TOP = 4.58;
const ROW = Array.from({ length: 9 }, (_, i) => [3.4 + i * 2.05, 4.65 + i * 2.05]);

export default {
  name: "Двухэтажный вагон (примитивы)",
  meta: {
    length: L, gap: .64,
    gangway: { half: .75, y: [1.0, 4.2] },
    tailLights: [[-1.15, .9], [1.15, .9]],
    windowSpill: ROW,
  },
  build(p, kit) {
    const g = kit.group();
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, L], { color: "body" }));
    g.add(kit.boxFrom([-1.25, 1.25], [TOP, TOP + .67], [.1, L - .1], { color: "roof" }));
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.28], [0, L], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .015, HALF + .015], [.78, 3.1], [.35, 1.35], { color: "red" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.36, 4.1], [22.6, L], { color: "darkend" }));
    windows(kit, g, ROW, [1.62, 2.38], HALF);
    windows(kit, g, ROW, [3.3, 4.04], HALF);
    plateSlots(kit, g, [3.49, 4.56], [1.7, 2.12], HALF);
    ends(kit, g, L, HALF, [BOTTOM, TOP]);
    g.add(kit.boxFrom([-1.45, 1.45], [.35, BOTTOM], [.4, L - .4], { color: "under" }));
    bogie(kit, g, 3.9, { top: .7 });
    bogie(kit, g, L - 3.9, { top: .7 });
    return g;
  },
};
