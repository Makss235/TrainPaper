// @ts-check
// Пассажирский вагон ФПК — примитивы: светло-серый кузов, тёмно-серый низ, красная дверь у хвостового
// торца и косая красная полоса у переднего, окна, маршрутная табличка в окне (слот "plate").
// Детальная версия с ливреей по схеме окраски — examples/trains/coach-fpk.js.
// Оси: z — от хвостового торца 0 до переднего 25,5; y — от головки рельса.
import { bogie, ends, plateSlots, windows } from "./_parts.js";

const L = 25.5, HALF = 1.7, BOTTOM = .95, TOP = 4.17;
const WINDOWS = [[3.83, 4.86], [5.67, 6.7], [7.5, 8.53], [9.34, 10.37], [11.17, 12.2], [13.07, 14.1], [14.91, 15.94], [16.74, 17.77], [18.58, 19.61]];

export default {
  name: "Вагон ФПК (примитивы)",
  meta: {
    length: L, gap: .64,
    gangway: { half: .75, y: [1.2, 3.85] },          // переход-гармошка к соседнему вагону
    tailLights: [[-1.15, 1.05], [1.15, 1.05]],        // хвостовые огни у торца z = 0, если вагон последний
    windowSpill: WINDOWS,                             // окна, свет из которых ночью ложится на платформу
  },
  build(p, kit) {
    const g = kit.group();
    g.add(kit.boxFrom([-HALF, HALF], [BOTTOM, TOP], [0, L], { color: "body" }));
    g.add(kit.boxFrom([-1.25, 1.25], [TOP, TOP + .45], [.1, L - .1], { color: "roof" }));
    g.add(kit.boxFrom([-1.55, 1.55], [TOP - .05, TOP + .25], [0, L], { color: "roof" }));
    // низ и тонкая бордовая линия
    g.add(kit.boxFrom([-HALF - .01, HALF + .01], [BOTTOM, 1.52], [0, L], { color: "band" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.52, 1.6], [1.4, 22], { color: "pin" }));
    // красная дверь у хвостового торца, косая красная полоса и тёмный тамбур у переднего
    g.add(kit.boxFrom([-HALF - .015, HALF + .015], [1.0, 3.39], [.32, 1.35], { color: "red" }));
    g.add(kit.boxFrom([-HALF - .012, HALF + .012], [1.6, 3.4], [22.9, L], { color: "darkend" }));
    for (const s of [-1, 1]) {
      g.add(kit.box([.02, 2.6, .55], { at: [s * (HALF + .018), 2.5, 22.6], rotation: [-20, 0, 0], color: "red" }));
    }
    windows(kit, g, WINDOWS, [2.17, 3.08], HALF);
    plateSlots(kit, g, [7.57, 8.46], [2.27, 2.63], HALF);
    ends(kit, g, L, HALF, [BOTTOM, TOP]);
    // рама, ящики оборудования, тележки
    g.add(kit.boxFrom([-1.5, 1.5], [.4, BOTTOM], [.4, L - .4], { color: "under" }));
    for (const [z0, z1] of [[5.2, 6.8], [8.2, 11.6], [14, 16.1], [17.2, 19]]) g.add(kit.boxFrom([-1.58, 1.58], [.45, .9], [z0, z1], { color: "box" }));
    bogie(kit, g, 4.25);
    bogie(kit, g, L - 4.25);
    return g;
  },
};
