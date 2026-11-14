// Спрайты вида «Вагон» (2D): рисует стилизованные картинки и сохраняет их файлами SVG в public/assets/img/sprites/.
//   node tools/make-sprites.mjs
// Вагон — по схеме окраски ФПК из assets/shared/livery/coach-shapes.js (та же, что у прежней SVG-иллюстрации),
// цвета — дневные из assets/shared/materials.js: время суток спрайтам даёт свет движка.
// Каждую картинку можно заменить своей (того же размера в метрах — он записан в sprites.json и в сцене scenes/flat.jsonc).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bellowsShapes, CAR_L, coachShapes, H_M, PITCH, RZD_LOGO } from "../public/assets/shared/livery/coach-shapes.js";
import { pathD, roundRect } from "../public/assets/shared/geom.js";
import { MATERIALS as M } from "../public/assets/shared/materials.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/assets/img/sprites");
mkdirSync(OUT, { recursive: true });

/** Размеры спрайтов в метрах — для сцены. @type {Record<string, {size: number[], note: string}>} */
const manifest = {};
const n = (/** @type {number} */ v) => +v.toFixed(2);
const RED_SIGN = "#c8232a";

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Смешать цвет с дымкой (дальние планы светлее и голубее). @param {string} hex @param {number} k */
function haze(hex, k, to = [176, 196, 216]) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v, i) => Math.round(v + (to[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** Записать SVG: w × h пикселей, содержимое — в координатах пикселей. */
function save(name, w, h, body, meters, note) {
  writeFileSync(join(OUT, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${n(w)} ${n(h)}">\n${body}\n</svg>\n`);
  manifest[name] = { size: meters.map(n), note };
}

/* ---------- вагон ---------- */

const P = 420;                                  // пикселей на единицу схемы (высоту боковины, 3,22 м)
const U0 = -.09, U1 = PITCH + .005, V0 = -.22, V1 = 1.115;
const X = (/** @type {number} */ u) => (u - U0) * P, Y = (/** @type {number} */ v) => (V1 - v) * P;
const map = (/** @type {number[][]} */ pts) => pts.map(([u, v]) => [X(u), Y(v)]);
const OVERLAY = { "o-dark1": ["#000", .09], "o-dark2": ["#000", .2], "o-light1": ["#fff", .14] };
const STROKE = { "s-fold-v": M.fold, "s-fold": M.fold, "s-slat": M.slat, "s-frame": M.frame };
const fillOf = (/** @type {string} */ cls) => M[cls.replace(/^f-/, "")] || "#ff00ff";
const strokeOf = (/** @type {string} */ cls) => STROKE[cls] || M[cls.replace(/^s-/, "")] || "#ff00ff";

/** Кузов вагона: всё, кроме света в окнах. Окна — стекло днём (отражение неба, шторки). */
function coachBody(rear) {
  const shapes = coachShapes({ rear, index: rear ? 0 : 1 });
  if (!rear || true) shapes.push(...bellowsShapes(CAR_L, PITCH));          // переход к следующему вагону
  let out = "", defs = "", clip = 0;
  for (const s of shapes) {
    if (s.pts && !s.kind) {
      const d = pathD(map(s.pts));
      if (OVERLAY[s.cls]) out += `<path d="${d}" fill="${OVERLAY[s.cls][0]}" opacity="${OVERLAY[s.cls][1]}"/>`;
      else out += `<path d="${d}" fill="${fillOf(s.cls)}"${s.stroke ? ` stroke="${strokeOf(s.stroke)}" stroke-width="${n(s.sw * P)}"` : ""}/>`;
    } else if (s.line) {
      out += `<path d="${pathD(map(s.line), false)}" fill="none" stroke="${strokeOf(s.cls)}" stroke-width="${n(Math.max(.8, s.w * P))}"/>`;
    } else if (s.kind === "logo") {
      let open = "", close = "";
      if (s.clipTop) {
        const id = `side${clip++}`;
        defs += `<clipPath id="${id}"><rect x="${n(X(-.2))}" y="${n(Y(s.clipTop))}" width="${n(X(CAR_L + .2) - X(-.2))}" height="${n(Y(-1) - Y(s.clipTop))}"/></clipPath>`;
        open = `<g clip-path="url(#${id})">`; close = "</g>";
      }
      out += `${open}<path d="${RZD_LOGO}" fill="${fillOf(s.cls)}" transform="translate(${n(X(s.u0))} ${n(Y(s.v0))}) scale(${(s.k * P).toFixed(4)})"/>${close}`;
    } else if (s.kind === "text") {
      out += `<text x="${n(X(s.u))}" y="${n(Y(s.v))}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${n(s.size * P)}" letter-spacing=".04em" fill="${M.print}">${s.text}</text>`;
    } else if (s.kind === "window") {
      out += windowGlass(s);
    } else if (s.kind === "doorWindow") {
      const d = pathD(map(s.pts));
      out += `<path d="${d}" fill="url(#gInterior)"/><path d="${d}" fill="url(#gReflect)" opacity=".7"/><path d="${d}" fill="none" stroke="${M.frame}" stroke-width="${n(.02 * P)}"/>`;
    } else if (s.kind === "tail") {
      out += `<circle cx="${n(X(s.u))}" cy="${n(Y(s.v))}" r="${n(.016 * P)}" fill="#ff5a3c"/>`;
    }
  }
  defs += `<linearGradient id="gInterior" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56606b"/><stop offset="1" stop-color="#3e464f"/></linearGradient>` +
    `<linearGradient id="gReflect" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe6f6"/><stop offset="1" stop-color="#7fb0d8"/></linearGradient>`;
  return `<defs>${defs}</defs>${out}`;
}

/** Окно днём: тёмный интерьер, шторки, отражение неба, блики, рама. */
function windowGlass(w) {
  const x0 = X(w.u0), x1 = X(w.u1), yT = Y(w.v1), yB = Y(w.v0), ww = x1 - x0, hh = yB - yT;
  const outline = pathD(roundRect(x0, yT, x1, yB, w.r * P, 5));
  const id = `w${w.id}`;
  const rodY = yT + hh * (w.plate ? .19 : .5), folds = 7;
  let curtain = `M${n(x0)} ${n(yB)}V${n(rodY)}`;
  for (let i = 0; i < folds; i++) {
    const xa = x0 + ww * i / folds, xb = x0 + ww * (i + 1) / folds;
    curtain += `Q${n((xa + xb) / 2)} ${n(rodY + hh * .06)} ${n(xb)} ${n(rodY)}`;
  }
  let pleats = "";
  for (let i = 1; i < folds; i++) pleats += `M${n(x0 + ww * i / folds)} ${n(rodY + hh * .02)}V${n(yB)}`;
  return `<clipPath id="${id}"><path d="${outline}"/></clipPath><g clip-path="url(#${id})">` +
    `<rect x="${n(x0)}" y="${n(yT)}" width="${n(ww)}" height="${n(hh)}" fill="url(#gInterior)"/>` +
    `<path d="${curtain}V${n(yB)}Z" fill="#6c8596"/><path d="${pleats}" stroke="#000" stroke-opacity=".22" stroke-width="${n(Math.max(1, ww * .012))}"/>` +
    `<path d="M${n(x0)} ${n(rodY)}H${n(x1)}" stroke="#b9a35a" stroke-width="${n(P * .009)}"/>` +
    `<rect x="${n(x0)}" y="${n(yT)}" width="${n(ww)}" height="${n(hh)}" fill="url(#gReflect)" opacity="${w.plate ? .2 : .62}"/>` +
    `<rect x="${n(x0)}" y="${n(yT)}" width="${n(ww)}" height="${n(hh * .1)}" fill="#000" opacity=".2"/>` +
    `<path d="M${n(x0 + ww * .12)} ${n(yB)}L${n(x0 + ww * .3)} ${n(yB)}L${n(x0 + ww * .72)} ${n(yT)}L${n(x0 + ww * .54)} ${n(yT)}Z` +
    `M${n(x0 + ww * .38)} ${n(yB)}L${n(x0 + ww * .45)} ${n(yB)}L${n(x0 + ww * .87)} ${n(yT)}L${n(x0 + ww * .8)} ${n(yT)}Z" fill="#fff" opacity="${w.plate ? .1 : .26}"/></g>` +
    `<path d="${outline}" fill="none" stroke="${M.frame}" stroke-width="${n(.022 * P)}"/>` +
    `<path d="M${n(x0)} ${n(Y(w.transom))}H${n(x1)}" stroke="${M.frame}" stroke-width="${n(.014 * P)}"/>` +
    `<rect x="${n(x0 + w.r * P * .5)}" y="${n(yB + .013 * P)}" width="${n(ww - w.r * P)}" height="${n(.012 * P)}" fill="#fff" opacity=".14"/>`;
}

/**
 * Свет в окнах: тёплый интерьер со шторками — только проёмы окон, остальное прозрачно.
 * Спрайт лежит поверх кузова и светится ночью (Sprite.night): днём его не видно.
 */
function coachLights(rear) {
  let out = "";
  for (const s of coachShapes({ rear, index: rear ? 0 : 1 })) {
    if (s.kind === "doorWindow") { out += `<path d="${pathD(map(s.pts))}" fill="url(#gLit)"/>`; continue; }
    if (s.kind !== "window") continue;
    const x0 = X(s.u0), x1 = X(s.u1), yT = Y(s.v1), yB = Y(s.v0), ww = x1 - x0, hh = yB - yT, id = `l${s.id}`;
    const outline = pathD(roundRect(x0 + .011 * P, yT + .011 * P, x1 - .011 * P, yB - .011 * P, s.r * P * .8, 5));
    const rodY = yT + hh * (s.plate ? .19 : .5), folds = 7;
    let curtain = `M${n(x0)} ${n(yB)}V${n(rodY)}`;
    for (let i = 0; i < folds; i++) {
      const xa = x0 + ww * i / folds, xb = x0 + ww * (i + 1) / folds;
      curtain += `Q${n((xa + xb) / 2)} ${n(rodY + hh * .06)} ${n(xb)} ${n(rodY)}`;
    }
    let pleats = "";
    for (let i = 1; i < folds; i++) pleats += `M${n(x0 + ww * i / folds)} ${n(rodY + hh * .02)}V${n(yB)}`;
    out += `<clipPath id="${id}"><path d="${outline}"/></clipPath><g clip-path="url(#${id})">` +
      `<rect x="${n(x0)}" y="${n(yT)}" width="${n(ww)}" height="${n(hh)}" fill="url(#gLit)"/>` +
      `<path d="${curtain}V${n(yB)}Z" fill="#c9a76c"/><path d="${pleats}" stroke="#5b4320" stroke-opacity=".35" stroke-width="${n(Math.max(1, ww * .012))}"/>` +
      `<rect x="${n(x0)}" y="${n(yT + hh * .14)}" width="${n(ww)}" height="${n(hh * .035)}" fill="#3a2a14" opacity=".4"/>` +
      `<rect x="${n(x0)}" y="${n(Y(s.transom) - .007 * P)}" width="${n(ww)}" height="${n(.014 * P)}" fill="#33363a"/></g>`;
  }
  return `<defs><linearGradient id="gLit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe2a3"/><stop offset="1" stop-color="#f2b35c"/></linearGradient></defs>${out}`;
}

const coachW = (U1 - U0) * P, coachH = (V1 - V0) * P, coachM = [(U1 - U0) * H_M, (V1 - V0) * H_M];
const origin = `торец кузова (u = 0) — в ${n(-U0 * H_M)} м от левого края, низ кузова (v = 0) — в ${n(-V0 * H_M)} м от нижнего`;
save("coach-tail", coachW, coachH, coachBody(true), coachM, `хвостовой вагон ФПК; ${origin}`);
save("coach-tail-lights", coachW, coachH, coachLights(true), coachM, "свет в окнах хвостового вагона (ночью), кладётся поверх него");
save("coach", coachW, coachH, coachBody(false), coachM, `вагон ФПК в середине состава; ${origin}`);
save("coach-lights", coachW, coachH, coachLights(false), coachM, "свет в окнах вагона (ночью)");

/* ---------- локомотив: пассажирский электровоз в ливрее РЖД (по образцу ЭП20), вид сбоку ---------- */
// Серый низ и крыша, красные кабины с косой границей, светло-серая середина с логотипом; на крыше — оборудование
// и сложенные токоприёмники; две трёхосные тележки. Электровоз симметричен: какой кабиной вперёд — неважно.
{
  const K = 130, LEN = 22.5, W = LEN + 1.1, H = 5.15, X0 = .55;       // картинка шире кузова на автосцепки
  const x = (/** @type {number} */ m) => (m + X0) * K, y = (/** @type {number} */ m) => (H - m) * K;      // m — метры: от торца кузова и от головки рельса
  const P = (/** @type {number[][]} */ pts) => pathD(pts.map(([a, b]) => [x(a), y(b)]));
  const R = (x0, y0, x1, y1, fill, extra = "") => `<rect x="${n(x(x0))}" y="${n(y(y1))}" width="${n((x1 - x0) * K)}" height="${n((y1 - y0) * K)}" fill="${fill}"${extra}/>`;
  const red = "#e22b23", redDark = "#b81f1a", grey = "#7f858d", greyDark = "#5d6269", light = "#c5c9d3", roof = "#6c7178", under = "#484c52", glass = "#232a33", white = "#f2f3f4";
  const BOTTOM = 1.38, BELT = 2.12, TOP = 3.82;       // низ кузова, верх серого пояса, карниз крыши
  // обе половины — зеркальные: рисуем левую и отражаем
  const mirror = (/** @type {string} */ s) => s + `<g transform="translate(${n(x(LEN) + x(0))} 0) scale(-1 1)">${s}</g>`;
  let s = "";
  // --- ходовая часть: тележки, колёса, ящики под кузовом ---
  let bogie = "";
  for (const cx of [2.55, 4.95, 7.3]) {
    bogie += `<circle cx="${n(x(cx))}" cy="${n(y(.625))}" r="${n(.625 * K)}" fill="${under}"/><circle cx="${n(x(cx))}" cy="${n(y(.625))}" r="${n(.5 * K)}" fill="none" stroke="#8b9097" stroke-width="${n(.05 * K)}"/>` +
      `<circle cx="${n(x(cx))}" cy="${n(y(.625))}" r="${n(.16 * K)}" fill="#8b9097"/>`;
  }
  bogie += `<path d="${P([[1.7, 1.2], [8.15, 1.2], [8.35, .95], [8.0, .6], [7.0, .52], [5.6, .86], [4.3, .86], [3.0, .52], [1.95, .6], [1.6, .95]])}" fill="${greyDark}"/>` +
    R(1.9, 1.2, 8.0, 1.36, under) + R(3.35, .9, 4.15, 1.2, under) + R(5.75, .9, 6.55, 1.2, under);
  s += mirror(bogie) + R(9.95, .42, 12.55, 1.3, greyDark) + R(10.05, .5, 11.2, 1.2, under) + R(11.3, .5, 12.45, 1.2, under) + R(8.6, 1.02, 13.9, 1.38, under);
  // автосцепки и путеочистители
  s += mirror(R(-.5, .98, .1, 1.2, under) + `<path d="${P([[-.05, 1.38], [1.25, 1.38], [1.05, .32], [.1, .22]])}" fill="#f0492c"/>` + R(-.12, 1.05, .08, 1.5, greyDark));
  // --- кузов ---
  const body = [[.12, BOTTOM], [.02, 2.3], [.42, 3.55], [.95, 4.02], [1.75, 4.2], [LEN - 1.75, 4.2], [LEN - .95, 4.02], [LEN - .42, 3.55], [LEN - .02, 2.3], [LEN - .12, BOTTOM]];
  s += `<clipPath id="lb"><path d="${P(body)}"/></clipPath><g clip-path="url(#lb)">` +
    R(-1, BOTTOM, LEN + 1, 4.4, light) +                                                              // светло-серая середина
    mirror(`<path d="${P([[-1, BELT], [6.25, BELT], [7.35, TOP + .02], [7.35, 4.4], [-1, 4.4]])}" fill="${red}"/>` +   // красная кабина с косой границей
      `<path d="${P([[-1, BOTTOM], [1.35, BOTTOM], [1.35, BELT], [-1, BELT]])}" fill="${red}"/>`) +     // красный низ под кабиной
    R(1.35, BOTTOM, LEN - 1.35, BELT, grey) +                                                          // серый пояс
    mirror(`<path d="${P([[-1, BELT + .08], [6.3, BELT + .08], [7.4, TOP + .02], [7.52, TOP + .02], [6.36, BELT], [-1, BELT]])}" fill="${white}"/>`) +   // белый кант
    R(-1, TOP, LEN + 1, 4.4, roof) +                                                                   // скат крыши
    mirror(`<path d="${P([[-1, TOP], [1.9, TOP], [1.9, 4.4], [-1, 4.4]])}" fill="${grey}"/>`) +        // крыша над кабиной светлее
    R(-1, BOTTOM, LEN + 1, BOTTOM + .07, "#000", ' opacity=".18"') + R(-1, TOP - .05, LEN + 1, TOP, "#000", ' opacity=".12"') + `</g>`;
  // --- кабина: окна, дверь, поручни, жалюзи ---
  let cab = `<path d="${P([[.95, 2.82], [1.22, 3.5], [1.62, 3.5], [1.62, 2.82]])}" fill="${glass}"/><path d="${P([[1.02, 2.9], [1.26, 3.44], [1.4, 3.44], [1.18, 2.9]])}" fill="#fff" opacity=".2"/>` +
    `<rect x="${n(x(1.78))}" y="${n(y(3.5))}" width="${n(.52 * K)}" height="${n(.68 * K)}" rx="${n(.07 * K)}" fill="${glass}"/><rect x="${n(x(1.86))}" y="${n(y(3.44))}" width="${n(.1 * K)}" height="${n(.56 * K)}" fill="#fff" opacity=".2"/>` +
    // дверь с окном и поручнями
    `<rect x="${n(x(3.72))}" y="${n(y(3.62))}" width="${n(.58 * K)}" height="${n(2.14 * K)}" rx="${n(.05 * K)}" fill="none" stroke="${redDark}" stroke-width="${n(.035 * K)}"/>` +
    `<rect x="${n(x(3.86))}" y="${n(y(3.5))}" width="${n(.3 * K)}" height="${n(.62 * K)}" rx="${n(.14 * K)}" fill="${glass}"/>` +
    `<path d="M${n(x(3.58))} ${n(y(3.2))}V${n(y(1.55))}M${n(x(4.44))} ${n(y(3.2))}V${n(y(1.55))}" stroke="#d6d8dc" stroke-width="${n(.04 * K)}"/>` +
    R(3.74, 1.05, 4.28, 1.4, greyDark) + R(3.74, 1.2, 4.28, 1.24, "#9aa0a7") +                        // подножка
    // жалюзи вентиляции
    R(5.05, 3.28, 6.3, 3.62, redDark);
  for (let v = 3.33; v < 3.6; v += .065) cab += R(5.1, v, 6.25, v + .02, "#000", ' opacity=".28"');
  cab += `<circle cx="${n(x(.62))}" cy="${n(y(2.5))}" r="${n(.13 * K)}" fill="#fff5d8"/><circle cx="${n(x(.62))}" cy="${n(y(2.5))}" r="${n(.13 * K)}" fill="none" stroke="${white}" stroke-width="${n(.03 * K)}"/>`;   // буферный фонарь
  s += mirror(cab);
  // --- середина: иллюминаторы, логотип, люки ---
  for (const cx of [9.95, 12.55]) s += `<rect x="${n(x(cx - .37))}" y="${n(y(3.42))}" width="${n(.74 * K)}" height="${n(.36 * K)}" rx="${n(.16 * K)}" fill="${glass}"/>`;
  s += `<path d="${RZD_LOGO}" fill="${red}" transform="translate(${n(x(10.48))} ${n(y(2.98))}) scale(${(.0245 * K).toFixed(4)})"/>` +
    R(10.5, 1.6, 12.0, 1.95, "#000", ' opacity=".12"') + R(14.9, 3.3, 15.5, 3.55, "#000", ' opacity=".1"');
  // --- крыша: кожух оборудования, токоприёмники ---
  s += `<path d="${P([[8.7, 4.2], [8.9, 4.86], [13.6, 4.86], [13.8, 4.2]])}" fill="${roof}"/>` + R(8.9, 4.86, 13.6, 4.93, greyDark);
  for (const [a, b] of [[9.15, 10.05], [10.2, 11.1], [11.4, 12.3], [12.45, 13.35]]) {
    s += R(a, 4.32, b, 4.76, "#000", ' opacity=".14"');
    for (let v = 4.38; v < 4.74; v += .09) s += R(a + .05, v, b - .05, v + .025, "#000", ' opacity=".22"');
  }
  let panto = R(4.55, 4.2, 4.7, 4.5, greyDark) + R(6.45, 4.2, 6.6, 4.5, greyDark) + R(6.9, 4.2, 7.3, 4.62, "#9aa0a7") +
    `<path d="M${n(x(4.5))} ${n(y(4.56))}H${n(x(6.7))}M${n(x(4.62))} ${n(y(4.56))}L${n(x(5.5))} ${n(y(4.7))}L${n(x(6.5))} ${n(y(4.6))}" fill="none" stroke="${red}" stroke-width="${n(.06 * K)}" stroke-linecap="round"/>` +
    R(4.35, 4.66, 5.0, 4.72, greyDark);
  for (const cx of [7.7, 8.15]) panto += `<rect x="${n(x(cx))}" y="${n(y(4.5))}" width="${n(.14 * K)}" height="${n(.3 * K)}" rx="${n(.05 * K)}" fill="#a4553f"/>`;
  s += mirror(panto);
  save("loco", W * K, H * K, s, [W, H], `пассажирский электровоз в ливрее РЖД (по образцу ЭП20); торец кузова — в ${X0} м от левого края, низ картинки — головка рельса`);
}

/* ---------- платформа: полоса пола «в плане», повторяется вдоль ---------- */
{
  const K = 160, W = 6, H = 2.9;                    // пикселей на метр; плитка шириной 6 м
  const band = (y0, y1, fill, extra = "") => `<rect x="0" y="${n(y0 * K)}" width="${W * K}" height="${n((y1 - y0) * K)}" fill="${fill}"${extra}/>`;
  let s = band(0, H, M.platform) + band(0, .035, M.gap) + band(.035, .2, M.coping) + band(.3, .39, M.yellow) + band(.39, .54, M.tactile);
  let dots = "";
  for (let x = .03; x < W; x += .075) dots += `M${n(x * K)} ${n(.465 * K)}h${n(.035 * K)}`;
  s += `<path d="${dots}" stroke="${M.tile}" stroke-width="${n(.07 * K)}"/>`;
  let joints = "";
  for (let y = .54, row = 0; y < H; y += .29, row++) {
    joints += `M0 ${n(y * K)}H${W * K}`;
    for (let x = (row % 2) * .3; x <= W; x += .6) joints += `M${n(x * K)} ${n(y * K)}V${n(Math.min(H, y + .29) * K)}`;
  }
  s += `<path d="${joints}" stroke="${M.tile}" stroke-width="${n(.016 * K)}" fill="none"/>`;
  // пол темнеет к низу кадра — полоса не выглядит плоской заливкой
  s += `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>` + band(0, H, "url(#g)");
  save("platform", W * K, H * K, s, [W, H], "пол платформы полосой: кромка, жёлтая линия, тактильная полоса, плитка; повторяется по ширине (repeat)");
}

/* ---------- платформа: навес, павильон, скамейка (типы платформ) ---------- */
// Навес вокзальной платформы: кровля на колоннах с подкосами, под ней — светильники. Левый край — торец навеса,
// вправо он уходит за кадр. Низ картинки — пол платформы.
{
  const K = 110, W = 44, H = 4.5, step = 8, first = 2.2;
  const x = (/** @type {number} */ m) => m * K, y = (/** @type {number} */ m) => (H - m) * K;      // m — от левого края и от пола
  const R = (x0, y0, x1, y1, fill, extra = "") => `<rect x="${n(x(x0))}" y="${n(y(y1))}" width="${n((x1 - x0) * K)}" height="${n((y1 - y0) * K)}" fill="${fill}"${extra}/>`;
  const steel = "#434a55", steelHi = "#5a626e", roofTop = "#343a44", under = "#2a2f37";
  let s = "";
  // кровля: плита со светлой кромкой, тёмный низ; торец слева скошен
  s += `<path d="M${n(x(.5))} ${n(y(3.72))}L${n(x(0))} ${n(y(4.02))}V${n(y(4.2))}H${n(x(W))}V${n(y(3.72))}Z" fill="${roofTop}"/>` +
    R(0, 4.2, W, 4.28, "#7a8491") + R(.5, 3.66, W, 3.74, under) + R(.2, 4.02, W, 4.07, "#fff", ' opacity=".1"');
  // прогон под кровлей и колонны с подкосами
  s += R(.9, 3.48, W, 3.66, steel);
  for (let cx = first; cx < W; cx += step) {
    s += R(cx - .14, 0, cx + .14, 3.5, steel) + R(cx - .14, 0, cx - .05, 3.5, steelHi) + R(cx - .26, 0, cx + .26, .2, under) + R(cx - .2, 3.3, cx + .2, 3.5, under) +
      `<path d="M${n(x(cx))} ${n(y(2.55))}L${n(x(cx - 1.15))} ${n(y(3.5))}M${n(x(cx))} ${n(y(2.55))}L${n(x(cx + 1.15))} ${n(y(3.5))}" stroke="${steel}" stroke-width="${n(.09 * K)}" stroke-linecap="round"/>`;
  }
  // светильники под кровлей — между колоннами
  for (let cx = first + step / 2; cx < W; cx += step) s += R(cx - .55, 3.36, cx + .55, 3.48, "#2b3038") + R(cx - .48, 3.3, cx + .48, 3.37, "#fff4d6");
  save("canopy", W * K, H * K, s, [W, H], `навес вокзальной платформы на колоннах (шаг ${step} м, первая — в ${first} м от левого торца); светильники — посередине между колоннами на высоте 3,33 м; низ — пол платформы`);
}
// Павильон остановочного пункта: стеклянная задняя стенка, боковины, плоская крыша, внутри скамейка, сверху — полоса вывески.
{
  const K = 150, W = 5, H = 3.1;
  const x = (/** @type {number} */ m) => m * K, y = (/** @type {number} */ m) => (H - m) * K;
  const R = (x0, y0, x1, y1, fill, extra = "") => `<rect x="${n(x(x0))}" y="${n(y(y1))}" width="${n((x1 - x0) * K)}" height="${n((y1 - y0) * K)}" fill="${fill}"${extra}/>`;
  const frame = "#3d444e", glass = "#9fc4dc";
  let s = R(.25, .1, 4.75, 2.45, glass, ' opacity=".42"');                                    // стекло задней стенки
  for (const cx of [1.35, 2.5, 3.65]) s += R(cx - .03, .1, cx + .03, 2.45, frame);            // импосты
  s += R(.25, 1.0, 4.75, 1.06, frame) + `<path d="M${n(x(.6))} ${n(y(.4))}L${n(x(1.25))} ${n(y(2.3))}M${n(x(2.75))} ${n(y(.4))}L${n(x(3.4))} ${n(y(2.3))}" stroke="#fff" stroke-width="${n(.1 * K)}" opacity=".16"/>`;
  s += R(.15, 0, .3, 2.6, frame) + R(4.7, 0, 4.85, 2.6, frame) + R(.15, 0, .21, 2.6, "#fff", ' opacity=".14"');   // стойки
  s += R(0, 2.5, 5, 2.72, "#2f353e") + R(0, 2.72, 5, 2.78, "#6d7783") + R(.35, 2.52, 4.65, 2.7, RED_SIGN) ;        // крыша и полоса вывески
  // скамейка внутри
  s += R(.9, .42, 4.1, .5, "#8a5a36") + R(.9, .62, 4.1, .68, "#8a5a36") + R(.9, .78, 4.1, .84, "#8a5a36") + R(1.1, 0, 1.18, .5, frame) + R(3.82, 0, 3.9, .5, frame);
  save("shelter", W * K, H * K, s, [W, H], "павильон остановочного пункта со скамейкой; низ — пол платформы");
}
// Скамейка: деревянные рейки на тёмных ножках.
{
  const K = 180, W = 2.1, H = .95;
  const x = (/** @type {number} */ m) => m * K, y = (/** @type {number} */ m) => (H - m) * K;
  const R = (x0, y0, x1, y1, fill, extra = "") => `<rect x="${n(x(x0))}" y="${n(y(y1))}" width="${n((x1 - x0) * K)}" height="${n((y1 - y0) * K)}" fill="${fill}"${extra}/>`;
  const wood = "#9a6a43", woodHi = "#b98556", leg = "#2f343b";
  let s = R(.2, 0, .28, .9, leg) + R(1.82, 0, 1.9, .9, leg) + R(.12, 0, .36, .05, leg) + R(1.74, 0, 1.98, .05, leg);
  for (const [a, b] of [[.4, .48], [.58, .66], [.76, .84]]) s += R(.05, a, 2.05, b, wood) + R(.05, b - .02, 2.05, b, woodHi);
  s += R(0, .42, 2.1, .46, leg, ' opacity=".5"');
  save("bench", W * K, H * K, s, [W, H], "скамейка; низ — пол платформы");
}

/* ---------- дальний план: город и деревья силуэтами (повторяются по ширине) ---------- */
{
  const K = 64, W = 48, H = 2.6, random = rng(11);
  const c1 = haze(M.city, .45), c2 = haze(M.city2, .5);
  let s = "";
  for (let x = 0; x < W;) {
    const w = .9 + random() * 3.2, h = .6 + random() * 1.75, fill = random() < .5 ? c1 : c2;
    const x1 = Math.min(W, x + w);
    s += `<rect x="${n(x * K)}" y="${n((H - h) * K)}" width="${n((x1 - x) * K)}" height="${n(h * K + 1)}" fill="${fill}"/>`;
    if (random() < .2 && x1 - x > 1.2) s += `<rect x="${n((x + w * .4) * K)}" y="${n((H - h - .55) * K)}" width="${n(w * .18 * K)}" height="${n(.56 * K)}" fill="${c1}"/>`;
    x += w * (.72 + random() * .5);
  }
  save("skyline", W * K, H * K, s, [W, H], "город у горизонта силуэтом; повторяется по ширине");
}
{
  const K = 96, W = 32, H = 1.7, random = rng(23);
  const pts = [];
  for (let x = 0; x <= W; x += .35 + random() * .55) pts.push([x, .2 + random() * .7]);
  // края совпадают — полоса стыкуется сама с собой
  pts[pts.length - 1] = [W, pts[0][1]];
  let d = `M0 ${n(H * K)}V${n((H - pts[0][1]) * K)}`;
  for (let i = 1; i < pts.length; i++) {
    const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
    d += `Q${n((xa + xb) / 2 * K)} ${n((H - Math.max(ya, yb) - .28) * K)} ${n(xb * K)} ${n((H - yb) * K)}`;
  }
  save("treeline", W * K, H * K, `<path d="${d}V${n(H * K)}Z" fill="${haze(M.trees, .3)}"/>`, [W, H], "полоса деревьев за путями; повторяется по ширине");
}

/* ---------- контактная сеть: опора с консолью и цепная подвеска, пролёт 40 м (повторяется) ---------- */
// Опора — по типовому чертежу промежуточной опоры (КС-160): коническая железобетонная стойка; наклонная консоль
// от нижнего узла к вершине, горизонтальная тяга от верхнего узла, подкос; на конце консоли — подвесной изолятор
// с седлом несущего троса; ниже — фиксатор с изолятором и изогнутой стойкой, которая держит контактный провод;
// от троса к фиксатору — наклонная струна. Консоль нарисована «в профиль» (как на чертеже), провода идут вдоль
// кадра: несущий трос провисает между опорами по дуге, контактный провод под ним ровный, их связывают струны.
// Опора — в середине картинки, края приходятся на середины пролётов: картинка стыкуется сама с собой.
{
  const K = 100, W = 40, H = 8.9, cx = W / 2;          // низ картинки — уровень пола платформы (1,1 м над рельсом)
  const y = (/** @type {number} */ m) => (H - (m - 1.1)) * K;      // m — высота над головкой рельса
  const x = (/** @type {number} */ m) => m * K;
  const pole = haze("#a9adb1", .3), poleDark = haze("#7e8388", .3), steel = haze("#596068", .26), wire = haze("#2f353b", .4),
    insul = haze("#7a3b2a", .22);
  const CONTACT = 6.0, SUPPORT = 7.8, SAG = 1.15;     // контактный провод, седло несущего троса (конструктивная высота 1,8 м), стрела провеса
  const TOP = 9.75, halfW = (/** @type {number} */ m) => .215 - .07 * (m - 1.1) / (TOP - 1.1);          // стойка сужается кверху
  const face = (/** @type {number} */ m) => cx + halfW(m);          // грань стойки со стороны пути
  /** Точка узла: dx — от грани стойки к оси пути, m — высота. */
  const pt = (/** @type {number} */ dx, /** @type {number} */ m) => [x(face(m) + dx), y(m)];
  const line = (/** @type {number[][]} */ pts, /** @type {number} */ w, color = steel) =>
    `<path d="${pts.map(([a, b], i) => `${i ? "L" : "M"}${n(a)} ${n(b)}`).join("")}" fill="none" stroke="${color}" stroke-width="${n(w * K)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let s = "";
  // --- стойка: конус, слева свет, справа тень, скруглённая вершина, красная полоса и табличка с номером ---
  const L0 = cx - halfW(1.1), R0 = cx + halfW(1.1), L1 = cx - halfW(TOP), R1 = cx + halfW(TOP);
  s += `<path d="M${n(x(L0))} ${n(y(1.1))}L${n(x(L1))} ${n(y(TOP))}Q${n(x(cx))} ${n(y(TOP + .12))} ${n(x(R1))} ${n(y(TOP))}L${n(x(R0))} ${n(y(1.1))}Z" fill="${pole}"/>` +
    `<path d="M${n(x(cx + halfW(1.1) * .25))} ${n(y(1.1))}L${n(x(cx + halfW(TOP) * .25))} ${n(y(TOP + .04))}L${n(x(R1))} ${n(y(TOP))}L${n(x(R0))} ${n(y(1.1))}Z" fill="${poleDark}" opacity=".5"/>` +
    `<path d="M${n(x(L0))} ${n(y(1.1))}L${n(x(L1))} ${n(y(TOP))}l${n(.05 * K)} ${n(-.02 * K)}L${n(x(L0 + .07))} ${n(y(1.1))}Z" fill="#fff" opacity=".25"/>` +
    `<path d="M${n(x(cx - halfW(2.45)))} ${n(y(2.45))}H${n(x(cx + halfW(2.45)))}L${n(x(cx + halfW(2.15)))} ${n(y(2.15))}H${n(x(cx - halfW(2.15)))}Z" fill="${haze("#c62a2f", .18)}"/>` +
    `<rect x="${n(x(cx - .12))}" y="${n(y(3.75))}" width="${n(.24 * K)}" height="${n(.3 * K)}" fill="#f1f1ee" opacity=".92"/>`;
  // --- изолятор: стержень с «юбками» вдоль отрезка ---
  const insulator = (/** @type {number[]} */ a, /** @type {number[]} */ b, plates = 4, size = .11) => {
    let out = line([a, b], .035);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    for (let i = 0; i < plates; i++) {
      const t = (i + .5) / plates, px = n(a[0] + (b[0] - a[0]) * t), py = n(a[1] + (b[1] - a[1]) * t);
      out += `<ellipse cx="${px}" cy="${py}" rx="${n(.03 * K)}" ry="${n(size * (1 - .12 * Math.abs(i - (plates - 1) / 2)) * K)}" fill="${insul}" transform="rotate(${n(ang)} ${px} ${py})"/>`;
    }
    return out;
  };
  // --- консоль (позиции — как на чертеже) ---
  const N6 = pt(0, 5.7), N5 = pt(0, 8.6);              // нижний и верхний узлы крепления на стойке
  const slope = (8.85 - 5.7) / 3.4, onArm = (/** @type {number} */ dx) => pt(dx, 5.7 + slope * dx);     // точка на консоли
  const TIP = onArm(3.4), HT = pt(3.15, SUPPORT), KP = pt(3.2, CONTACT);                                // вершина консоли, несущий трос, контактный провод
  s += line([N6, TIP], .075) +                                                    // 1 — консоль (наклонная труба)
    line([N5, onArm(3.0)], .05) +                                                 // 13 — горизонтальная тяга
    line([pt(.03, 8.52), onArm(1.3)], .045) +                                     // подкос от верхнего узла к середине консоли
    `<rect x="${n(N5[0] - .05 * K)}" y="${n(N5[1] - .1 * K)}" width="${n(.14 * K)}" height="${n(.2 * K)}" fill="${steel}"/>` +     // 5 — верхний узел
    `<rect x="${n(N6[0] - .05 * K)}" y="${n(N6[1] - .1 * K)}" width="${n(.14 * K)}" height="${n(.2 * K)}" fill="${steel}"/>`;      // 6 — нижний узел
  // 3 — подвесной изолятор на конце консоли и 7 — седло несущего троса
  const hang = onArm(3.15);
  s += insulator([hang[0], hang[1] + .12 * K], [HT[0], HT[1] - .2 * K], 4, .13) + line([[HT[0], HT[1] - .2 * K], HT], .04) +
    `<circle cx="${n(HT[0])}" cy="${n(HT[1])}" r="${n(.06 * K)}" fill="${steel}"/>`;
  // 2 — фиксатор: хомут на консоли, 4 — фиксаторный изолятор, труба, изогнутая стойка к контактному проводу
  const clamp = onArm(.84), FY = 5.7 + slope * .84;
  s += `<circle cx="${n(clamp[0])}" cy="${n(clamp[1])}" r="${n(.07 * K)}" fill="${steel}"/>` +
    insulator(pt(.98, FY), pt(1.5, FY), 5, .1) + line([pt(1.5, FY), pt(2.9, FY)], .045) +
    line([pt(2.32, FY), pt(2.32, FY - .13), pt(2.74, FY - .13), KP], .04) +
    `<circle cx="${n(KP[0])}" cy="${n(KP[1])}" r="${n(.05 * K)}" fill="${steel}"/>` +
    line([HT, pt(2.84, FY + .03)], .022);                                         // 8 — наклонная струна от троса к фиксатору
  // --- провода: несущий трос (вершины дуги — у сёдел), контактный провод, струны ---
  const saddle = halfW(SUPPORT) + 3.15;               // седло — на столько правее оси стойки
  const messenger = (/** @type {number} */ dx) => SUPPORT - SAG * (1 - (1 - Math.abs(dx) / (W / 2)) ** 2);
  let d = "";
  for (let i = 0; i <= 100; i++) {
    const xm = W * i / 100, dx = ((xm - cx - saddle + W * 1.5) % W) - W / 2;
    d += `${i ? "L" : "M"}${n(x(xm))} ${n(y(messenger(dx)))}`;
  }
  s += `<path d="${d}" fill="none" stroke="${wire}" stroke-width="${n(.024 * K)}"/>` +
    `<path d="M0 ${n(y(CONTACT))}H${W * K}" stroke="${wire}" stroke-width="${n(.03 * K)}"/>`;
  let drop = "";
  for (let dx = -18; dx <= 18.01; dx += 4) {
    if (Math.abs(dx) < 1) continue;                   // у самой опоры трос держит седло, а провод — фиксатор
    const xm = ((cx + saddle + dx) % W + W) % W;
    drop += `M${n(x(xm))} ${n(y(messenger(dx)))}V${n(y(CONTACT))}`;
  }
  s += `<path d="${drop}" stroke="${wire}" stroke-width="${n(.014 * K)}" fill="none"/>`;
  save("catenary", W * K, H * K, s, [W, H], "опора контактной сети по типовому чертежу (консоль, тяга, подкос, подвесной изолятор, фиксатор) и цепная подвеска, пролёт 40 м; опора — в середине; повторяется по ширине; низ — на уровне пола платформы");
}

/* ---------- фонарь ---------- */
{
  const K = 160, W = 1.5, H = 5.9, lx = .45, pw = .14;
  const s = `<rect x="${n((lx - pw / 2) * K)}" y="${n(.42 * K)}" width="${n(pw * K)}" height="${n((H - .42) * K)}" fill="${M.post}"/>` +
    `<rect x="${n(lx * K)}" y="${n(.42 * K)}" width="${n(pw / 2 * K)}" height="${n((H - .42) * K)}" fill="#000" opacity=".2"/>` +
    `<rect x="${n((lx - pw * .35) * K)}" y="${n(.42 * K)}" width="${n(pw * .18 * K)}" height="${n((H - .42) * K)}" fill="#fff" opacity=".14"/>` +
    `<rect x="${n((lx - pw * .9) * K)}" y="${n((H - .5) * K)}" width="${n(pw * 1.8 * K)}" height="${n(.5 * K)}" fill="${M.post}"/>` +
    `<path d="M${n(lx * K)} ${n(.52 * K)}q${n(.1 * K)} ${n(-.36 * K)} ${n(.5 * K)} ${n(-.36 * K)}" stroke="${M.post}" stroke-width="${n(pw * .55 * K)}" fill="none"/>` +
    `<rect x="${n((lx + .25) * K)}" y="${n(.04 * K)}" width="${n(.78 * K)}" height="${n(.22 * K)}" rx="${n(.06 * K)}" fill="${M.lamp}"/>` +
    `<rect x="${n((lx + .31) * K)}" y="${n(.2 * K)}" width="${n(.66 * K)}" height="${n(.07 * K)}" rx="${n(.03 * K)}" fill="#fff4d6"/>`;
  save("lamp", W * K, H * K, s, [W, H], `фонарь; стойка — в ${lx} м от левого края, светильник — справа вверху`);
}

/* ---------- облака: гроздья клубов, в три тона; разной формы и размера; перистые полоски ---------- */
// Кучевое облако — гроздь круглых клубов: ряд небольших вдоль низа (низ получается волнистым, к краям клубы мельчают),
// над ним — клубы крупнее, в середине самые большие. Тон: белый верх каждого клуба, голубоватая тень в его нижней
// правой части (внутри облака получаются мягкие дуги), вдоль самого низа — тень чуть гуще.
// 1–3 — небольшие (ясная погода), 4–6 — кучевые, 7 — длинное низкое, 8–9 — тяжёлые (пасмурно, осадки),
// 10–11 — перистые полоски (высоко, в ясную погоду).
const CLOUDS = [
  // [ширина м, высота (доля ширины), зерно]
  [3.4, .46, 5], [4.6, .4, 12], [3.9, .56, 31],
  [7.2, .36, 3], [9.2, .29, 44], [6.4, .44, 17],
  [12, .19, 9],
  [13, .29, 27], [15.5, .25, 61],
];
CLOUDS.forEach(([w, aspect, seed], index) => {
  const K = 88, random = rng(seed), h = w * aspect;
  /** @type {number[][]} клубы в порядке отрисовки (дальние — первыми): [x, y, радиус]; y вниз, 0 — линия основания */
  const puffs = [];
  const bulge = (/** @type {number} */ t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** .7;        // к краям клубы мельчают
  // нижний ряд: клубы идут вплотную, каждый перекрывает соседа — отдельных шариков по краям не остаётся
  const r0 = h * .3;
  for (let x = 0; x < w;) {
    const r = r0 * (.4 + .6 * bulge(x / w)) * (.85 + .3 * random());
    puffs.push([x + r * .55, -r * (.3 + .25 * random()), r]);
    x += r * (1.05 + .25 * random());
  }
  const span = puffs[puffs.length - 1][0] + puffs[puffs.length - 1][2] * .5;                                // настоящая ширина ряда
  // средний ряд — крупнее, уже
  const r1 = h * .36;
  for (let x = span * .14; x < span * .86;) {
    const t = x / span, r = r1 * (.5 + .5 * bulge(.1 + .8 * t)) * (.85 + .3 * random());
    puffs.push([x + r * .5, -r0 * .6 - r * (.2 + .3 * random()), r]);
    x += r * (.85 + .3 * random());
  }
  // вершина: один-три больших клуба ближе к середине
  const nt = aspect > .42 ? 1 + Math.floor(random() * 2) : aspect > .27 ? 1 + Math.floor(random() * 2.5) : 0;
  for (let k = 0; k < nt; k++) {
    const r = h * .34 * (.82 + .36 * random()), cx = span * (.3 + .4 * (nt === 1 ? .3 + .4 * random() : k / (nt - 1)) + (random() - .5) * .06);
    puffs.push([cx, -(h - r) * (.74 + .14 * random()), r]);
  }
  const pad = .12, minX = Math.min(...puffs.map(([x, , r]) => x - r)), maxX = Math.max(...puffs.map(([x, , r]) => x + r));
  const topY = Math.min(...puffs.map(([, y, r]) => y - r)), botY = Math.max(...puffs.map(([, y, r]) => y + r));
  const W = maxX - minX + 2 * pad, H = botY - topY + 2 * pad, ox = pad - minX, oy = pad - topY;
  const circle = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {string} */ fill) =>
    `<circle cx="${n((x + ox) * K)}" cy="${n((y + oy) * K)}" r="${n(r * K)}" fill="${fill}"/>`;
  // каждый клуб — круг тени и поверх него светлый круг, сдвинутый вверх и влево и обрезанный по клубу: сверху
  // и слева клуб белый до самого края (без обводки), снизу справа остаётся серп тени. Верхние клубы рисуются
  // поверх нижних, поэтому их тени ложатся мягкими дугами внутри облака; у нижнего ряда тень гуще.
  let defs = "", s = "";
  puffs.forEach(([x, y, r], i) => {
    const low = y > -r0 * .65;
    defs += `<clipPath id="p${i}"><circle cx="${n((x + ox) * K)}" cy="${n((y + oy) * K)}" r="${n(r * K)}"/></clipPath>`;
    s += circle(x, y, r, low ? "#bfcde1" : "#d0dcec") +
      `<circle cx="${n((x + ox - r * .1) * K)}" cy="${n((y + oy - r * .17) * K)}" r="${n(r * .97 * K)}" fill="#ffffff" clip-path="url(#p${i})"/>`;
  });
  s = `<defs>${defs}</defs>${s}`;
  save(`cloud-${index + 1}`, W * K, H * K, s, [W, H], index < 3 ? "небольшое кучевое облако" : index < 6 ? "кучевое облако" : index === 6 ? "длинное низкое облако" : "тяжёлое облако (пасмурно, осадки)");
});
// перистые облака: тонкая изогнутая полоска с заострёнными концами
[[9.5, .62, 4], [6.2, .44, 15]].forEach(([w, h, seed], index) => {
  const K = 88, random = rng(seed), pad = .1, W = w + 2 * pad, H = h + 2 * pad;
  const X = (/** @type {number} */ t) => (pad + w * t) * K, Y = (/** @type {number} */ v) => (pad + h * v) * K;
  const bend = .25 + .3 * random(), mid = .35 + .3 * random();
  // верхняя и нижняя кромки — две плавные кривые, сходящиеся на концах
  const d = `M${n(X(0))} ${n(Y(.75))}C${n(X(.2))} ${n(Y(.1 + bend * .3))} ${n(X(mid))} ${n(Y(0))} ${n(X(.62))} ${n(Y(.22))}S${n(X(.9))} ${n(Y(.05))} ${n(X(1))} ${n(Y(.2))}` +
    `C${n(X(.9))} ${n(Y(.5))} ${n(X(.75))} ${n(Y(.62))} ${n(X(.6))} ${n(Y(.6))}S${n(X(.25))} ${n(Y(.95))} ${n(X(0))} ${n(Y(.75))}Z`;
  const s = `<defs><clipPath id="body"><path d="${d}"/></clipPath></defs><path d="${d}" fill="#d6e0ee"/><g clip-path="url(#body)"><path d="${d}" fill="#ffffff" transform="translate(${n(-.02 * K)} ${n(-.07 * K)})"/></g>`;
  save(`cloud-${CLOUDS.length + index + 1}`, W * K, H * K, s, [W, H], "перистое облако — тонкая полоска");
});

writeFileSync(join(OUT, "sprites.json"), JSON.stringify(manifest, null, 1) + "\n");
for (const [name, v] of Object.entries(manifest)) console.log(`${name.padEnd(20)} ${v.size.join(" × ")} м — ${v.note}`);
