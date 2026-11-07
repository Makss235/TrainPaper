// Вид «Платформа»: стоим на платформе и смотрим вдоль пути. Справа — хвостовой вагон
// поезда (дальний торец — конец поезда), дальше пустой путь уходит к горизонту.
// Слева над платформой — светодиодное табло. Перспективу считаем сами и рисуем в SVG,
// поэтому картинка чёткая при любом размере экрана.
import { localTime, startApp } from "../lib/app.js";
import { bellowsShapes, CAR_L, coachShapes, H_M, PITCH } from "../lib/coach.js";
import { clamp } from "../lib/color.js";
import { pathD, roundRect } from "../lib/geom.js";
import { Motion, swapper } from "../lib/motion.js";
import { city, expand } from "../lib/names.js";
import { applyPalette, injectMaterialStyles } from "../lib/palette.js";
import { drawPlate, PLATE_H, PLATE_W } from "../lib/plate.js";
import { noAnimation } from "../lib/settings.js";
import { initStars, renderSky } from "../lib/skyview.js";
import { countdown, delayInfo, eventWord, headline, numberText, stopMinutes } from "../lib/trains.js";

const NS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);
const poster = $("poster");

// мир в метрах: глаза в (0,0,0), x — вправо, y — вниз, z — к нам (вперёд — минус)
const NEAR = .3;
const FLOOR = 1.65;                  // пол платформы на 1,65 м ниже глаз
const RAIL = 2.75;                   // головка рельса (высокая платформа 1,1 м)
const EDGE = 2.5;                    // край платформы
const SIDE = 2.72;                   // борт вагона
const FENCE = -4.2;
const BODY_Y = RAIL - 1.3;           // низ кузова
const D_END = 7.2;                   // торец хвостового вагона
const TRACK = 4.42, TRACK2 = 9.7;
const BOARD_WIDE = { z: -6.3, x0: -3.2, x1: -.4, y0: -1.62, y1: -.64, depth: .22 };
const BOARD_TALL = { ...BOARD_WIDE, x0: -2.95, x1: -.25 };
let BOARD = BOARD_WIDE;
const CARS = 7;

injectMaterialStyles();
initStars();

function el(tag, attrs = {}, parent, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  parent?.append(node);
  return node;
}

/* ---------- камера и проекция ---------- */

let C;
function camera() {
  const W = innerWidth, H = innerHeight, portrait = H > W;
  const f = portrait ? W * .95 : Math.max(W * .6, H * 1.02);
  return { W, H, f, portrait, cx: W * (portrait ? .44 : .41), cy: H * (portrait ? .5 : .44) };
}
const P = ([x, y, z]) => [C.cx + C.f * x / -z, C.cy + C.f * y / -z];
const scaleAt = d => C.f / d;                       // px на метр на расстоянии d

/** Отсечение многоугольника ближней плоскостью: всё, что за спиной, не рисуем. */
function clip(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ina = a[2] <= -NEAR, inb = b[2] <= -NEAR;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (-NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -NEAR]);
    }
  }
  return out;
}
const poly = pts => { const c = clip(pts); return c.length > 2 ? pathD(c.map(P)) : ""; };
function seg(a, b) {
  if (a[2] > -NEAR && b[2] > -NEAR) return "";
  if (a[2] > -NEAR || b[2] > -NEAR) {
    const [p, q] = a[2] > -NEAR ? [b, a] : [a, b];
    const t = (-NEAR - p[2]) / (q[2] - p[2]);
    b = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, -NEAR];
    a = p;
  }
  const [x0, y0] = P(a), [x1, y1] = P(b);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
const quad = (x0, y0, z0, x1, y1, z1, axis) =>        // прямоугольник в плоскости
  axis === "y" ? [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] :
  axis === "x" ? [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] :
  [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
const FAR = -1400;

function radial(defs, id, stops, attrs = {}) {
  const g = el("radialGradient", { id, ...attrs }, defs);
  for (const [o, c, a] of stops) el("stop", { offset: o, "stop-color": c, "stop-opacity": a }, g);
}
function linear(defs, id, stops, attrs = { x1: 0, y1: 0, x2: 0, y2: 1 }) {
  const g = el("linearGradient", { id, ...attrs }, defs);
  for (const [o, style] of stops) el("stop", { offset: o, style }, g);
}

/* ---------- дальний план: земля, деревья, пути, контактная сеть, мост ---------- */

function drawFar() {
  const svg = $("far");
  svg.replaceChildren();
  const { W, H, cx, cy } = C;
  const defs = el("defs", {}, svg);
  radial(defs, "gTail", [[0, "#ff3a22", .9], [1, "#ff2a12", 0]]);

  el("rect", { x: -40, y: cy - 1, width: W + 80, height: H - cy + 41, class: "f-ground" }, el("g", { class: "hz3" }, svg));

  // город на горизонте
  let seed = 3;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const cityG = el("g", { class: "hz4" }, svg);
  for (let x = cx - W * .5; x < cx + W * .55;) {
    const w = 8 + rnd() * 34, h = H * (.006 + rnd() * .03) * (1 - Math.abs(x - cx) / W);
    el("rect", { x, y: cy - h, width: w, height: h + 1, class: rnd() < .5 ? "f-city" : "f-city2" }, cityG);
    x += w * (.8 + rnd() * .5);
  }

  // ряды деревьев вдоль путей: слева за оградой и справа за вторым путём
  const treeRow = (X, from, to, step, r, levelFor) => {
    const groups = {};
    for (let d = to; d >= from; d -= step * (.8 + rnd() * .4)) {
      const level = levelFor(d);
      const g = groups[level] ||= el("g", { class: `hz${level}` }, svg);
      const rr = r * (.7 + rnd() * .6), yTop = RAIL - 4 - rr * 1.4 - rnd() * 3;
      const [px, py] = P([X + (rnd() - .5) * 4, yTop, -d]);
      const k = scaleAt(d);
      el("ellipse", { cx: px, cy: py, rx: rr * k, ry: rr * k * 1.15, class: rnd() < .5 ? "f-trees" : "f-trees2" }, g);
      const [bx, by] = P([X, RAIL, -d]);
      el("rect", { x: px - k * .25, y: py, width: k * .5, height: Math.max(0, by - py), class: "f-trees" }, g);
    }
  };
  const levelFor = d => (d > 220 ? 4 : d > 90 ? 3 : d > 35 ? 2 : 1);
  treeRow(-15, 30, 700, 9, 3.4, levelFor);
  treeRow(18, 25, 700, 11, 4, levelFor);

  // пешеходный мост через пути вдали
  const bridge = el("g", { class: "hz3" }, svg), zb = -165;
  for (const X of [-9, 15]) el("path", { d: poly(quad(X - .8, RAIL - 7.6, zb, X + .8, RAIL + .5, zb)), class: "f-mast" }, bridge);
  el("path", { d: poly(quad(-40, RAIL - 7.9, zb, 40, RAIL - 7.2, zb)), class: "f-farroof" }, bridge);
  el("path", { d: poly(quad(-40, RAIL - 10.2, zb, 40, RAIL - 9.8, zb)), class: "f-farroof" }, bridge);
  let lattice = "";
  for (let X = -40; X < 40; X += 3) lattice += seg([X, RAIL - 7.9, zb], [X + 1.5, RAIL - 9.9, zb]) + seg([X + 1.5, RAIL - 9.9, zb], [X + 3, RAIL - 7.9, zb]);
  el("path", { d: lattice, class: "s-farroof", fill: "none", "stroke-width": Math.max(1, scaleAt(165) * .25) }, bridge);

  // второй путь и наш путь: балласт, шпалы, рельсы
  const track = (c, level) => {
    const g = el("g", { class: level ? `hz${level}` : null }, svg);
    el("path", { d: poly(quad(c - 2.3, RAIL + .2, -NEAR, c + 2.3, 0, FAR, "y")), class: "f-ballast" }, g);
    let sl = "";
    for (let d = 1; d < 900; d += .55) {
      if (scaleAt(d) * .55 < 2.2) break;
      sl += poly(quad(c - 1.35, RAIL + .12, -d, c + 1.35, 0, -d - .25, "y"));
    }
    el("path", { d: sl, class: "f-sleeper", opacity: .7 }, g);
    for (const r of [c - .76, c + .76]) {
      el("path", { d: poly(quad(r - .04, RAIL, -NEAR, r + .04, 0, FAR, "y")), class: "f-railhi" }, g);
      el("path", { d: poly(quad(r - .04, RAIL, -NEAR, r - .04, RAIL + .16, FAR, "x")), class: "f-rail" }, g);
    }
    return g;
  };
  track(TRACK2, 1);
  const own = track(TRACK, 0);
  tailGlow = el("path", { fill: "url(#gTail)", class: "glow" }, own);

  // опоры контактной сети между путями, консоли к проводам
  const masts = el("g", {}, svg);
  for (let d = 30; d < 900; d += 55) {
    const level = levelFor(d), g = el("g", { class: level ? `hz${level}` : null }, masts), k = scaleAt(d);
    el("path", { d: poly(quad(7.05, RAIL - 8.6, -d, 7.35, RAIL + .2, -d)), class: "f-mast" }, g);
    el("path", { d: seg([7.2, RAIL - 7.4, -d], [TRACK - .3, RAIL - 6.9, -d]) + seg([7.2, RAIL - 6.3, -d], [TRACK, RAIL - 6.0, -d]) +
      seg([7.2, RAIL - 7.4, -d], [TRACK2 + .3, RAIL - 6.9, -d]) + seg([7.2, RAIL - 6.3, -d], [TRACK2, RAIL - 6.0, -d]),
    class: "s-mast", fill: "none", "stroke-width": Math.max(1, k * .08) }, g);
  }
  // портал над путями
  const gantry = el("g", { class: "hz2" }, svg), zg = -62;
  for (const X of [-5.4, 13]) el("path", { d: poly(quad(X - .22, RAIL - 9.2, zg, X + .22, RAIL + .2, zg)), class: "f-mast" }, gantry);
  el("path", { d: poly(quad(-5.6, RAIL - 9.2, zg, 13.2, RAIL - 8.7, zg)), class: "f-mast" }, gantry);
  el("path", { d: poly(quad(-5.6, RAIL - 8.0, zg, 13.2, RAIL - 7.75, zg)), class: "f-mast" }, gantry);
  let zig = "";
  for (let X = -5.4; X < 13; X += 1.2) zig += seg([X, RAIL - 8.0, zg], [X + .6, RAIL - 8.8, zg]) + seg([X + .6, RAIL - 8.8, zg], [X + 1.2, RAIL - 8.0, zg]);
  el("path", { d: zig, class: "s-mast", fill: "none", "stroke-width": Math.max(1, scaleAt(62) * .06) }, gantry);

  // провода: несущий трос, контактный провод и струны
  const wires = el("g", {}, svg);
  for (const c of [TRACK, TRACK2]) {
    let d = seg([c, RAIL - 6, -NEAR], [c, RAIL - 6, FAR]) + seg([c, RAIL - 7.4, -NEAR], [c, RAIL - 7.4, FAR]);
    for (let z = 3; z < 400; z += 6.5) if (scaleAt(z) * 6.5 > 6) d += seg([c, RAIL - 7.4, -z], [c, RAIL - 6, -z]);
    el("path", { d, class: "s-wire", fill: "none", "stroke-width": 1.4 }, wires);
  }
}
let tailGlow = null;

/* ---------- ближний план: платформа, ограда, фонари, табло ---------- */

let spillGroup = null, lampPools = [];

function drawNear() {
  const svg = $("near");
  svg.replaceChildren();
  const defs = el("defs", {}, svg);
  radial(defs, "gPool", [[0, "#ffe0a0", .75], [.6, "#ffd590", .25], [1, "#ffd28a", 0]]);
  radial(defs, "gLamp", [[0, "#fff6dc", 1], [.15, "#ffe5a8", .8], [.5, "#ffd27f", .2], [1, "#ffcf7a", 0]]);
  linear(defs, "gSpill", [[0, "stop-color:#ffd58a;stop-opacity:.85"], [1, "stop-color:#ffd07a;stop-opacity:0"]], { x1: 1, y1: 0, x2: 0, y2: 0 });
  el("feGaussianBlur", { stdDeviation: 6 }, el("filter", { id: "fSoft", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs));

  // пол платформы, кромка, жёлтая линия, тактильная полоса
  el("path", { d: poly(quad(FENCE, FLOOR, -NEAR, EDGE, 0, FAR, "y")), class: "f-platform" }, svg);
  el("path", { d: poly(quad(1.85, FLOOR, -NEAR, 2.25, 0, FAR, "y")), class: "f-tactile" }, svg);
  el("path", { d: poly(quad(1.7, FLOOR, -NEAR, 1.85, 0, FAR, "y")), class: "f-yellow" }, svg);
  el("path", { d: poly(quad(2.25, FLOOR, -NEAR, EDGE, 0, FAR, "y")), class: "f-coping" }, svg);
  let tiles = "";
  for (let X = FENCE + .6; X < 1.7; X += .6) tiles += seg([X, FLOOR, -NEAR], [X, FLOOR, FAR]);
  for (let d = .6; d < 600; d += .6) {
    if (scaleAt(d) * .6 < 3) break;
    tiles += seg([FENCE, FLOOR, -d], [1.7, FLOOR, -d]);
  }
  el("path", { d: tiles, class: "s-tile", fill: "none", "stroke-width": 1.2 }, svg);
  let bumps = "";
  for (let d = .4; d < 400; d += .3) {
    if (scaleAt(d) * .3 < 3) break;
    bumps += seg([1.9, FLOOR, -d], [2.2, FLOOR, -d]);
  }
  el("path", { d: bumps, class: "s-tile", fill: "none", "stroke-width": 1 }, svg);

  spillGroup = el("g", { class: "glow", filter: "url(#fSoft)", style: "opacity:calc(var(--lamps) * .5)" }, svg);
  const pools = el("g", { class: "glow", style: "opacity:calc(var(--lamps) * .9)" }, svg);

  // ограда слева
  const fence = el("g", {}, svg);
  let bars = "", posts = "", rails = "";
  for (let d = 1; d < 700; d += .14) {
    if (scaleAt(d) * .14 < 2.6) {
      el("path", { d: poly(quad(FENCE, FLOOR - 1.15, -d, FENCE, FLOOR, FAR, "x")), class: "f-fence", opacity: .55 }, fence);
      break;
    }
    bars += seg([FENCE, FLOOR, -d], [FENCE, FLOOR - 1.1, -d]);
  }
  for (let d = 2.5; d < 400; d += 2.5) if (scaleAt(d) * 2.5 > 5) posts += seg([FENCE, FLOOR, -d], [FENCE, FLOOR - 1.2, -d]);
  for (const y of [FLOOR - 1.12, FLOOR - .12]) rails += seg([FENCE, y, -NEAR], [FENCE, y, FAR]);
  el("path", { d: bars, class: "s-fence", fill: "none", "stroke-width": 1.6 }, fence);
  el("path", { d: posts + rails, class: "s-fence", fill: "none", "stroke-width": 3.2 }, fence);

  // фонари вдоль ограды
  const lamps = el("g", {}, svg), glows = el("g", { class: "glow", style: "opacity:var(--lamps)" }, svg);
  lampPools = [];
  for (let d = 42; d < 330; d += 24) {
    const k = scaleAt(d), g = el("g", { class: d > 90 ? "hz2" : d > 35 ? "hz1" : null }, lamps);
    el("path", { d: poly(quad(-3.62, FLOOR - 5.2, -d, -3.5, FLOOR, -d)), class: "f-post" }, g);
    el("path", { d: seg([-3.56, FLOOR - 5.1, -d], [-2.7, FLOOR - 5.25, -d]), class: "s-post", fill: "none", "stroke-width": Math.max(1, k * .07) }, g);
    el("path", { d: poly(quad(-3.0, FLOOR - 5.32, -d, -2.35, FLOOR - 5.18, -d)), class: "f-lamp" }, g);
    const [lx, ly] = P([-2.67, FLOOR - 5.15, -d]);
    el("circle", { cx: lx, cy: ly, r: k * 1.6, fill: "url(#gLamp)" }, glows);
    const pool = [];
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2;
      pool.push([-2.6 + Math.cos(a) * 3.6, FLOOR, -d + Math.sin(a) * 3.6]);
    }
    el("path", { d: poly(pool), fill: "url(#gPool)" }, pools);
  }

  // табло на раме: стойки, балка, корпус (видны торец справа и низ); ночью табло подсвечивает пол
  const B = BOARD, frame = el("g", {}, svg);
  const boardPool = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    boardPool.push([(B.x0 + B.x1) / 2 + Math.cos(a) * 2.6, FLOOR, B.z + 1.2 + Math.sin(a) * 2.2]);
  }
  el("path", { d: poly(boardPool), fill: "url(#gPool)", class: "glow", style: "opacity:calc(var(--lamps) * .35)" }, svg);
  for (const X of [B.x0 - .08, B.x1 - .06]) el("path", { d: poly(quad(X, -1.95, B.z - .1, X + .14, FLOOR, B.z - .1)), class: "f-post" }, frame);
  el("path", { d: poly(quad(B.x0 - .2, -2.02, B.z - .1, B.x1 + .2, -1.86, B.z - .1)), class: "f-post" }, frame);
  el("path", { d: poly(quad(B.x1 + .2, -2.02, B.z - .1, B.x1 + .2, -1.86, B.z - .32, "x")), class: "f-fence" }, frame);
  for (const X of [B.x0 + .3, B.x1 - .3]) el("path", { d: seg([X, -1.9, B.z - .1], [X, B.y0, B.z - .1]), class: "s-post", fill: "none", "stroke-width": 3 }, frame);
  el("path", { d: poly(quad(B.x1, B.y0, B.z, B.x1, B.y1, B.z - B.depth, "x")), class: "f-fence" }, frame);
  el("path", { d: poly(quad(B.x0, B.y1, B.z, B.x1, B.y1, B.z - B.depth, "y")), class: "f-post" }, frame);
  el("path", { d: poly(quad(B.x0 - .05, B.y0 - .05, B.z, B.x1 + .05, B.y1 + .05, B.z)), class: "f-fence" }, frame);
  placeBoard();
}

function placeBoard() {
  const B = BOARD;
  const [x0, y0] = P([B.x0 + .06, B.y0 + .06, B.z]), [x1] = P([B.x1 - .06, B.y0, B.z]);
  const k = (x1 - x0) / 1200;
  $("board").style.height = `${1200 * (B.y1 - B.y0 - .12) / (B.x1 - B.x0 - .12)}px`;
  $("board").style.transform = `translate(${x0}px,${y0}px) scale(${k})`;
}

/* ---------- поезд ---------- */

const carShapes = [];
for (let k = 0; k < CARS; k++) {
  const shapes = coachShapes({ rear: k === 0, index: k });
  if (k < CARS - 1) shapes.unshift(...bellowsShapes(CAR_L, PITCH).map(s => ({ ...s, recess: true })));
  carShapes.push(shapes);
}

let trainOffset = 0, trainPresent = false;

function drawTrainFrame() {
  const svg = $("train");
  if (!svg.firstChild) {
    const defs = el("defs", {}, svg);
    linear(defs, "gReflect", [[0, "stop-color:var(--reflect-top)"], [1, "stop-color:var(--reflect-bottom)"]]);
    linear(defs, "gInterior", [[0, "stop-color:var(--interior)"], [1, "stop-color:var(--interior-low)"]]);
    el("g", { id: "cars" }, svg);
  }
  const cars = $("cars");
  let html = "", spill = "";
  const plateBox = $("plateBox");
  plateBox.hidden = true;
  if (trainPresent) {
    for (let k = 0; k < CARS; k++) {
      const z = u => -D_END + trainOffset + (u + k * PITCH) * H_M;
      if (z(-.2) > -NEAR || z(CAR_L + .3) < FAR) continue;      // целиком за спиной или за горизонтом
      const to3 = (u, v, recess) => [recess ? SIDE + .28 : SIDE, BODY_Y - v * H_M, z(u)];
      for (const s of carShapes[k]) {
        if (s.kind === "window") {
          const outline = roundRect(s.u0, s.v0, s.u1, s.v1, s.r, 3).map(([u, v]) => to3(u, v));
          const o = poly(outline);
          if (!o) continue;
          const curtainTop = s.v0 + (s.v1 - s.v0) * (s.plate ? .78 : .48);
          html += `<path d="${o}" fill="url(#gInterior)"/>`;
          html += `<path d="${poly([to3(s.u0, s.v0), to3(s.u1, s.v0), to3(s.u1, curtainTop), to3(s.u0, curtainTop)])}" style="fill:var(--curtain)"/>`;
          html += `<path d="${o}" fill="url(#gReflect)" style="opacity:calc(var(--reflect) * ${s.plate ? .3 : .8})"/>`;
          html += `<path d="${o}" class="s-frame" fill="none" stroke-width="${Math.max(1.2, scaleAt(-z((s.u0 + s.u1) / 2)) * .045)}"/>`;
          html += `<path d="${seg(to3(s.u0, s.transom), to3(s.u1, s.transom))}" class="s-frame" fill="none" stroke-width="${Math.max(1, scaleAt(-z(s.u0)) * .03)}"/>`;
          if (s.plate) placePlate(s, to3);
          const zs = [z(s.u0), z(s.u1)];
          if (Math.max(...zs) < -NEAR) {
            const d = poly([[EDGE, FLOOR, zs[0]], [EDGE, FLOOR, zs[1]], [.9, FLOOR, zs[1] + .6], [.9, FLOOR, zs[0] - .6]]);
            if (d) spill += `<path d="${d}" fill="url(#gSpill)"/>`;
          }
        } else if (s.kind === "doorWindow") {
          const o = poly(s.pts.map(([u, v]) => to3(u, v)));
          if (o) html += `<path d="${o}" fill="url(#gInterior)"/><path d="${o}" fill="url(#gReflect)" style="opacity:calc(var(--reflect) * .85)"/>` +
            `<path d="${o}" class="s-frame" fill="none" stroke-width="2"/>`;
        } else if (s.kind === "tail") {
          const zt = z(0) - .4;
          if (zt < -NEAR) {
            tailGlow.setAttribute("d", poly([[TRACK - 1.6, RAIL + .1, zt], [TRACK + 1.6, RAIL + .1, zt], [TRACK + 2.2, RAIL + .1, zt - 9], [TRACK - 2.2, RAIL + .1, zt - 9]]));
            tailGlow.style.opacity = "calc(.15 + .85 * var(--lamps))";
          }
        } else if (s.pts) {
          const d = poly(s.pts.map(([u, v]) => to3(u, v, s.recess)));
          if (d) html += `<path d="${d}" class="${s.cls}${s.stroke ? ` ${s.stroke}` : ""}"${s.sw ? ` stroke-width="${Math.max(1, s.sw * scaleAt(D_END) * H_M)}"` : ""}/>`;
        } else if (s.line) {
          // линии рёбер и швов — тонкие полосы, чтобы толщина сходилась в перспективе
          const [[ua, va], [ub, vb]] = s.line, hw = s.w / 2, vertical = Math.abs(ua - ub) < 1e-6;
          const pts = vertical
            ? [to3(ua - hw, va, s.recess), to3(ua + hw, va, s.recess), to3(ub + hw, vb, s.recess), to3(ub - hw, vb, s.recess)]
            : [to3(ua, va - hw, s.recess), to3(ub, vb - hw, s.recess), to3(ub, vb + hw, s.recess), to3(ua, va + hw, s.recess)];
          const d = poly(pts);
          if (d) html += `<path d="${d}" class="f-${s.cls.slice(2).replace("-v", "")}"/>`;
        }
      }
    }
  }
  if (!trainPresent || -D_END + trainOffset > -NEAR) tailGlow?.setAttribute("d", "");
  cars.innerHTML = html;
  spillGroup.innerHTML = spill;
}

/** Табличка в окне: SVG-табличка натягивается на перспективный четырёхугольник через matrix3d. */
function placePlate(s, to3) {
  const box = $("plateBox");
  const u0 = s.u0 + (s.u1 - s.u0) * .06, u1 = s.u1 - (s.u1 - s.u0) * .06;
  const vTop = s.v0 + (s.v1 - s.v0) * .78, vBot = vTop - (u1 - u0) * PLATE_H / PLATE_W;
  const corners = [to3(u0, vTop), to3(u1, vTop), to3(u1, vBot), to3(u0, vBot)];
  if (corners.some(p => p[2] > -NEAR)) return;
  const [p0, p1, p2, p3] = corners.map(P);
  box.style.transform = homography(PLATE_W, PLATE_H, p0, p1, p2, p3);
  box.hidden = false;
}

function homography(w, h, [x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  // квадрат → четырёхугольник (Хекберт): (0,0)→p0, (1,0)→p1, (1,1)→p2, (0,1)→p3
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map(v => +v.toFixed(8)).join(",")})`;
}

/* ---------- табло ---------- */

const state = { info: null, shown: null, list: [] };

function fitRow(node, max) {
  node.style.fontSize = "";
  let size = parseFloat(getComputedStyle(node).fontSize);
  while (node.scrollWidth > max && size > 40) {
    size -= 4;
    node.style.fontSize = `${size}px`;
  }
}

function updateBoard(now) {
  const board = $("board"), item = state.shown, info = state.info;
  if (!info) return;
  const off = info.utcOffset;
  $("bClock").textContent = localTime(now, off);
  board.classList.toggle("empty", !item);
  if (!item) {
    $("bKind").textContent = "ТАБЛО";
    $("bKind").className = "";
    $("bNum").textContent = "";
    $("bRoute").textContent = "ПОЕЗДОВ НЕТ";
    $("bTime").textContent = $("bPlace").textContent = $("bDelay").textContent = "";
    setTicker(`${expand(info.rzdName || info.name)} · ДАННЫЕ ОНЛАЙН-ТАБЛО РЖД`);
    return;
  }
  const t = item.train, arrival = item.event === "arrival";
  $("bKind").textContent = `${headline(item)} · ${countdown(item, now)}`;
  $("bKind").className = arrival ? "arrival" : "";
  $("bNum").textContent = numberText(t);
  $("bRoute").textContent = `${city(t.from)} — ${city(t.to)}`.toUpperCase();
  const ev = arrival ? t.arrival : t.departure;
  $("bTime").textContent = `${arrival ? "ПРИБ." : "ОТПР."} ${localTime(ev.expected * 1000, off)}`;
  $("bPlace").textContent = [t.track ? `ПУТЬ ${t.track}` : null, t.platform ? `ПЛ. ${t.platform}` : null].filter(Boolean).join(" · ") || "ПУТЬ УТОЧНЯЕТСЯ";
  const delay = delayInfo(item);
  $("bDelay").textContent = delay.text.toUpperCase();
  $("bDelay").className = delay.level;
  const stop = t.kind === "transit" && !arrival ? stopMinutes(t) : null;
  const rest = state.list.filter(x => x.train.id !== t.id).slice(0, 5).map(x =>
    `${localTime(x.time, off)} ${x.train.number} ${x.event === "arrival" ? "ИЗ " + city(x.train.from) : city(x.train.to)}`.toUpperCase());
  setTicker([
    `${expand(t.from)} — ${expand(t.to)}`,
    stop ? `СТОЯНКА ${stop} МИН` : null,
    t.position && t.position !== info.rzdName ? `СЕЙЧАС: ${t.position}` : null,
    rest.length ? `ДАЛЕЕ: ${rest.join(" · ")}` : null,
  ].filter(Boolean).join("   ●   "));
  fitRow($("bRoute"), 1140 - $("bNum").offsetWidth - 28);
  fitRow($("bSub"), 1140);
}

let tickerText = "";
function setTicker(text) {
  if (text === tickerText) return;
  tickerText = text;
  const node = $("bTicker");
  // две копии подряд: строка бежит без пустого начала и бесшовно повторяется
  node.replaceChildren(...[0, 1].map(() => Object.assign(document.createElement("span"), { textContent: `${text}   ●   ` })));
  node.style.setProperty("--marquee", `${Math.max(16, text.length * .3)}s`);
}

function updatePlate() {
  drawPlate($("plateG"), state.shown?.train || null);
}

/* ---------- движение и параллакс ---------- */

const motion = new Motion((offset, present) => {
  trainOffset = offset;
  trainPresent = present;
  drawTrainFrame();
});

const showTrain = swapper({
  motion,
  instant: () => noAnimation || document.hidden,
  departDistance: () => D_END + 4,
  arriveDistance: () => 120,
  show(item) {
    state.shown = item;
    updatePlate();
    updateBoard(Date.now());
  },
});

// Смещение за курсором — как лёгкий поворот головы: вся сцена (путь, платформа, поезд, табло)
// сдвигается на одно и то же расстояние, поэтому слои не расходятся и пол не «уезжает» от пути.
// Небо — бесконечно далёкий фон — остаётся на месте.
const sceneLayers = [$("far"), $("train"), $("near"), $("html")];
let tx = 0, ty = 0, sx = 0, sy = 0;
addEventListener("pointermove", e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; });
(function frame() {
  if (C && (C.W !== innerWidth || C.H !== innerHeight)) build();     // размер окна поменялся — пересобираем сразу
  sx += (tx - sx) * .06;
  sy += (ty - sy) * .06;
  const shift = `translate3d(${(-sx * 18).toFixed(2)}px,${(-sy * 7).toFixed(2)}px,0)`;
  for (const node of sceneLayers) node.style.transform = shift;
  requestAnimationFrame(frame);
})();

/* ---------- сборка ---------- */

function build() {
  C = camera();
  BOARD = C.portrait ? BOARD_TALL : BOARD_WIDE;
  for (const id of ["far", "train", "near"]) $(id).setAttribute("viewBox", `-40 -40 ${C.W + 80} ${C.H + 80}`);
  $("train").replaceChildren();
  drawFar();
  drawNear();
  drawTrainFrame();
}

build();

startApp({
  name: "platform",
  env(env, sky) {
    applyPalette(poster, env);
    renderSky(env, sky, { horizon: C.cy, view: 250, fov: 120, span: 40 });
  },
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    if (changed || stationChanged || !state.shown) return showTrain(current);
    state.shown = current;
    updatePlate();
  },
  tick(now) {
    updateBoard(now);
  },
});
