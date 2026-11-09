// @ts-check
// Общий модуль (assets/shared/): фигуры ливреи вагона — для детальных моделей и вида «Вагон».
// Пассажирский вагон ФПК (РЖД) в фирменной ливрее — вид сбоку, по официальной схеме окраски
// («некотловая сторона»): светло-серый кузов, тонкая бордовая линия над тёмно-серым гофрированным
// низом; у одного торца — огромный логотип «РЖД», ножкой буквы «Р» служит красная дверь тамбура;
// у другого торца — тёмно-серый тамбур, отделённый красной косой полосой с белым кантом;
// в середине на простенке — малый логотип и «ФПК».
//
// Координаты: u — вдоль вагона от торца с логотипом (0 — хвост поезда), v — вверх от низа кузова.
// Единица — высота боковины от низа юбки до карниза крыши. Схема в масштабе: длина 7,92 единицы,
// то есть при длине кузова 25,5 м единица ≈ 3,22 м. Все размеры ниже сняты со схемы.

import { rect, roundPoly, roundRect, stadium } from "../geom.js";

export const H_M = 3.22;                      // метров в единице
export const CAR_L = 25.5 / H_M;              // длина кузова (7,92)
export const GAP = .2;                        // между кузовами (переход с гармошкой), ≈0,64 м
export const PITCH = CAR_L + GAP;
export const BODY_BOTTOM_M = .95;             // низ кузова над головкой рельса, м
export const ROOF = .07;                      // видимая сбоку кромка крыши

// Официальный логотип ОАО «РЖД» (rzd.ru, adaptive_sprite.svg#rzdLogo), viewBox 0 0 55.12 24.41.
export const RZD_LOGO = "M39.12,2.21v.9h7.7a2.5,2.5,0,0,1,1.8.5,2.5,2.5,0,0,1,.5,1.8V13a2.5,2.5,0,0,1-.5,1.8,2.62,2.62,0,0,1-1.8.5h-3.7c-.6,0-1.5,0-1.8-.7a1.73,1.73,0,0,1,.5-1.8l5-6.6h-7.7L36,10.31a3.79,3.79,0,0,0-1,2,3,3,0,0,0,1,2l.8,1h0a8.49,8.49,0,0,0,2.5,2.5,8.8,8.8,0,0,0,3.9.5h3.3c1.9,0,4.8,0,6.7-1.9s1.9-4.7,1.9-5.7V7.61c0-1,0-3.8-1.9-5.7S48.42,0,46.52,0h-5.3a2.38,2.38,0,0,0-1.7.5A2.83,2.83,0,0,0,39.12,2.21Zm-9.2,3.9h7.7l-9.2,12.2h-7.7Zm-29.4.6A2,2,0,0,0,0,8.31v.9h3.1v15.2h6.1V9.21h6c.6,0,1.5,0,1.8.7a1.73,1.73,0,0,1-.5,1.8l-5,6.6h7.7l3.1-4.1a3.79,3.79,0,0,0,1-2,3,3,0,0,0-1-2l-.8-1h0A8.49,8.49,0,0,0,19,6.71a8.8,8.8,0,0,0-3.9-.5H2.22A1.68,1.68,0,0,0,.52,6.71Z";

export const WINDOW_V = [.38, .66];
export const WINDOW_TRANSOM = .58;            // тёмная верхняя часть окна (шторка)
// окна по схеме: два узких у двери с логотипом, десять купейных, туалет и окно у тамбура
export const WINDOWS = [[.47, .66], [.84, 1.03], [1.19, 1.51], [1.76, 2.08], [2.33, 2.65], [2.9, 3.22],
  [3.47, 3.78], [4.06, 4.38], [4.63, 4.95], [5.2, 5.52], [5.77, 6.09], [6.34, 6.54], [6.89, 7.05]];
export const PLATE_WINDOW = 2;                // маршрутная табличка — в первом широком окне
export const DOOR_LOGO = [.1, .418];          // красная дверь у логотипа (u)
export const DOOR_FAR = [7.53, 7.85];         // тёмная дверь у полосы (u)
const DOOR_TOP = .757, LOWER = .177, PIN = [.182, .2];
const STRIPE_SLOPE = .71;                     // du/dv косой полосы

/**
 * Фигуры вагона в порядке отрисовки.
 * Простые фигуры: {cls, pts} или {cls, line, w}; особые: kind = logo | window | doorWindow | text | tail.
 * rear — последний вагон поезда: на нём табличка в окне, закрытый переход и хвостовые огни.
 */
/** @returns {any[]} */
export function coachShapes({ L = CAR_L, rear = false, index = 0 } = {}) {
  const S = [];
  const stripe = v => 7.1 + STRIPE_SLOPE * (v - .2);         // правая кромка красной полосы
  // кромка крыши и короба оборудования над тамбурами
  S.push({ cls: "f-roof", pts: roundRect(.01, .99, L - .01, 1 + ROOF, [0, 0, .03, .03], 3) });
  S.push({ cls: "f-roofbox", pts: roundRect(.42, .995, 1.18, 1 + ROOF + .02, [0, 0, .015, .015], 2) });
  S.push({ cls: "f-roofbox", pts: roundRect(7.32, .995, L - .02, 1 + ROOF + .02, [0, 0, .015, .015], 2) });
  // кузов, гофрированный низ и бордовая линия
  S.push({ cls: "f-body", pts: roundPoly(rect(0, 0, L, 1), [0, 0, .02, .02]) });
  for (const v of [.24, .29, .335]) S.push({ cls: "s-corr", line: [[.42, v], [stripe(v) - .05, v]], w: .006 });
  S.push({ cls: "f-band", pts: rect(0, 0, L, LOWER) });
  for (const v of [.045, .09, .135]) {
    S.push({ cls: "s-rib", line: [[0, v], [L, v]], w: .007 });
    S.push({ cls: "s-ribhi", line: [[0, v + .01], [L, v + .01]], w: .004 });
  }
  S.push({ cls: "f-pin", pts: rect(DOOR_LOGO[1], PIN[0], stripe(.19), PIN[1]) });
  // тамбур у полосы: тёмно-серый, отделён красной косой полосой с белым кантом
  S.push({ cls: "f-darkend", pts: roundPoly([[stripe(0), 0], [L, 0], [L, .76], [stripe(.76), .76], [stripe(.2), .2]], [0, 0, 0, .1, 0]) });
  S.push({ cls: "f-red", pts: roundPoly([[6.93, .2], [stripe(.2), .2], [stripe(.76), .76], [L, .76], [L, .778], [6.93 + STRIPE_SLOPE * .578, .778]],
    [0, 0, .1, 0, 0, .14]) });
  S.push({ cls: "s-white", line: [[6.915, .2], [6.915 + STRIPE_SLOPE * .55, .75]], w: .012 });
  // торец с логотипом: стойка, огромный логотип «РЖД», красная дверь — ножка «Р»
  S.push({ cls: "f-pillar", pts: rect(0, .015, DOOR_LOGO[0], DOOR_TOP) });
  S.push({ kind: "logo", u0: .019, v0: 1.013, k: .0413, clipTop: .99, cls: "f-red" });
  S.push({ cls: "f-red", stroke: "s-doorline", sw: .006, pts: roundRect(DOOR_LOGO[0], .015, DOOR_LOGO[1], DOOR_TOP, .01, 3) });
  S.push({ cls: "o-dark2", pts: rect(DOOR_LOGO[0] + .004, .02, DOOR_LOGO[0] + .016, DOOR_TOP - .004) });
  S.push({ kind: "doorWindow", pts: stadium(.19, .38, .33, .66) });
  S.push({ cls: "f-handle", pts: roundRect(.36, .4, .38, .46, .008, 2) });
  // тамбур у полосы: тёмная дверь с овальным окном
  S.push({ cls: "f-darkdoor", stroke: "s-doorline", sw: .006, pts: roundRect(DOOR_FAR[0], .03, DOOR_FAR[1], .755, .01, 3) });
  S.push({ cls: "o-dark2", pts: rect(DOOR_FAR[1] - .016, .035, DOOR_FAR[1] - .004, .75) });
  S.push({ kind: "doorWindow", pts: stadium(7.61, .38, 7.76, .63) });
  S.push({ cls: "f-handle", pts: roundRect(7.56, .4, 7.58, .46, .008, 2) });
  // окна
  WINDOWS.forEach(([u0, u1], i) => S.push({
    kind: "window", id: `${index}-${i}`, u0, u1, v0: WINDOW_V[0], v1: WINDOW_V[1], r: .035,
    transom: WINDOW_TRANSOM, plate: rear && index === 0 && i === PLATE_WINDOW,
  }));
  // малый логотип и надпись на простенке в середине вагона
  S.push({ kind: "logo", u0: 3.855, v0: .645, k: .0028, cls: "f-red" });
  S.push({ kind: "text", u: 3.865, v: .53, text: "ФПК", size: .045, cls: "f-print" });
  // объём: тень под карнизом крыши и затенённый низ юбки
  S.push({ cls: "o-dark1", pts: rect(0, .96, L, .995) });
  S.push({ cls: "o-dark1", pts: rect(0, 0, L, .03) });
  S.push({ cls: "o-light1", pts: rect(0, .03, .01, .95) });
  // низ: рама, подножки под дверями, ящики оборудования
  S.push({ cls: "f-under", pts: rect(.06, -.2, L - .06, 0) });
  for (const [u0, u1] of [[DOOR_LOGO[0] + .02, DOOR_LOGO[1] - .02], [DOOR_FAR[0] + .02, DOOR_FAR[1] - .02]]) {
    S.push({ cls: "f-step", pts: rect(u0, -.16, u1, 0) });
  }
  for (const [u0, u1] of [[1.6, 2.1], [2.55, 3.6], [4.35, 5.0], [5.35, 5.9]]) S.push({ cls: "f-box", pts: roundRect(u0, -.13, u1, -.01, .015, 2) });
  if (rear) {
    // закрытый переход на хвосте и хвостовой сигнал
    S.push({ cls: "f-bellows", pts: roundRect(-.07, .05, 0, .9, [.015, 0, 0, .015], 3) });
    for (let u = -.06; u < 0; u += .018) S.push({ cls: "s-fold-v", line: [[u, .07], [u, .88]], w: .007 });
    S.push({ cls: "f-lampbox", pts: roundRect(-.035, -.04, 0, .05, .008, 3) });
    S.push({ cls: "f-taillens", pts: rect(-.035, -.02, -.024, .035) });
    S.push({ kind: "tail", u: -.035, v: .005 });
  }
  return S;
}

/** Гармошка перехода между вагонами (u0 — конец переднего кузова, u1 — начало следующего). */
export function bellowsShapes(u0, u1) {
  /** @type {any[]} */
  const S = [{ cls: "f-bellows", pts: rect(u0, .05, u1, .9) }];
  for (let u = u0 + .018; u < u1; u += .03) S.push({ cls: "s-fold-v", line: [[u, .06], [u, .89]], w: .008 });
  S.push({ cls: "f-under", pts: rect(u0, -.14, u1, -.06) });
  return S;
}
