// Купейный вагон РЖД (ФПК) в корпоративной ливрее — вид сбоку.
//
// Координаты: u — вдоль вагона от торца (0 — хвост поезда), v — вверх от низа кузова.
// Единица — высота боковины (≈2,2 м). Пропорции сняты с фото сцепки двух вагонов
// (правый вагон с красной дверью): светло-серый кузов, тёмно-серый гофрированный низ,
// красная дверь тамбура, красная полоса под крышей, переходящая в широкую диагональ,
// параллельная ей вторая диагональ и тонкая красная линия над тёмным низом.

import { rect, roundPoly, roundRect, stadium } from "./geom.js";

export const H_M = 2.2;                       // метров в единице
export const CAR_L = 25.5 / H_M;              // длина кузова
export const GAP = .26;                       // между кузовами (переход с гармошкой)
export const ROOF = .31;                      // высота крыши над боковиной
export const PITCH = CAR_L + GAP;

const SLOPE = .637;                           // наклон диагоналей: du/dv
const BAND = .825;                            // нижняя кромка красной полосы под крышей
const STRIPE_BOTTOM = .307;                   // низ диагоналей = верх светлого гофра
const DARK_TOP = .22;                         // верх тёмно-серого низа кузова

export const WINDOW_V = [.455, .8];
export const PLATE_WINDOW = [.62, 1.36];       // окно служебного купе у двери — в нём табличка

/** Фигуры ливреи у одного торца; mirror переворачивает их к противоположному торцу. */
function endLivery(L, mirror) {
  const m = mirror ? ([u, v]) => [L - u, v] : p => p;
  const flip = pts => (mirror ? pts.map(m).reverse() : pts);
  const right = v => 1.118 + SLOPE * (v - STRIPE_BOTTOM);
  const left = v => .678 + SLOPE * (v - STRIPE_BOTTOM);
  const shapes = [];
  // красная полоса под крышей + широкая диагональ («семёрка»)
  shapes.push({ cls: "f-red", pts: flip(roundPoly([
    [0, BAND], [0, 1], [right(1), 1], [right(STRIPE_BOTTOM), STRIPE_BOTTOM],
    [left(STRIPE_BOTTOM), STRIPE_BOTTOM], [left(BAND), BAND],
  ], [0, .045, .3, 0, 0, .07])) });
  // вторая диагональ
  shapes.push({ cls: "f-red", pts: flip([
    [1.212, STRIPE_BOTTOM], [1.652, STRIPE_BOTTOM], [1.652 + SLOPE * (1 - STRIPE_BOTTOM), 1], [1.212 + SLOPE * (1 - STRIPE_BOTTOM), 1],
  ].map(p => p)) });
  // торцевая стойка тамбура
  shapes.push({ cls: "f-pillar", pts: flip(rect(0, 0, .127, BAND)) });
  // дверь тамбура
  shapes.push({ cls: "f-red", stroke: "s-doorline", sw: .009, pts: flip(roundRect(.127, .024, .556, .967, .012, 3)) });
  shapes.push({ kind: "doorWindow", pts: flip(stadium(.222, .462, .458, .828)) });
  for (const [v0, v1] of [[.495, .572], [.188, .266]]) {
    shapes.push({ cls: "f-handle", pts: flip(stadium(.172, v0, .216, v1, 6)) });
    shapes.push({ cls: "f-slot", pts: flip(stadium(.184, v0 + .012, .204, v1 - .012, 4)) });
  }
  shapes.push({ cls: "f-handle", pts: flip(roundRect(.478, .33, .5, .36, .01, 3)) });
  // сигнальные лампы закрытия дверей
  shapes.push({ cls: "f-lampbox", pts: flip(roundRect(.04, .13, .09, .27, .008, 2)) });
  shapes.push({ cls: "f-green", pts: flip(roundRect(.05, .225, .08, .255, .015, 4)) });
  shapes.push({ cls: "f-redlamp", pts: flip(roundRect(.048, .14, .082, .2, .006, 2)) });
  return shapes;
}

/**
 * Фигуры вагона в порядке отрисовки.
 * rear — последний вагон поезда: гармошка закрыта, на торце хвостовые огни.
 */
export function coachShapes({ L = CAR_L, rear = false, index = 0 } = {}) {
  const S = [];
  // крыша
  S.push({ cls: "f-roof", pts: roundRect(.012, .99, L - .012, 1 + ROOF, [0, 0, .17, .17]) });
  S.push({ cls: "f-roofhi", pts: roundRect(.06, 1 + ROOF - .07, L - .06, 1 + ROOF - .015, [0, 0, .05, .05], 4) });
  // кондиционер и решётки над тамбуром
  S.push({ cls: "f-roofbox", pts: roundRect(.8, 1 + ROOF - .02, 1.42, 1 + ROOF + .05, [0, 0, .03, .03], 3) });
  for (const [u0, v0, u1, v1] of [[.15, 1.03, .45, 1.11], [.15, 1.13, .45, 1.21], [.51, 1.09, .59, 1.22]]) {
    S.push({ cls: "f-grille", pts: rect(u0, v0, u1, v1) });
    for (let v = v0 + .016; v < v1 - .006; v += .022) S.push({ cls: "s-slat", line: [[u0 + .008, v], [u1 - .008, v]], w: .007 });
  }
  // кузов
  S.push({ cls: "f-body", pts: roundPoly(rect(0, 0, L, 1), [0, 0, .045, .045]) });
  S.push({ cls: "f-band2", pts: rect(0, DARK_TOP, L, STRIPE_BOTTOM) });
  S.push({ cls: "s-rib", line: [[0, .27], [L, .27]], w: .006 });
  S.push({ cls: "f-band", pts: rect(0, 0, L, DARK_TOP) });
  for (const v of [.07, .145]) {
    S.push({ cls: "s-rib", line: [[0, v], [L, v]], w: .008 });
    S.push({ cls: "s-ribhi", line: [[0, v + .011], [L, v + .011]], w: .005 });
  }
  S.push({ cls: "s-gutter", line: [[.03, 1.0], [L - .03, 1.0]], w: .01 });
  // тонкая красная линия над тёмным низом
  S.push({ cls: "f-red", pts: rect(1.04, .212, L - 1.04, .236) });
  // ливрея и двери у обоих торцов
  S.push(...endLivery(L, false), ...endLivery(L, true));
  // окна
  const windows = [[...PLATE_WINDOW, rear && index === 0]];
  for (let u = 1.64; u + .52 <= L - 1.45; u += .92) windows.push([u, u + .52, false]);
  windows.push([L - PLATE_WINDOW[1], L - PLATE_WINDOW[0], false]);
  windows.forEach(([u0, u1, plate], i) => S.push({
    kind: "window", id: `${index}-${i}`, u0, u1, v0: WINDOW_V[0], v1: WINDOW_V[1], r: .04, transom: .725, plate,
  }));
  S.push({ kind: "text", u: .8, v: .355, text: "МЕСТ-36", size: .05 });
  // низ: рама, ящики оборудования, подножки под дверями
  S.push({ cls: "f-under", pts: rect(.06, -.32, L - .06, 0) });
  for (const [u0, u1] of [[.16, .52], [L - .52, L - .16]]) S.push({ cls: "f-step", pts: rect(u0, -.25, u1, 0) });
  for (let u = 2.2; u < L - 2.2; u += 2.35) S.push({ cls: "f-box", pts: roundRect(u, -.2, u + 1.1, -.02, .02, 2) });
  if (rear) {
    // закрытая гармошка перехода на хвосте и хвостовой сигнал
    S.push({ cls: "f-bellows", pts: roundRect(-.1, .05, 0, .93, [.02, 0, 0, .02], 3) });
    for (let u = -.085; u < 0; u += .026) S.push({ cls: "s-fold-v", line: [[u, .07], [u, .91]], w: .01 });
    S.push({ cls: "f-lampbox", pts: roundRect(-.05, -.05, 0, .06, .01, 3) });
    S.push({ cls: "f-taillens", pts: rect(-.05, -.03, -.035, .04) });
    S.push({ kind: "tail", u: -.05, v: .005 });
  }
  return S;
}

/** Гармошка между двумя вагонами (u0 — конец переднего кузова, u1 — начало следующего). */
export function bellowsShapes(u0, u1) {
  const S = [{ cls: "f-bellows", pts: rect(u0, .05, u1, .93) }];
  for (let u = u0 + .025; u < u1; u += .045) S.push({ cls: "s-fold-v", line: [[u, .06], [u, .92]], w: .012 });
  S.push({ cls: "f-under", pts: rect(u0, -.2, u1, -.08) });
  return S;
}
