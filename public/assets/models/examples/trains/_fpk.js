// Пример детальных моделей (examples): вагоны ФПК с ливреей по схеме окраски (общей с видом «Вагон»).
// Включаются в assets/models/index.jsonc → aliases: "trains/coach-fpk": "examples/trains/coach-fpk.js".
// Пассажирские вагоны ФПК: одноэтажный (по схеме окраски из lib/coach.js — та же, что у вида
// «Вагон») и двухэтажный. Оба строятся общим строителем trains/coach.js по спецификации.
import {
  BODY_BOTTOM_M, CAR_L, DOOR_FAR, DOOR_LOGO, H_M, PLATE_WINDOW, WINDOW_TRANSOM, WINDOW_V, WINDOWS,
} from "../../../js/lib/coach.js";
import { MATERIALS } from "../../../js/lib/palette.js";
import { buildCoach } from "./_coach.js";
import { drawLogo, liveryCanvas, paintFpk } from "./_livery.js";

const m = u => u * H_M;                         // единицы схемы → метры
const vy = v => BODY_BOTTOM_M + v * H_M;        // высота на схеме → метры над рельсом

/* ---------- одноэтажный вагон ФПК ---------- */

const fpkCanvas = liveryCanvas(4096, Math.round(4096 / CAR_L));
paintFpk(fpkCanvas);

export const FPK_SPEC = {
  length: m(CAR_L),                              // 25,5 м
  half: 1.7,
  bottom: BODY_BOTTOM_M,
  wallTop: BODY_BOTTOM_M + 2.83,                 // вертикальная часть борта — дверь прямая на всю высоту
  // верх кузова по торцевому виду схемы: крутое «плечо» и почти плоская крыша
  shoulder: [[0, 0], [.07, .13], [.15, .27], [.24, .4], [.38, .53], [.49, .66], [.58, .75], [1.04, .84], [1.7, .88]],
  liveryBands: 3,
  livery: { canvas: fpkCanvas, vBase: BODY_BOTTOM_M, vScale: H_M },
  windows: [
    ...WINDOWS.map(([u0, u1]) => ({ z0: m(u0), z1: m(u1), y0: vy(WINDOW_V[0]), y1: vy(WINDOW_V[1]), r: m(.035), transom: vy(WINDOW_TRANSOM) })),
    // окна в дверях: у логотипа и у тамбура
    { z0: m(.19), z1: m(.33), y0: vy(.38), y1: vy(.66), r: m(.07) - .002 },
    { z0: m(7.61), z1: m(7.76), y0: vy(.38), y1: vy(.63), r: m(.075) - .002 },
  ],
  plateWindow: PLATE_WINDOW,
  bogies: [4.25, m(CAR_L) - 4.25],
  boxes: [[1.6, 2.1], [2.55, 3.6], [4.35, 5.0], [5.35, 5.9]].map(([a, b]) => [m(a), m(b)]),
  steps: [DOOR_LOGO, DOOR_FAR].map(([a, b]) => [m(a) + .06, m(b) - .06]),
  roofBoxes: [[m(.42), m(1.18)], [m(7.32), m(CAR_L) - .1]],
};
document.fonts?.ready.then(() => {
  paintFpk(fpkCanvas);
  if (FPK_SPEC.texture) FPK_SPEC.texture.needsUpdate = true;
});

export const fpkCoach = {
  name: "Пассажирский вагон ФПК (детальный)",
  meta: {
    length: FPK_SPEC.length, gap: .64,
    gangway: { half: .75, y: [1.2, 3.85] },
    tailLights: [[-1.15, 1.05], [1.15, 1.05]],      // хвостовые огни у торца z = 0 (x, y)
    windowSpill: FPK_SPEC.windows.slice(0, 13).map(w => [w.z0, w.z1]),
  },
  build: (p, kit) => buildCoach(FPK_SPEC, kit),
};

/* ---------- двухэтажный вагон ФПК ---------- */

const DD = { L: 25.5, bottom: .72, wallTop: 4.58, vScale: 4.6 };
const ddCanvas = liveryCanvas(4096, Math.round(4096 / DD.L * DD.vScale));

/** Ливрея двухэтажного вагона: светло-серый кузов, тёмно-серый низ, большой логотип у торца, косая полоса у другого. */
function paintDouble(canvas) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, ppm = W / DD.L;
  const X = z => z * ppm, Y = y => (1 - (y - DD.bottom) / DD.vScale) * H;
  g.fillStyle = MATERIALS.body; g.fillRect(0, 0, W, H);
  g.fillStyle = MATERIALS.band; g.fillRect(0, Y(1.28), W, H - Y(1.28));
  g.fillStyle = MATERIALS.pin; g.fillRect(0, Y(1.36), W, Y(1.28) - Y(1.36));
  // тамбур у дальнего торца: тёмный, за красной косой полосой с белым кантом
  const s0 = 22.4, slope = .55;
  g.fillStyle = MATERIALS.darkend;
  g.beginPath(); g.moveTo(X(s0 + .25), Y(1.36)); g.lineTo(X(DD.L), Y(1.36)); g.lineTo(X(DD.L), Y(4.1)); g.lineTo(X(s0 + .25 + slope * 2.74), Y(4.1)); g.closePath(); g.fill();
  g.fillStyle = MATERIALS.red;
  g.beginPath(); g.moveTo(X(s0 - .3), Y(1.36)); g.lineTo(X(s0 + .25), Y(1.36)); g.lineTo(X(s0 + .25 + slope * 2.74), Y(4.1));
  g.lineTo(X(DD.L), Y(4.1)); g.lineTo(X(DD.L), Y(4.22)); g.lineTo(X(s0 - .3 + slope * 2.86), Y(4.22)); g.closePath(); g.fill();
  g.strokeStyle = MATERIALS.white; g.lineWidth = ppm * .04;
  g.beginPath(); g.moveTo(X(s0 - .36), Y(1.36)); g.lineTo(X(s0 - .36 + slope * 2.8), Y(4.16)); g.stroke();
  // большой логотип у торца z = 0, красная дверь под ним
  drawLogo(g, X(.25), Y(4.45), (Y(1.45) - Y(4.45)), MATERIALS.red);
  g.fillStyle = MATERIALS.red;
  g.beginPath(); g.roundRect(X(.35), Y(3.1), X(1.35) - X(.35), Y(.78) - Y(3.1), ppm * .05); g.fill();
  g.strokeStyle = MATERIALS.doorline; g.lineWidth = ppm * .02; g.stroke();
  g.fillStyle = MATERIALS.darkdoor;
  g.beginPath(); g.roundRect(X(23.95), Y(3.1), X(24.95) - X(23.95), Y(.78) - Y(3.1), ppm * .05); g.fill();
  // уплотнители окон
  g.strokeStyle = MATERIALS.frame; g.lineWidth = ppm * .08;
  for (const w of DOUBLE_SPEC.windows) {
    g.beginPath(); g.roundRect(X(w.z0), Y(w.y1), X(w.z1) - X(w.z0), Y(w.y0) - Y(w.y1), (w.r ?? .1) * ppm); g.stroke();
  }
  g.fillStyle = MATERIALS.print;
  g.font = `700 ${Math.round(ppm * .2)}px "Exo 2", sans-serif`;
  g.textAlign = "center";
  g.fillText("ФПК", X(12.7), Y(2.75));
  drawLogo(g, X(12.25), Y(3.15), ppm * .38, MATERIALS.red);
}

const ddWindows = [];
for (let i = 0; i < 9; i++) {
  const z0 = 3.4 + i * 2.05;
  ddWindows.push({ z0, z1: z0 + 1.25, y0: 1.62, y1: 2.38, r: .1, transom: 2.24 });      // нижний этаж
  ddWindows.push({ z0, z1: z0 + 1.25, y0: 3.3, y1: 4.04, r: .1, transom: 3.92 });       // верхний этаж
}
ddWindows.push({ z0: .62, z1: 1.08, y0: 2.0, y1: 2.85, r: .22 }, { z0: 24.22, z1: 24.68, y0: 2.0, y1: 2.85, r: .22 });

export const DOUBLE_SPEC = {
  length: DD.L,
  half: 1.65,
  bottom: DD.bottom,
  wallTop: DD.wallTop,
  shoulder: [[0, 0], [.06, .2], [.16, .38], [.34, .52], [.62, .62], [1.0, .67], [1.65, .69]],
  liveryBands: 2,
  livery: { canvas: ddCanvas, vBase: DD.bottom, vScale: DD.vScale },
  windows: ddWindows,
  plateWindow: 0,
  bogies: [3.9, DD.L - 3.9],
  boxes: [[6.5, 9.5], [15.5, 19]],
  steps: [[.4, 1.3], [24.0, 24.9]],
  roofBoxes: [[1.2, 3.2], [22.3, 24.3]],
  colors: { roof: "roof" },
};
paintDouble(ddCanvas);
document.fonts?.ready.then(() => {
  paintDouble(ddCanvas);
  if (DOUBLE_SPEC.texture) DOUBLE_SPEC.texture.needsUpdate = true;
});

export const fpkDouble = {
  name: "Двухэтажный вагон ФПК (детальный)",
  meta: {
    length: DD.L, gap: .64,
    gangway: { half: .75, y: [1.0, 4.2] },
    tailLights: [[-1.15, .9], [1.15, .9]],
    windowSpill: ddWindows.filter(w => w.y0 < 2).map(w => [w.z0, w.z1]),
  },
  build: (p, kit) => buildCoach(DOUBLE_SPEC, kit),
};
