// Окружение платформы в стилизованном 2D: земля, город, деревья, пути, платформа, ограда,
// фонари, табло. Каждая грань — плоская заливка своего тона (cel-shading), тени — по геометрии.
import { MATERIALS } from "../lib/palette.js";
import { clipAxis, corners, DEPTHS, hex, hull } from "./view2d.js";

export const PLATFORM_TOP = 1.1;
export const EDGE = 2.5;
export const FENCE = -4.2;
export const TRACK = 4.42, TRACK2 = 9.7;
export const BOARD = { z: -6.3, x0: -3.2, x1: -.4, y0: 3.37, y1: 4.35, depth: .22 };
const GROUND = -.32;
const UP = [0, 1, 0];

const C = Object.fromEntries(Object.entries({
  ...MATERIALS,
  ground: "#86926f", ground2: "#7c8a68", platform: "#c4c4bf", tileLine: "#a7a8a2", coping: "#e0dfd8",
  ballast: "#8a8378", ballastFar: "#8f897f", sleeper: "#8e8a82", rail: "#7d8287", railTop: "#c6cace",
  fence: "#2b2e32", post: "#3a3e43", lamp: "#4b4f54", trunk: "#5b4636",
  concrete: "#a9aaa6", concreteDark: "#8e8f8b", steel: "#7f858c", wire: "#33373c", insulator: "#5c3d2e",
  city: "#9aa6b3", city2: "#adb7c2", city3: "#8f9ba8", bridge: "#7c8590",
}).map(([k, v]) => [k, hex(v)]));
export const COLORS = C;

function rng(seed) {
  return () => (seed = seed * 16807 % 2147483647) / 2147483647;
}

/* ---------- статичные данные сцены ---------- */

const random = rng(17);
const TREE_TONES = ["#4f7a4a", "#5d8650", "#557c58", "#678f55", "#4a6f4f"].map(hex);
export const TREES = [];
for (const [X, from, to, step] of [[-15, 30, 700, 9], [18, 25, 700, 11]]) {
  for (let d = from; d < to; d += step * (.8 + random() * .4)) {
    const r = 2.6 + random() * 2.2, h = 3.6 + random() * 3, tone = TREE_TONES[Math.floor(random() * TREE_TONES.length)];
    const blobs = [[0, 0, r * .95]];
    for (let q = 0; q < 4; q++) blobs.push([(random() - .5) * r * 1.3, (random() - .2) * r * .9, r * (.5 + random() * .3)]);
    TREES.push({ x: X + (random() - .5) * 5, z: -d, h, r, tone, blobs });
  }
}
TREES.sort((a, b) => a.z - b.z);                         // дальние — первыми

const CITY = [];
for (let i = 0; i < 170; i++) {
  const x = (random() - .5) * 2600, z = -900 - random() * 900, w = 20 + random() * 60, h = 12 + random() * 70;
  if (Math.abs(x) < 60) continue;
  CITY.push({ x, z, w, h, dz: 20 + random() * 40, tone: [C.city, C.city2, C.city3][Math.floor(random() * 3)] });
}
CITY.sort((a, b) => a.z - b.z);

export const LAMPS = [];
LAMPS.push(6);                                               // фонарь за спиной зрителя: светит на ближний край
for (let z = -14; z > -330; z -= 24) LAMPS.push(z);

/* ---------- полосы вдоль пути ---------- */

/** Горизонтальная полоса x0…x1 на высоте y, нарезанная по глубине (дымка нарастает к горизонту). */
function strip(v, ctx, x0, x1, y, base, { from = 4, to = -1500, haze = 1 } = {}) {
  for (let i = 0; i < DEPTHS.length - 1; i++) {
    const za = Math.min(DEPTHS[i], from), zb = Math.max(DEPTHS[i + 1], to);
    if (za <= zb) continue;
    v.fill(ctx, [[x0, y, za], [x1, y, za], [x1, y, zb], [x0, y, zb]], v.shade(base, UP, [(x0 + x1) / 2, y, (za + zb) / 2], { haze }));
  }
}

/** Плавное исчезновение мелкой детали: 1 вблизи, 0 на расстоянии far. */
const fadeOut = (d, far) => { const t = Math.max(0, 1 - d / far); return t * t * (3 - 2 * t); };

/**
 * Повторяющиеся поперечные штрихи (швы плитки, шпалы): чем дальше, тем прозрачнее, и исчезают
 * раньше, чем начнут сливаться в рябь. Рисуются пачками по прозрачности.
 */
function fadedRungs(v, ctx, zFrom, step, far, drawOne, style) {
  const groups = 8;
  for (let gI = 0; gI < groups; gI++) {
    const dA = far * gI / groups, dB = far * (gI + 1) / groups;
    const a = fadeOut((dA + dB) / 2, far);
    if (a < .02) continue;
    ctx.beginPath();
    let any = false;
    for (let z = zFrom; z > -far; z -= step) {
      const d = -z;
      if (d < dA || d >= dB) continue;
      drawOne(z);
      any = true;
    }
    if (!any) continue;
    ctx.globalAlpha = a;
    style();
  }
  ctx.globalAlpha = 1;
}

/** Линия вдоль пути (рельс, перила), нарезанная по глубине: толщина и дымка меняются с расстоянием. */
function longLine(v, ctx, x, y, base, widthM, { from = 4, to = -1500, n = UP, alpha = 1, fadeTo = 0 } = {}) {
  for (let i = 0; i < DEPTHS.length - 1; i++) {
    const za = Math.min(DEPTHS[i], from), zb = Math.max(DEPTHS[i + 1], to);
    if (za <= zb) continue;
    const mid = [x, y, (za + zb) / 2], d = Math.max(1, v.dist(mid));
    const k = fadeTo ? fadeOut(d, fadeTo) : 1;
    if (k <= .01) continue;
    ctx.globalAlpha = alpha * k;
    ctx.beginPath();
    v.seg(ctx, [x, y, za], [x, y, zb]);
    ctx.lineWidth = Math.max(.7, widthM * v.f / d);
    ctx.strokeStyle = v.shade(base, n, mid);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ---------- дальний план ---------- */

export function drawGround(v, ctx) {
  for (let i = 0; i < DEPTHS.length - 1; i++) {
    const za = DEPTHS[i], zb = DEPTHS[i + 1];
    v.fill(ctx, [[-4000, GROUND, za], [4000, GROUND, za], [4000, GROUND, zb], [-4000, GROUND, zb]], v.shade(C.ground, UP, [0, 0, (za + zb) / 2]));
  }
  // дальше 1,5 км — к горизонту, в дымке
  v.fill(ctx, [[-9000, GROUND, -1500], [9000, GROUND, -1500], [9000, GROUND, -9000], [-9000, GROUND, -9000]], v.fogged(C.ground, [0, 0, -9000]));
  for (const tone of [C.city, C.city2, C.city3]) {
    ctx.beginPath();
    for (const b of CITY) {
      if (b.tone !== tone) continue;
      v.path(ctx, [[b.x - b.w / 2, GROUND, b.z], [b.x + b.w / 2, GROUND, b.z], [b.x + b.w / 2, b.h, b.z], [b.x - b.w / 2, b.h, b.z]]);
    }
    ctx.fillStyle = v.shade(tone, [0, 0, 1], [0, 30, -1300], { haze: 1.05 });
    ctx.fill();
  }
}

/** Стилизованное дерево: крона из нескольких пятен в два тона — тень и освещённая сторона к солнцу. */
function drawTree(v, ctx, t, lit) {
  const top = [t.x, t.h + t.r * .5, t.z];
  const c = v.screen(top);
  if (!c) return;
  const d = v.dist(top), k = v.f / d;
  if (t.r * k < .9) return;
  // ствол
  const trunkTop = v.screen([t.x, t.h, t.z]), trunkBot = v.screen([t.x, GROUND, t.z]);
  if (trunkTop && trunkBot) {
    ctx.fillStyle = v.shade(C.trunk, [0, 0, 1], top);
    const w = Math.max(.8, .38 * k);
    ctx.fillRect(trunkTop[0] - w / 2, trunkTop[1], w, trunkBot[1] - trunkTop[1]);
  }
  const shadeCol = v.shade(t.tone, null, top, { extra: -.18 });
  const litCol = v.shade(t.tone, lit.n, top, { extra: .02 });
  const blob = () => {
    ctx.beginPath();
    for (const [dx, dy, rr] of t.blobs) {
      const x = c[0] + dx * k, y = c[1] - dy * k;
      ctx.moveTo(x + rr * k, y);
      ctx.arc(x, y, rr * k, 0, Math.PI * 2);
    }
  };
  blob();
  ctx.fillStyle = shadeCol;
  ctx.fill();
  if (t.r * k < 6 || v.light.direct < .03) return;               // без прямого солнца крона в один тон
  // освещённая часть: те же пятна, сдвинутые к солнцу и обрезанные по силуэту кроны
  ctx.save();
  blob();
  ctx.clip();
  ctx.beginPath();
  for (const [dx, dy, rr] of t.blobs) {
    const x = c[0] + dx * k + lit.dx * rr * k, y = c[1] - dy * k + lit.dy * rr * k;
    ctx.moveTo(x + rr * k * lit.scale, y);
    ctx.arc(x, y, rr * k * lit.scale, 0, Math.PI * 2);
  }
  ctx.fillStyle = litCol;
  ctx.fill();
  ctx.restore();
}

/** Направление «к солнцу» на экране — куда сдвигать освещённые пятна крон. */
export function treeLight(v) {
  const L = v.light.L;
  const lx = L[0] * v.c1 - L[2] * v.s1, lz = L[0] * v.s1 + L[2] * v.c1;      // в осях камеры
  const len = Math.hypot(lx, L[1]) || 1;
  const sunUp = Math.max(0, Math.min(1, L[1] * 4 + .2));
  return {
    n: L,
    dx: lx / len * .38,
    dy: -L[1] / len * .38,
    scale: (.58 + .32 * Math.max(0, Math.min(1, lz + .4))) * (.4 + .6 * sunUp),   // солнце за спиной — видим освещённую сторону
  };
}

export function drawTrees(v, ctx, side) {
  const lit = treeLight(v);
  for (const t of TREES) if ((t.x > 0) === (side === "right")) drawTree(v, ctx, t, lit);
}

export function drawBridge(v, ctx) {
  const zb = -165;
  for (const x of [-9, 15]) v.box(ctx, C.bridge, [x - .8, x + .8], [GROUND, 7.6], [zb - .8, zb + .8]);
  v.box(ctx, C.bridge, [-40, 40], [7.2, 7.9], [zb - 1.4, zb + 1.4]);
  v.box(ctx, C.bridge, [-40, 40], [9.8, 10.2], [zb - 1.4, zb + 1.4]);
  ctx.beginPath();
  for (let x = -40; x < 40; x += 3) {
    v.seg(ctx, [x, 7.9, zb + 1.4], [x + 1.5, 9.8, zb + 1.4]);
    v.seg(ctx, [x + 1.5, 9.8, zb + 1.4], [x + 3, 7.9, zb + 1.4]);
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = v.shade(C.bridge, [0, 0, 1], [0, 8, zb]);
  ctx.stroke();
}

/* ---------- пути ---------- */

export function drawTrack(v, ctx, c) {
  strip(v, ctx, c - 2.4, c + 2.4, -.2, C.ballast);
  // шпалы — пока различимы; дальше сливаются в тон балласта
  // шпалы растворяются задолго до того, как начнут сливаться в рябь
  const far = Math.sqrt(v.f * .55 * 2.9 / 3.2);
  fadedRungs(v, ctx, 3, .55, far,
    z => v.path(ctx, [[c - 1.35, -.12, z + .13], [c + 1.35, -.12, z + .13], [c + 1.35, -.12, z - .13], [c - 1.35, -.12, z - .13]]),
    () => { ctx.fillStyle = v.shade(C.sleeper, UP, [c, -.13, -far / 2]); ctx.fill(); });
  for (const r of [c - .76, c + .76]) {
    longLine(v, ctx, r + .045, -.08, C.rail, .06, { n: [1, 0, 0] });      // шейка рельса
    longLine(v, ctx, r, 0, C.railTop, .075);                               // головка — светлая полоса
  }
}

/* ---------- платформа ---------- */

export function drawPlatform(v, ctx) {
  strip(v, ctx, FENCE, 1.7, PLATFORM_TOP, C.platform);
  strip(v, ctx, 1.7, 1.85, PLATFORM_TOP, C.yellow);
  strip(v, ctx, 1.85, 2.25, PLATFORM_TOP, C.tactile);
  strip(v, ctx, 2.25, EDGE + .04, PLATFORM_TOP, C.coping);
  // швы плитки: продольные — на всю длину, поперечные — пока различимы
  ctx.lineCap = "butt";
  for (let X = FENCE + .6; X < 1.7; X += .6) longLine(v, ctx, X, PLATFORM_TOP + .001, C.tileLine, .02, { to: -90, fadeTo: 70, alpha: .8 });
  const far = Math.sqrt(v.f * .6 * 1.65 / 3.5);
  fadedRungs(v, ctx, -.6, .6, far, z => v.seg(ctx, [FENCE, PLATFORM_TOP, z], [1.7, PLATFORM_TOP, z]),
    () => { ctx.lineWidth = 1; ctx.strokeStyle = v.shade(C.tileLine, UP, [0, 1, -8]); ctx.stroke(); });
  // тактильная полоса — ровным тоном с тонкими кромками, без рифления (оно давало рябь)
  for (const X of [1.85, 2.25]) longLine(v, ctx, X, PLATFORM_TOP + .001, C.tileLine, .015, { to: -60, fadeTo: 50, alpha: .7 });
  // кромка: тонкая тёмная щель у края
  longLine(v, ctx, EDGE + .04, PLATFORM_TOP - .02, [40, 40, 42], .03, { to: -900 });
}

/* ---------- ограда, фонари, табло (ближний план) ---------- */

export function drawFence(v, ctx) {
  const y0 = PLATFORM_TOP, y1 = PLATFORM_TOP + 1.12;
  const n = [1, 0, 0];
  // прутья: отдельными линиями, пока различимы; дальше — полупрозрачная лента
  const dMax = Math.sqrt(v.f * .14 * 4.2 / 3);
  fadedRungs(v, ctx, 3, .14, dMax, z => v.seg(ctx, [FENCE, y0, z], [FENCE, y1, z]),
    () => { ctx.lineWidth = 1.2; ctx.strokeStyle = v.shade(C.fence, n, [FENCE, 1.6, -6]); ctx.stroke(); });
  // дальше — полупрозрачная лента; она плавно проявляется там, где исчезают прутья
  for (let i = 0; i < DEPTHS.length - 1; i++) {
    const za = DEPTHS[i], zb = DEPTHS[i + 1];
    const k = 1 - fadeOut(-(za + zb) / 2, dMax);
    if (k < .02) continue;
    ctx.globalAlpha = .5 * k;
    v.fill(ctx, [[FENCE, y0, za], [FENCE, y1, za], [FENCE, y1, zb], [FENCE, y0, zb]], v.shade(C.fence, n, [FENCE, 1.6, (za + zb) / 2]));
  }
  ctx.globalAlpha = 1;
  for (const y of [y1, y0 + .12]) longLine(v, ctx, FENCE, y, C.fence, .05, { n });
  ctx.beginPath();
  for (let z = 4; z > -400; z -= 2.5) {
    if (v.f / Math.abs(z || 1) * 2.5 < 4) break;
    v.seg(ctx, [FENCE, y0, z], [FENCE, y0 + 1.2, z]);
  }
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

export function drawLamps(v, ctx) {
  for (let i = LAMPS.length - 1; i >= 0; i--) {
    const z = LAMPS[i];
    v.box(ctx, C.post, [-3.62, -3.5], [PLATFORM_TOP, PLATFORM_TOP + 5.2], [z - .06, z + .06]);
    v.box(ctx, C.post, [-3.56, -2.7], [PLATFORM_TOP + 5.08, PLATFORM_TOP + 5.16], [z - .04, z + .04]);
    v.box(ctx, C.lamp, [-3.0, -2.35], [PLATFORM_TOP + 5.02, PLATFORM_TOP + 5.16], [z - .15, z + .15], { extra: v.light.lamps * .9 });
  }
}

export function drawBoardFrame(v, ctx) {
  const B = BOARD;
  for (const x of [B.x0 - .08, B.x1 - .06]) v.box(ctx, C.post, [x, x + .14], [PLATFORM_TOP, B.y1 + .42], [B.z - .17, B.z - .03]);
  v.box(ctx, C.post, [B.x0 - .2, B.x1 + .2], [B.y1 + .26, B.y1 + .42], [B.z - .2, B.z]);
  for (const x of [B.x0 + .3, B.x1 - .3]) v.box(ctx, C.post, [x - .02, x + .02], [B.y1 + .04, B.y1 + .27], [B.z - .12, B.z - .08]);
  v.box(ctx, C.fence, [B.x0 - .05, B.x1 + .05], [B.y0 - .05, B.y1 + .05], [B.z - B.depth, B.z]);
}

/* ---------- тени ---------- */

/** Проекция точки вдоль луча солнца на плоскость y = h. */
const toFloor = (p, L, h) => { const t = (p[1] - h) / L[1]; return [p[0] - L[0] * t, h, p[2] - L[2] * t]; };
/** …на вертикальную плоскость x = X (борт вагона). */
export const toSide = (p, L, X) => { const t = (p[0] - X) / L[0]; return [X, p[1] - L[1] * t, p[2] - L[2] * t]; };

/** Тень выпуклого тела (набор точек) на пол y = h, обрезанная полосой x ∈ [xmin, xmax]. */
export function floorShadow(v, g, pts, L, h, xmin, xmax) {
  const flat = hull(pts.map(p => { const q = toFloor(p, L, h); return [q[0], q[2]]; }));
  const shape = clipAxis(flat, 0, xmin, xmax);
  if (shape.length < 3) return;
  g.beginPath();
  if (v.path(g, shape.map(([x, z]) => [x, h, z]))) g.fill();
}

/** Предметы, отбрасывающие тень на платформу и землю: [точки выпуклого тела]. */
export function staticCasters() {
  const B = BOARD, list = [];
  const boxPts = (x0, x1, y0, y1, z0, z1) => corners(x0, x1, y0, y1, z0, z1);
  for (const x of [B.x0 - .08, B.x1 - .06]) list.push(boxPts(x, x + .14, PLATFORM_TOP, B.y1 + .42, B.z - .17, B.z - .03));
  list.push(boxPts(B.x0 - .2, B.x1 + .2, B.y1 + .26, B.y1 + .42, B.z - .2, B.z));
  list.push(boxPts(B.x0 - .05, B.x1 + .05, B.y0 - .05, B.y1 + .05, B.z - B.depth, B.z));
  for (const z of LAMPS) {
    list.push(boxPts(-3.62, -3.5, PLATFORM_TOP, PLATFORM_TOP + 5.2, z - .06, z + .06));
    list.push(boxPts(-3.56, -2.35, PLATFORM_TOP + 5.02, PLATFORM_TOP + 5.16, z - .15, z + .15));
  }
  for (const y of [PLATFORM_TOP + 1.12, PLATFORM_TOP + .12]) list.push(boxPts(FENCE - .025, FENCE + .025, y - .025, y + .025, -1500, 4));
  for (const t of TREES) {
    const cy = t.h + t.r * .5, r = t.r * 1.05;
    list.push(boxPts(t.x - r, t.x + r, cy - r * .9, cy + r * .9, t.z - r, t.z + r));
    list.push(boxPts(t.x - .2, t.x + .2, GROUND, t.h, t.z - .2, t.z + .2));
  }
  return list;
}

/** Тень решётки ограды — тонкие линии от каждого прута. */
export function fenceShadow(v, g, L) {
  const dMax = Math.sqrt(v.f * .14 * 4.2 / 3) * .8;
  g.beginPath();
  for (let z = 3; z > -dMax; z -= .14) {
    const a = [FENCE, PLATFORM_TOP, z], b = toFloor([FENCE, PLATFORM_TOP + 1.12, z], L, PLATFORM_TOP);
    if (b[0] > EDGE) continue;
    v.seg(g, a, b);
  }
  g.lineWidth = 1.1;
  g.stroke();
}

/* ---------- ночные огни ---------- */

function glowFill(g, r, stops) {
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  return grad;
}

/**
 * Мягкое световое пятно на плоскости: эллипс с центром p и полуосями-векторами a и b (метры),
 * в перспективе. Края всегда растворяются в ноль — никаких резких кромок.
 */
export function planeGlow(v, ctx, p, a, b, stops, alpha) {
  // пятно частично за спиной (фонарь позади зрителя): оставляем видимую часть — от дальнего края до камеры
  const front = v.pos[2] - 2.5, along = Math.abs(a[2]) > Math.abs(b[2]) ? "a" : "b";
  const axis = along === "a" ? a : b, len = Math.abs(axis[2]);
  if (len > 0 && p[2] + len > front) {
    const far = p[2] - len;
    if (far >= front) return;
    const half = (front - far) / 2;
    p = [p[0], p[1], far + half];
    const scaled = axis.map(c => c * half / len);
    if (along === "a") a = scaled; else b = scaled;
  }
  const c = v.screen(p);
  const pa = v.screen([p[0] + a[0], p[1] + a[1], p[2] + a[2]]), na = v.screen([p[0] - a[0], p[1] - a[1], p[2] - a[2]]);
  const pb = v.screen([p[0] + b[0], p[1] + b[1], p[2] + b[2]]), nb = v.screen([p[0] - b[0], p[1] - b[1], p[2] - b[2]]);
  if (!c || !pa || !na || !pb || !nb) return;
  // полуоси на экране — по середине между «ближней» и «дальней» точкой, так перспектива не ломает эллипс
  const ax = [(pa[0] - na[0]) / 2, (pa[1] - na[1]) / 2], bx = [(pb[0] - nb[0]) / 2, (pb[1] - nb[1]) / 2];
  const cx = [(pa[0] + na[0] + pb[0] + nb[0]) / 4, (pa[1] + na[1] + pb[1] + nb[1]) / 4];
  if (Math.hypot(...ax) < .5 || Math.hypot(...bx) < .3) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(ax[0], ax[1], bx[0], bx[1], cx[0], cx[1]);
  ctx.fillStyle = glowFill(ctx, 1, stops);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Световое пятно на полу радиусом R (вдоль пути — Rz). */
export function floorGlow(v, ctx, p, R, stops, alpha, Rz = R) {
  planeGlow(v, ctx, p, [R, 0, 0], [0, 0, Rz], stops, alpha);
}

export function pointGlow(v, ctx, p, R, stops, alpha) {
  const c = v.screen(p);
  if (!c) return;
  const r = R * v.f / v.dist(p);
  if (r < .5) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c[0], c[1]);
  ctx.fillStyle = glowFill(ctx, r, stops);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const LAMP_GLOW = [[0, "rgba(255,246,220,1)"], [.18, "rgba(255,229,168,.75)"], [.5, "rgba(255,210,127,.2)"], [1, "rgba(255,207,122,0)"]];
export const POOL = [[0, "rgba(255,226,166,.85)"], [.55, "rgba(255,213,144,.3)"], [1, "rgba(255,210,138,0)"]];

export function drawLampGlows(v, ctx) {
  const k = v.light.lamps;
  if (k < .01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const z of LAMPS) floorGlow(v, ctx, [-2.6, PLATFORM_TOP, z], 3.8, POOL, k * .8);
  const B = BOARD;
  floorGlow(v, ctx, [(B.x0 + B.x1) / 2, PLATFORM_TOP, B.z + 1.4], 2.4, POOL, k * .35);
  ctx.restore();
}

export function drawLampHeads(v, ctx) {
  const k = v.light.lamps;
  if (k < .01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const z of LAMPS) pointGlow(v, ctx, [-2.67, PLATFORM_TOP + 4.98, z], 1.7, LAMP_GLOW, k);
  ctx.restore();
}
