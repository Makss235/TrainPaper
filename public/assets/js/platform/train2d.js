// Поезд в перспективе, стилизованно: вагоны ФПК по векторной ливрее из lib/coach.js и электровоз.
//
// Форма кузова — по торцевому виду схемы окраски: борт вертикален на 2,83 м от низа кузова
// (дверь прямая на всю высоту), выше — крутое «плечо» (0,75 м вверх на 0,58 м внутрь) и почти
// плоская крыша. Ливрея над окнами изгибается вместе с плечом; каждая полоса плеча — свой тон.
import { BODY_BOTTOM_M, CAR_L, coachShapes, GAP, H_M, RZD_LOGO } from "../lib/coach.js";
import { roundRect } from "../lib/geom.js";
import { MATERIALS } from "../lib/palette.js";
import { clipAxis, corners, hex } from "./view2d.js";
import { drawImageQuad, paintPlate, PLATE_H, PLATE_W, plateCanvas } from "./plate2d.js";
import { EDGE, floorGlow, LAMPS, planeGlow, PLATFORM_TOP, pointGlow, TRACK } from "./scene2d.js";

export const CAR_LEN = CAR_L * H_M;              // 25,5 м
export const PITCH_M = (CAR_L + GAP) * H_M;
const HALF = 1.7, SIDE = TRACK - HALF;           // борт вагона со стороны платформы
const WALL_H = 2.83;                             // вертикальная часть борта
const WALL_TOP = BODY_BOTTOM_M + WALL_H;         // ≈ 3,78 м над рельсом
const WALL_V = WALL_H / H_M;                     // та же граница в единицах ливреи (≈ 0,88)
// поперечный профиль верха: (внутрь от борта, вверх от верха стенки), м — снято с торцевого вида
const SHOULDER = [[0, 0], [.07, .13], [.15, .27], [.24, .4], [.38, .53], [.49, .66], [.58, .75], [1.04, .84], [HALF, .88]];
const ROOF_TOP = WALL_TOP + .88;
const LOCO_LEN = 19.6, LOCO_HALF = 1.58, LOCO_SIDE = TRACK - LOCO_HALF;
const LOCO_BOTTOM = 1.0, LOCO_TOP = 4.0;
const CARS = 6;

const M = Object.fromEntries(Object.entries(MATERIALS).map(([k, v]) => [k, hex(v)]));
const SIDE_N = [-1, 0, 0];
const mixRgb = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const mulRgb = (a, k) => a.map(x => x * k);

/** Смещение профиля внутрь на высоте dy над верхом стенки. */
function shoulderDx(dy) {
  if (dy <= 0) return 0;
  for (let i = 1; i < SHOULDER.length; i++) {
    const [xa, ya] = SHOULDER[i - 1], [xb, yb] = SHOULDER[i];
    if (dy <= yb) return xa + (xb - xa) * (dy - ya) / (yb - ya);
  }
  return HALF;
}

/** Нормаль участка профиля (наружу, к платформе и вверх). */
function segNormal(a, b) {
  const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty);
  return [-ty / l, tx / l, 0];
}

// полосы ливреи по высоте: стенка и три участка плеча (до карниза, v ≈ 1), у каждой — своя нормаль
const BANDS = [[-1, WALL_V, SIDE_N]];
for (let i = 0; i < 3; i++) {
  BANDS.push([WALL_V + SHOULDER[i][1] / H_M, i === 2 ? 1.2 : WALL_V + SHOULDER[i + 1][1] / H_M, segNormal(SHOULDER[i], SHOULDER[i + 1])]);
}

/* ---------- логотип: контур официального пути, разбитый на многоугольники ---------- */

let logoPolys = null;
function getLogoPolys() {
  if (logoPolys) return logoPolys;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;width:0;height:0;visibility:hidden";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", RZD_LOGO);
  svg.append(path);
  document.body.append(svg);
  const len = path.getTotalLength(), step = .12, polys = [];
  let cur = [], prev = null;
  for (let s = 0; s <= len; s += step) {
    const p = path.getPointAtLength(s);
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > step * 4) { if (cur.length > 2) polys.push(cur); cur = []; }
    cur.push([p.x, p.y]);
    prev = p;
  }
  if (cur.length > 2) polys.push(cur);
  svg.remove();
  return (logoPolys = polys);
}

/* ---------- табличка и надпись ---------- */

const plate = plateCanvas();
let plateTrain;
export function setPlate(train) {
  plateTrain = train;
  paintPlate(plate, train);
}
document.fonts?.ready.then(() => paintPlate(plate, plateTrain));

const fpk = (() => {
  const c = document.createElement("canvas");
  c.width = 160; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = MATERIALS.print;
  g.font = '700 52px "Exo 2", sans-serif';
  g.textAlign = "center";
  g.fillText("ФПК", 80, 52);
  return c;
})();

const CAR_SHAPES = Array.from({ length: CARS }, (_, k) => coachShapes({ rear: k === 0, index: k })
  .filter(s => !(s.cls === "f-roof" || s.cls === "f-roofbox")));

function lineQuad(s) {
  const [[ua, va], [ub, vb]] = s.line, hw = s.w / 2;
  return Math.abs(ua - ub) < 1e-6
    ? [[ua - hw, va], [ua + hw, va], [ub + hw, vb], [ub - hw, vb]]
    : [[ua, va - hw], [ub, vb - hw], [ub, vb + hw], [ua, va + hw]];
}

const OVERLAY = { "o-dark1": "rgba(0,0,0,.1)", "o-dark2": "rgba(0,0,0,.2)", "o-light1": "rgba(255,255,255,.14)" };

/* ---------- борт вагона ---------- */

/** Точка ливреи (u вдоль вагона, v по высоте) → мир, с изгибом по плечу кузова. */
function sidePoint(z0, u, vv, inset = 0) {
  const y = BODY_BOTTOM_M + vv * H_M;
  return [SIDE + shoulderDx(y - WALL_TOP) + inset, y, z0 + u * H_M];
}

/** Многоугольник ливреи: режется по полосам высоты, каждая часть — тоном своей полосы. */
function fillBanded(v, ctx, pts, z0, color, at, extra) {
  for (const [lo, hi, n] of BANDS) {
    const part = clipAxis(pts, 1, lo, hi);
    if (part.length < 3) continue;
    ctx.beginPath();
    if (!v.path(ctx, part.map(([u, vv]) => sidePoint(z0, u, vv)))) continue;
    ctx.fillStyle = typeof color === "string" ? color : v.shade(color, n, at, { extra });
    ctx.fill();
  }
}

function drawCarSide(v, ctx, shapes, z0, night) {
  const at = sidePoint(z0, CAR_L / 2, .5);
  if (v.dist(at) > 2600) return;
  const extra = -night * .04;                     // ночью борт освещают только фонари
  for (const s of shapes) {
    if (s.kind === "window" || s.kind === "doorWindow") { drawWindow(v, ctx, s, z0, night); continue; }
    if (s.kind === "logo") { drawLogo(v, ctx, s, z0, at, extra); continue; }
    if (s.kind === "text") {
      const w = .16, h = w * fpk.height / fpk.width;
      drawImageQuad(ctx, fpk, (a, b) => v.screen(sidePoint(z0, s.u - w / 2 + a * w, s.v + h * .25 - b * h)), 4);
      continue;
    }
    if (s.kind === "tail") continue;
    const pts = s.pts || (s.line && lineQuad(s));
    if (!pts) continue;
    const cls = s.pts ? s.cls : s.cls.replace("s-", "f-").replace("-v", "");
    fillBanded(v, ctx, pts, z0, OVERLAY[cls] || M[cls.slice(2)] || M.body, at, extra);
    if (s.stroke) {
      ctx.beginPath();
      v.path(ctx, pts.map(([u, vv]) => sidePoint(z0, u, vv)));
      ctx.lineWidth = Math.max(.6, s.sw * H_M * v.f / v.dist(at));
      ctx.strokeStyle = v.shade(M[s.stroke.slice(2)], SIDE_N, at);
      ctx.stroke();
    }
  }
}

function drawLogo(v, ctx, s, z0, at, extra) {
  for (const poly of getLogoPolys()) {
    let pts = poly.map(([x, y]) => [s.u0 + x * s.k, s.v0 - y * s.k]);
    if (s.clipTop) pts = clipAxis(pts, 1, -1, s.clipTop);
    if (pts.length > 2) fillBanded(v, ctx, pts, z0, M.red, at, extra);
  }
}

/**
 * Окно как на схеме: стекло почти вровень с бортом, тонкий тёмный уплотнитель по контуру,
 * тёмная верхняя часть (шторка), сверху — узкая тень от рамы.
 */
function drawWindow(v, ctx, s, z0, night) {
  const isWin = s.kind === "window";
  const [u0, v0, u1, v1] = isWin ? [s.u0, s.v0, s.u1, s.v1]
    : [Math.min(...s.pts.map(p => p[0])), Math.min(...s.pts.map(p => p[1])), Math.max(...s.pts.map(p => p[0])), Math.max(...s.pts.map(p => p[1]))];
  const r = isWin ? s.r : (u1 - u0) / 2 - 1e-4;
  const P = (u, vv) => sidePoint(z0, u, vv, .01);
  const at = P((u0 + u1) / 2, (v0 + v1) / 2), d = v.dist(at);
  if (d > 900) return;
  const outline = roundRect(u0, v0, u1, v1, r, 5).map(([u, vv]) => P(u, vv));
  const top = v.screen(P((u0 + u1) / 2, v1)), bot = v.screen(P((u0 + u1) / 2, v0));
  if (!top || !bot) return;
  const day = v.light.reflect;
  ctx.save();
  ctx.beginPath();
  if (!v.path(ctx, outline)) { ctx.restore(); return; }
  ctx.clip();
  // стекло: днём отражает небо, ночью светится тёплым
  const g = ctx.createLinearGradient(0, top[1], 0, bot[1]);
  g.addColorStop(0, v.fogged(mixRgb(v.light.skyTop, [255, 214, 150], night), at));
  g.addColorStop(.55, v.fogged(mixRgb(v.light.skyHorizon, [255, 226, 168], night), at));
  g.addColorStop(1, v.fogged(mixRgb(mulRgb(v.light.skyHorizon, .8), [242, 190, 110], night), at));
  ctx.fillStyle = g;
  ctx.fillRect(Math.min(top[0], bot[0]) - 4000, top[1] - 4, 8000, bot[1] - top[1] + 8);
  if (isWin) {
    ctx.beginPath();
    v.path(ctx, [[u0, s.transom], [u1, s.transom], [u1, v1], [u0, v1]].map(([u, vv]) => P(u, vv)));
    ctx.fillStyle = v.fogged(mixRgb(mulRgb(M.glasstop, .75 + .3 * day), [150, 112, 68], night), at);
    ctx.fill();
  }
  if (s.plate) drawPlate(v, ctx, u0, v0, u1, v1, P);
  if (day > .05) {
    ctx.globalAlpha = .2 * day;
    ctx.beginPath();
    v.path(ctx, [[.14, 0], [.32, 0], [.74, 1], [.56, 1]].map(([a, b]) => P(u0 + (u1 - u0) * a, v0 + (v1 - v0) * b)));
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // узкая тень от рамы сверху
  ctx.beginPath();
  v.path(ctx, [[u0, v1 - .022], [u1, v1 - .022], [u1, v1], [u0, v1]].map(([u, vv]) => P(u, vv)));
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fill();
  ctx.restore();
  // уплотнитель по контуру — тонкая тёмная линия
  ctx.beginPath();
  v.path(ctx, outline);
  ctx.lineWidth = Math.max(.6, .026 * v.f / d);
  ctx.strokeStyle = v.shade(M.frame, SIDE_N, at);
  ctx.stroke();
}

/** Маршрутная табличка за стеклом: целиком в окне, без швов (полоски внахлёст под общей обрезкой). */
function drawPlate(v, ctx, u0, v0, u1, v1, P) {
  const mu = (u1 - u0) * .07;
  const pu0 = u0 + mu, pu1 = u1 - mu;
  const ph = (pu1 - pu0) * PLATE_H / PLATE_W;
  const pv0 = v0 + (v1 - v0) * .1, pv1 = Math.min(pv0 + ph, s_transomSafe(v0, v1));
  const at = (a, b) => P(pu0 + (pu1 - pu0) * a, pv1 - (pv1 - pv0) * b);
  ctx.save();
  ctx.beginPath();
  if (!v.path(ctx, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)])) { ctx.restore(); return; }
  ctx.clip();
  drawImageQuad(ctx, plate, (a, b) => v.screen(at(a, b)), 28, true);
  // табличка освещена как купе: в сумерках темнее, ночью подсвечена изнутри
  ctx.beginPath();
  v.path(ctx, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);
  ctx.fillStyle = `rgba(10,14,28,${Math.max(0, .55 - v.light.plateLight).toFixed(3)})`;
  ctx.fill();
  ctx.restore();
}
const s_transomSafe = (v0, v1) => v0 + (v1 - v0) * .7;

/* ---------- крыша, торцы, переходы ---------- */

/** Крыша выше карниза: грани профиля, видимые снизу, каждая своим тоном. */
function drawRoof(v, ctx, x0, z0, z1, base) {
  const start = SHOULDER.findIndex(([, dy]) => dy >= .4);
  for (let i = start; i < SHOULDER.length - 1; i++) {
    const a = [x0 + SHOULDER[i][0], WALL_TOP + SHOULDER[i][1]], b = [x0 + SHOULDER[i + 1][0], WALL_TOP + SHOULDER[i + 1][1]];
    const n = segNormal(a, b), p = [a[0], a[1], (z0 + z1) / 2];
    if (!v.faces(n, p)) continue;
    v.fill(ctx, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], v.shade(base, n, p));
  }
}

function endProfile() {
  const left = [[SIDE, BODY_BOTTOM_M], ...SHOULDER.map(([dx, dy]) => [SIDE + dx, WALL_TOP + dy])];
  const right = left.slice(0, -1).reverse().map(([x, y]) => [2 * TRACK - x, y]);
  return [...left, ...right];
}
const END_PROFILE = endProfile();

/** Торец вагона, видимый в промежутке: тёмно-серый, дверь с козырьком — как на торцевом виде схемы. */
function drawCarEnd(v, ctx, z, facing) {
  const n = [0, 0, facing], p = [TRACK, 2.5, z];
  if (!v.faces(n, p)) return;
  const at = q => [q[0], q[1], z + facing * .01];
  v.fill(ctx, END_PROFILE.map(([x, y]) => [x, y, z]), v.shade(M.darkend, n, p));
  v.fill(ctx, [[TRACK - .5, 3.5], [TRACK + .5, 3.5], [TRACK + .5, 3.62], [TRACK - .5, 3.62]].map(at), v.shade(M.frame, n, p));
  v.fill(ctx, [[TRACK - .42, 1.05], [TRACK + .42, 1.05], [TRACK + .42, 3.5], [TRACK - .42, 3.5]].map(at), v.shade(M.darkdoor, n, p, { extra: -.05 }));
}

function drawBellows(v, ctx, z0, z1) {
  v.box(ctx, M.bellows, [TRACK - .75, TRACK + .75], [1.2, 3.85], [z0, z1]);
  const at = [TRACK - .75, 2.5, (z0 + z1) / 2];
  ctx.beginPath();
  for (let z = z0 + .04; z < z1; z += .07) v.seg(ctx, [TRACK - .751, 1.25, z], [TRACK - .751, 3.8, z]);
  ctx.lineWidth = Math.max(.6, .02 * v.f / v.dist(at));
  ctx.strokeStyle = v.shade(M.fold, SIDE_N, at);
  ctx.stroke();
}

/* ---------- электровоз ---------- */

const LOCO_CANT = [[0, 0], [.06, .18], [.2, .32], [.45, .42], [.9, .48], [LOCO_HALF, .5]];

function drawLocoCant(v, ctx, z0, z1, base) {
  for (let i = 0; i < LOCO_CANT.length - 1; i++) {
    const a = [LOCO_SIDE + LOCO_CANT[i][0], LOCO_TOP + LOCO_CANT[i][1]], b = [LOCO_SIDE + LOCO_CANT[i + 1][0], LOCO_TOP + LOCO_CANT[i + 1][1]];
    const n = segNormal(a, b), p = [a[0], a[1], (z0 + z1) / 2];
    if (!v.faces(n, p)) continue;
    v.fill(ctx, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], v.shade(base, n, p));
  }
}

function drawLoco(v, ctx, z0) {
  const z1 = z0 + LOCO_LEN, mid = [LOCO_SIDE, 2.5, (z0 + z1) / 2];
  const sideCol = base => v.shade(base, SIDE_N, mid);
  const Y = t => LOCO_BOTTOM + t * (LOCO_TOP - LOCO_BOTTOM);
  const quad = (za, zb, ya, yb, x = LOCO_SIDE) => [[x, ya, za], [x, ya, zb], [x, yb, zb], [x, yb, za]];
  v.fill(ctx, quad(z0, z1, Y(0), Y(1)), sideCol(M.red));
  v.fill(ctx, quad(z0, z1, Y(0), Y(.18)), sideCol(M.band));
  v.fill(ctx, quad(z0, z1, Y(.18), Y(.21)), sideCol(M.body));
  for (let z = z0 + 3.2; z < z1 - 4.5; z += 1.5) v.fill(ctx, quad(z, z + .9, Y(.55), Y(.8)), sideCol(mulRgb(M.red, .72)));
  v.fill(ctx, quad(z1 - 2.6, z1 - .8, Y(.6), Y(.88)), sideCol(M.frame));
  v.fill(ctx, quad(z1 - 3.3, z1 - 2.75, Y(.22), Y(.9)), sideCol(mulRgb(M.red, .8)));
  drawLocoCant(v, ctx, z0, z1, mulRgb(M.red, .95));
  v.box(ctx, mulRgb(M.roof, 1.2), [TRACK - .9, TRACK + .9], [LOCO_TOP + .45, LOCO_TOP + .72], [z0 + 5, z0 + 14]);
  const n = [0, 0, 1], front = [TRACK, 2.5, z1];
  if (v.faces(n, front)) {
    const left = [[LOCO_SIDE, LOCO_BOTTOM], ...LOCO_CANT.map(([dx, dy]) => [LOCO_SIDE + dx, LOCO_TOP + dy])];
    const prof = [...left, ...left.slice(0, -1).reverse().map(([x, y]) => [2 * TRACK - x, y])];
    v.fill(ctx, prof.map(([x, y]) => [x, y, z1]), v.shade(M.red, n, front));
    v.fill(ctx, [[LOCO_SIDE, Y(0)], [2 * TRACK - LOCO_SIDE, Y(0)], [2 * TRACK - LOCO_SIDE, Y(.18)], [LOCO_SIDE, Y(.18)]].map(q => [q[0], q[1], z1 + .01]), v.shade(M.band, n, front));
    for (const [xa, xb] of [[-1.35, -.08], [.08, 1.35]]) {
      v.fill(ctx, [[TRACK + xa, Y(.62)], [TRACK + xb, Y(.62)], [TRACK + xb, Y(.9)], [TRACK + xa, Y(.9)]].map(q => [q[0], q[1], z1 + .01]), v.shade(M.frame, n, front, { extra: -.1 }));
    }
    for (const x of [-1.05, 1.05]) additive(ctx, () => pointGlow(v, ctx, [TRACK + x, Y(.25), z1 + .05], .9, HEAD, .55 + .45 * v.light.lamps));
  }
}

const HEAD = [[0, "rgba(255,250,235,1)"], [.25, "rgba(255,240,210,.55)"], [1, "rgba(255,230,190,0)"]];
const TAIL = [[0, "rgba(255,60,40,.9)"], [.4, "rgba(255,40,20,.35)"], [1, "rgba(255,20,10,0)"]];
const WARM = [[0, "rgba(255,214,150,.9)"], [.45, "rgba(255,206,140,.4)"], [1, "rgba(255,200,130,0)"]];
function additive(ctx, draw) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  draw();
  ctx.restore();
}

/* ---------- состав ---------- */

/** Положение вагонов: хвост последнего вагона — в zRear. */
export function carSpans(zRear) {
  const spans = [];
  for (let k = 0; k < CARS; k++) spans.push({ k, z0: zRear + k * PITCH_M, z1: zRear + k * PITCH_M + CAR_LEN });
  return spans;
}
export const TRAIN_LENGTH = CARS * PITCH_M + LOCO_LEN;

export function drawTrain(v, ctx, zRear) {
  const night = v.light.lamps;
  const camZ = v.pos[2];
  // красный отсвет хвостовых огней на пути позади поезда — до вагонов: вагон его заслоняет
  if (night > .02) additive(ctx, () => floorGlow(v, ctx, [TRACK, .02, zRear - 3.2], 1.9, TAIL, night * .6, 3.6));
  for (const { k, z0, z1 } of carSpans(zRear)) {
    if (z0 > camZ + 2 || z1 < -2600) continue;
    if (k > 0) drawBellows(v, ctx, z0 - GAP * H_M - .05, z0 + .05);
    if (k === 0) drawBellows(v, ctx, z0 - .22, z0 + .05);
    drawCarEnd(v, ctx, z1, 1);
    drawCarSide(v, ctx, CAR_SHAPES[k], z0, night);
    drawRoof(v, ctx, SIDE, z0, z1, M.roof);
  }
  const lz = zRear + CARS * PITCH_M;
  if (lz < camZ + 2) {
    drawBellows(v, ctx, lz - GAP * H_M - .05, lz + .05);
    drawLoco(v, ctx, lz);
  }
  drawLampsOnSide(v, ctx, zRear);
}

/** Тёплый свет фонарей платформы на борту поезда — мягкими пятнами, только по кузову. */
function drawLampsOnSide(v, ctx, zRear) {
  const k = v.light.lamps;
  if (k < .02) return;
  ctx.save();
  ctx.beginPath();
  for (const q of sideQuads(zRear)) v.path(ctx, q);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  for (const z of LAMPS) {
    if (z > v.pos[2] + 14 || z < -150) continue;
    planeGlow(v, ctx, [SIDE - .01, 2.4, z], [0, 0, 11], [0, 2.4, 0], WARM, k * .4);
  }
  ctx.restore();
}

/** Свет окон на платформе ночью: мягкие пятна у края платформы. */
export function drawWindowSpill(v, ctx, zRear) {
  const k = v.light.lamps;
  if (k < .02) return;
  additive(ctx, () => {
    for (const { k: car, z0 } of carSpans(zRear)) {
      for (const s of CAR_SHAPES[car]) {
        if (s.kind !== "window") continue;
        const zc = z0 + (s.u0 + s.u1) / 2 * H_M, half = (s.u1 - s.u0) / 2 * H_M;
        if (zc > v.pos[2] - 1 || zc < -140) continue;
        planeGlow(v, ctx, [EDGE - .55, PLATFORM_TOP + .004, zc], [1.1, 0, 0], [0, 0, half + 1], WARM, k * .42);
      }
    }
  });
}

/** Борт каждого вагона — маска для теней и света, падающих на поезд. */
export function sideQuads(zRear) {
  const out = carSpans(zRear).map(({ z0, z1 }) => [[SIDE, BODY_BOTTOM_M - .2 * H_M, z0], [SIDE, BODY_BOTTOM_M - .2 * H_M, z1],
    [SIDE, WALL_TOP, z1], [SIDE + .24, WALL_TOP + .4, z1], [SIDE + .24, WALL_TOP + .4, z0], [SIDE, WALL_TOP, z0]]);
  const lz = zRear + CARS * PITCH_M;
  out.push([[LOCO_SIDE, LOCO_BOTTOM, lz], [LOCO_SIDE, LOCO_BOTTOM, lz + LOCO_LEN], [LOCO_SIDE, LOCO_TOP, lz + LOCO_LEN], [LOCO_SIDE, LOCO_TOP, lz]]);
  return out;
}
export const SIDE_X = SIDE;

/** Поезд как тело, отбрасывающее тень на платформу. */
export function trainCasters(zRear) {
  return [corners(SIDE, SIDE + 2 * HALF, BODY_BOTTOM_M, ROOF_TOP, zRear, zRear + TRAIN_LENGTH)];
}
