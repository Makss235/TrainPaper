// Вид «Вагон»: смотрим с платформы на хвост поезда сбоку. Хвостовой вагон с красной дверью,
// в окне служебного купе — маршрутная табличка, слева — табличка станции и фонарь.
import { localTime, startApp } from "../lib/app.js";
import { bellowsShapes, CAR_L, coachShapes, PITCH } from "../lib/coach.js";
import { clamp } from "../lib/color.js";
import { pathD, roundRect } from "../lib/geom.js";
import { Motion, swapper } from "../lib/motion.js";
import { city, expand, title, translit } from "../lib/names.js";
import { applyPalette, injectMaterialStyles } from "../lib/palette.js";
import { drawPlate, PLATE_W } from "../lib/plate.js";
import { noAnimation } from "../lib/settings.js";
import { initStars, renderSky } from "../lib/skyview.js";
import { countdown, delayInfo, eventWord, headline, numberText, stopMinutes } from "../lib/trains.js";

const NS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);
const poster = $("poster");
const CARS = 4;

injectMaterialStyles();
initStars();

function el(tag, attrs = {}, parent, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  parent?.append(node);
  return node;
}

function fitText(node, max) {
  node.removeAttribute("textLength");
  if (node.getComputedTextLength() > max) {
    node.setAttribute("textLength", max);
    node.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
}

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- раскладка ---------- */

let L;
function layout() {
  const W = innerWidth, H = innerHeight;
  const portrait = H > W * 1.05;
  const S = clamp(Math.min(H * .54, W * (portrait ? .62 : .5)), 140, 900);  // px на высоту боковины
  const horizon = H * (portrait ? .52 : .43);
  const F = S / 2.2 * 2.7;                     // фокус: боковина вагона в 2,7 м от глаз
  return {
    W, H, S, F, horizon, portrait,
    yb: horizon + S / 2.2 * (2.75 - 1.3),      // низ кузова: 1,3 м над рельсом, глаза — 2,75 м
    xe: W * (portrait ? .1 : .44),             // торец хвостового вагона
  };
}
const Yd = (d, z) => L.horizon + L.F * (2.75 - z) / d;       // точка на глубине d м, высоте z м над рельсом
const pxm = d => L.F / d;                                    // px на метр по горизонтали на глубине d

/* ---------- дальний план: пути, контактная сеть, дальняя платформа, горизонт ---------- */

function drawFar() {
  const svg = $("far");
  svg.replaceChildren();
  const { W, H } = L, x0 = -40, x1 = W + 40;
  const band = (y0, y1, cls, parent) => el("rect", { x: x0, y: Math.min(y0, y1), width: x1 - x0, height: Math.abs(y1 - y0), class: cls }, parent);
  const random = rng(11);

  // земля и балласт до самого низа (ближние части закроет платформа)
  band(L.horizon - 1, H + 40, "f-ballast", el("g", { class: "hz3" }, svg));

  // город и деревья на горизонте
  const city = el("g", { class: "hz4" }, svg);
  for (let x = x0; x < x1;) {
    const w = 30 + random() * 110, h = L.H * (.018 + random() * .07);
    el("rect", { x, y: L.horizon - h, width: w, height: h + 2, class: random() < .5 ? "f-city" : "f-city2" }, city);
    if (random() < .18) el("rect", { x: x + w * .4, y: L.horizon - h - L.H * .03, width: w * .18, height: L.H * .03 + 2, class: "f-city" }, city);
    x += w * (.7 + random() * .6);
  }
  const trees = el("g", { class: "hz3" }, svg);
  let d = `M${x0} ${L.horizon + 2}`;
  for (let x = x0; x <= x1; x += 14 + random() * 22) {
    d += `Q${x + 6} ${L.horizon - L.H * (.012 + random() * .05)} ${x + 16} ${L.horizon - L.H * (.006 + random() * .02)}`;
  }
  el("path", { d: d + `L${x1} ${L.horizon + 2}Z`, class: "f-trees" }, trees);

  // дальняя платформа (16–22 м) с фонарями
  const plat = el("g", { class: "hz3" }, svg);
  band(Yd(22, 1.1), Yd(16, 1.1), "f-farplat", plat);
  band(Yd(16, 1.1), Yd(16, 0), "f-tile", plat);
  band(Yd(22, 1.1) - pxm(22) * 1.2, Yd(22, 1.1), "f-fence", el("g", { opacity: .45 }, plat));
  let bush = `M${x0} ${Yd(22, 1.1) + 1}`;
  for (let x = x0; x <= x1; x += 10 + random() * 26) {
    bush += `Q${x + 8} ${Yd(22, 1.1) - pxm(22) * (1.2 + random() * 2.4)} ${x + 20} ${Yd(22, 1.1) - pxm(22) * (.6 + random() * .9)}`;
  }
  el("path", { d: bush + `L${x1} ${Yd(22, 1.1) + 1}Z`, class: "f-trees2" }, plat);
  const lampStep = 25 * pxm(19);
  for (let x = W * .07; x < x1; x += lampStep) {
    el("rect", { x: x - 1.5, y: Yd(19, 6.3), width: 3, height: Yd(19, 1.1) - Yd(19, 6.3), class: "f-lamp" }, plat);
    el("rect", { x: x - pxm(19) * .45, y: Yd(19, 6.35), width: pxm(19) * .9, height: Math.max(2, pxm(19) * .14), rx: 1, class: "f-lamp" }, plat);
    farLamps.push([x, Yd(19, 6.2), pxm(19)]);
  }

  // пути: центр 3-го в 14,1 м, 2-го в 9,7 м, наш — в 4,4 м (почти весь скрыт платформой)
  const track = (c, level, sleepersOn = true) => {
    const g = el("g", { class: level ? `hz${level}` : null }, svg);
    const step = .55 * pxm(c), sw = Math.max(2, .24 * pxm(c));
    let sleepers = "";
    for (let x = x0 + (c * 37 % step); x < x1; x += step) {
      sleepers += `M${x.toFixed(1)} ${Yd(c - 1.35, -.15).toFixed(1)}h${sw.toFixed(1)}V${Yd(c + 1.35, -.15).toFixed(1)}h${(-sw).toFixed(1)}Z`;
    }
    if (sleepersOn) el("path", { d: sleepers, class: "f-sleeper", opacity: .55 }, g);
    for (const r of [c + .76, c - .76]) {
      band(Yd(r, 0), Yd(r, -.16), "f-rail", g);
      band(Yd(r, 0), Yd(r, 0) + Math.max(1, pxm(r) * .03), "f-railhi", g);
    }
  };
  track(14.1, 2);

  // опора контактной сети между 2-м и 3-м путём
  const mast = el("g", { class: "hz2" }, svg), mw = .32 * pxm(12);
  for (let x = W * .16; x < x1; x += 55 * pxm(12)) {
    el("rect", { x: x - mw / 2, y: Yd(12, 8.8), width: mw, height: Yd(12, -.3) - Yd(12, 8.8), class: "f-mast" }, mast);
    el("rect", { x: x - mw * 1.6, y: Yd(12, 7.6), width: mw * 3.2, height: mw * .5, class: "f-mast" }, mast);
    el("rect", { x: x - mw * 1.3, y: Yd(12, 6.6), width: mw * 2.6, height: mw * .4, class: "f-mast" }, mast);
  }
  // провода над 3-м и 2-м путём: несущий трос, контактный провод, струны
  const wires = (c, level) => {
    const g = el("g", { class: `hz${level}`, opacity: .7 }, svg);
    const yC = Yd(c, 6), yM = Yd(c, 7.4), lw = Math.max(1, pxm(c) * .022);
    band(yC, yC + lw, "f-wire", g);
    band(yM, yM + lw, "f-wire", g);
    let drop = "";
    for (let x = x0 + 8; x < x1; x += 6.5 * pxm(c)) drop += `M${x.toFixed(1)} ${yM}V${yC}`;
    el("path", { d: drop, class: "s-wire", "stroke-width": Math.max(.8, lw * .6) }, g);
  };
  wires(14.1, 2);
  track(9.72, 1);
  wires(9.72, 1);
  track(4.42, 0, false);

  // ночные огни дальних фонарей
  const glows = el("g", { class: "glow" }, svg);
  for (const [x, y, k] of farLamps) {
    el("circle", { cx: x, cy: y + k * .2, r: k * 1.3, fill: "url(#gLampFar)", style: "opacity:calc(var(--lamps) * .8)" }, glows);
  }
  const defs = el("defs", {}, svg);
  radial(defs, "gLampFar", [[0, "#fff1c9", 1], [.25, "#ffd98e", .5], [1, "#ffcf7a", 0]]);
}
let farLamps = [];

function radial(defs, id, stops) {
  const g = el("radialGradient", { id }, defs);
  for (const [o, c, a] of stops) el("stop", { offset: o, "stop-color": c, "stop-opacity": a }, g);
  return g;
}
function linear(defs, id, stops, attrs = { x1: 0, y1: 0, x2: 0, y2: 1 }) {
  const g = el("linearGradient", { id, ...attrs }, defs);
  for (const [o, style] of stops) el("stop", { offset: o, style }, g);
  return g;
}

/* ---------- поезд ---------- */

let plateGroups = [], trainGroup, spillGroup;

function drawTrain() {
  const svg = $("train");
  svg.replaceChildren();
  plateGroups = [];
  const defs = el("defs", {}, svg);
  linear(defs, "gInterior", [[0, "stop-color:var(--interior)"], [1, "stop-color:var(--interior-low)"]]);
  linear(defs, "gReflect", [[0, "stop-color:var(--reflect-top)"], [1, "stop-color:var(--reflect-bottom)"]]);
  radial(defs, "gTail", [[0, "#ff5a3c", 1], [.3, "#ff2a1a", .55], [1, "#ff1a10", 0]]);
  radial(defs, "gWarm", [[0, "#ffd88c", .55], [1, "#ffcf7a", 0]]);

  trainGroup = el("g", { id: "trainGroup" }, svg);
  const { S, xe, yb } = L;
  let winId = 0;
  for (let k = 0; k < CARS; k++) {
    const base = k * PITCH;
    const X = u => xe + (u + base) * S, Y = v => yb - v * S;
    const map = pts => pts.map(([u, v]) => [X(u), Y(v)]);
    const car = el("g", {}, trainGroup);
    const shapes = coachShapes({ rear: k === 0, index: k });
    if (k < CARS - 1) shapes.push(...bellowsShapes(CAR_L, PITCH));
    for (const s of shapes) {
      if (s.pts && !s.kind) {
        el("path", { d: pathD(map(s.pts)), class: s.stroke ? `${s.cls} ${s.stroke}` : s.cls, "stroke-width": s.sw ? s.sw * S : null }, car);
      } else if (s.line) {
        el("path", { d: pathD(map(s.line), false), class: s.cls, fill: "none", "stroke-width": Math.max(.8, s.w * S) }, car);
      } else if (s.kind === "window") {
        drawWindow(car, s, X, Y, S, winId++);
      } else if (s.kind === "doorWindow") {
        const d = pathD(map(s.pts));
        el("path", { d, fill: "url(#gInterior)" }, car);
        el("path", { d, fill: "url(#gReflect)", style: "opacity:calc(var(--reflect) * .9)" }, car);
        el("path", { d, class: "s-frame", fill: "none", "stroke-width": .02 * S }, car);
      } else if (s.kind === "text") {
        el("text", { x: X(s.u), y: Y(s.v), class: "car-text", "font-size": s.size * S }, car, s.text);
      } else if (s.kind === "tail") {
        el("circle", { cx: X(s.u), cy: Y(s.v), r: .3 * S, fill: "url(#gTail)", class: "glow",
          style: "opacity:calc(.1 + .9 * var(--lamps))" }, car);
      }
    }
  }
  // свет из окон на платформу — живёт в ближнем слое, двигается вместе с поездом
  spillGroup = el("g", { id: "spill", class: "glow", filter: "url(#fSpill)", style: "opacity:calc(var(--lamps) * .42)" });
  const yE = Yd(2.5, 1.1);
  for (let k = 0; k < CARS; k++) {
    for (const s of coachShapes({ index: k })) {
      if (s.kind !== "window") continue;
      const xa = xe + (s.u0 + k * PITCH) * S, xb = xe + (s.u1 + k * PITCH) * S, w = xb - xa;
      el("path", { d: `M${xa} ${yE}L${xb} ${yE}L${xb + w * .5} ${L.H + 40}L${xa - w * .5} ${L.H + 40}Z`, fill: "url(#gSpill)" }, spillGroup);
    }
  }
  spillSlot.replaceChildren(spillGroup);
}

function drawWindow(parent, w, X, Y, S, id) {
  const x0 = X(w.u0), x1 = X(w.u1), yT = Y(w.v1), yB = Y(w.v0), ww = x1 - x0, hh = yB - yT;
  const outline = pathD(roundRect(x0, yT, x1, yB, w.r * S, 5));
  const clipId = `wc${id}`;
  el("path", { d: outline }, el("clipPath", { id: clipId }, parent));
  const g = el("g", { "clip-path": `url(#${clipId})` }, parent);
  el("rect", { x: x0, y: yT, width: ww, height: hh, fill: "url(#gInterior)" }, g);
  el("rect", { x: x0, y: yT + hh * .14, width: ww, height: hh * .035, fill: "rgba(40,30,20,.35)" }, g);   // полка
  const rodY = yT + hh * (w.plate ? .19 : .5);
  // занавески собраны внизу, сверху — штанга
  let curtain = `M${x0} ${yB}V${rodY}`;
  const folds = 7;
  for (let i = 0; i < folds; i++) {
    const xa = x0 + ww * i / folds, xb = x0 + ww * (i + 1) / folds;
    curtain += `Q${(xa + xb) / 2} ${rodY + hh * .06} ${xb} ${rodY}`;
  }
  el("path", { d: curtain + `V${yB}Z`, style: "fill:var(--curtain)" }, g);
  let pleats = "";
  for (let i = 1; i < folds; i++) pleats += `M${x0 + ww * i / folds} ${rodY + hh * .02}V${yB}`;
  el("path", { d: pleats, stroke: "rgba(0,0,0,.22)", "stroke-width": Math.max(1, ww * .012) }, g);
  el("path", { d: `M${x0} ${rodY}H${x1}`, style: "stroke:var(--rod)", "stroke-width": Math.max(1, S * .009) }, g);
  if (w.plate) {
    const pw = Math.min(ww * .88, (yB - rodY - S * .012) * 2.5), k = pw / PLATE_W;
    const plate = el("g", { transform: `translate(${x0 + (ww - pw) / 2} ${rodY + S * .005}) scale(${k})`, class: "plate" }, g);
    plateGroups.push(plate);
  }
  el("rect", { x: x0, y: yT, width: ww, height: hh, fill: "url(#gReflect)",
    style: `opacity:calc(var(--reflect) * ${w.plate ? .3 : .85})` }, g);
  el("path", {
    d: `M${x0 + ww * .12} ${yB}L${x0 + ww * .3} ${yB}L${x0 + ww * .72} ${yT}L${x0 + ww * .54} ${yT}Z` +
       `M${x0 + ww * .38} ${yB}L${x0 + ww * .45} ${yB}L${x0 + ww * .87} ${yT}L${x0 + ww * .8} ${yT}Z`,
    fill: "#ffffff", style: `opacity:calc(var(--reflect) * ${w.plate ? .14 : .32})`,
  }, g);
  el("path", { d: outline, class: "s-frame", fill: "none", "stroke-width": .022 * S }, parent);
  const yt = Y(w.transom);
  el("path", { d: `M${x0} ${yt}H${x1}`, class: "s-frame", "stroke-width": .014 * S }, parent);
}

/* ---------- ближний план: платформа, фонарь, табличка станции ---------- */

let signParts = null, spillSlot = null;

function drawNear() {
  const svg = $("near");
  svg.replaceChildren();
  const { W, H, S } = L, x0 = -40, x1 = W + 40;
  const defs = el("defs", {}, svg);
  linear(defs, "gSpill", [[0, "stop-color:#ffd58a;stop-opacity:.9"], [1, "stop-color:#ffcf7a;stop-opacity:0"]]);
  el("feGaussianBlur", { stdDeviation: S * .035 }, el("filter", { id: "fSpill", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs));
  radial(defs, "gLamp", [[0, "#fff4d6", 1], [.18, "#ffe3a3", .75], [.5, "#ffd27f", .22], [1, "#ffcf7a", 0]]);
  radial(defs, "gPool", [[0, "#ffe2a6", .7], [1, "#ffd28a", 0]]);
  const band = (y0, y1, cls) => el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: cls }, svg);

  const yE = Yd(2.5, 1.1);
  band(yE, H + 40, "f-platform");
  band(yE, Yd(2.32, 1.1), "f-coping");
  band(yE - 1, yE + Math.max(1.5, S * .006), "f-gap");
  band(Yd(2.2, 1.1), Yd(2.11, 1.1), "f-yellow");
  band(Yd(2.11, 1.1), Yd(1.96, 1.1), "f-tactile");
  // плитка: продольные швы — линии, поперечные — короткие отрезки с перспективой
  let joints = "";
  for (let d = 1.96, row = 0; d > .9; d -= .3, row++) {
    const ya = Yd(d, 1.1), yb2 = Yd(d - .3, 1.1);
    if (ya > H + 40) break;
    joints += `M${x0} ${ya.toFixed(1)}H${x1}`;
    const step = .3 * pxm(d - .15);
    for (let x = x0 + (row % 2) * step / 2; x < x1; x += step) joints += `M${x.toFixed(1)} ${ya.toFixed(1)}V${Math.min(yb2, H + 40).toFixed(1)}`;
  }
  el("path", { d: joints, class: "s-tile", "stroke-width": Math.max(1, S * .003) }, svg);
  let dots = "";
  for (let x = x0; x < x1; x += S * .045) dots += `M${x.toFixed(1)} ${((Yd(2.11, 1.1) + Yd(1.96, 1.1)) / 2).toFixed(1)}h${(S * .02).toFixed(1)}`;
  el("path", { d: dots, class: "s-tile", "stroke-width": Math.max(1, (Yd(1.96, 1.1) - Yd(2.11, 1.1)) * .45) }, svg);
  spillSlot = el("g", {}, svg);

  // фонарь между табличкой и хвостом поезда (в портретной раскладке ему нет места)
  const lx = L.xe - S * .17, top = L.H * .085, pw = Math.max(4, S * .026);
  const lamp = el("g", { display: L.portrait ? "none" : null }, svg);
  el("rect", { x: lx - pw / 2, y: top, width: pw, height: H + 40 - top, class: "f-post" }, lamp);
  el("rect", { x: lx - pw * .9, y: H - S * .25, width: pw * 1.8, height: S * .25 + 40, class: "f-post" }, lamp);
  el("path", { d: `M${lx} ${top + S * .02}q${S * .02} ${-S * .07} ${S * .1} ${-S * .07}`, class: "s-post", fill: "none", "stroke-width": pw * .55 }, lamp);
  el("rect", { x: lx + S * .05, y: top - S * .075, width: S * .16, height: S * .045, rx: S * .012, class: "f-lamp" }, lamp);
  const glow = el("g", { class: "glow", style: "opacity:var(--lamps)", display: L.portrait ? "none" : null }, svg);
  el("ellipse", { cx: lx + S * .13, cy: Yd(2.15, 1.1), rx: S * .9, ry: (H - Yd(2.4, 1.1)) * .9, fill: "url(#gPool)" }, glow);
  el("circle", { cx: lx + S * .13, cy: top - S * .03, r: S * .5, fill: "url(#gLamp)" }, glow);

  // табличка станции на двух стойках
  const sw = clamp(W * (L.portrait ? .86 : .33), 240, 780), sh = sw * .3;
  const sx = L.portrait ? W * .07 : W * .05, sy = L.portrait ? H * .17 : L.horizon + sh * .1;
  const sign = el("g", {}, svg);
  // на стойках с платформы, а в портретной раскладке — подвешена сверху
  for (const px of [sx + sw * .1, sx + sw * .86]) {
    el("rect", L.portrait ? { x: px, y: -40, width: sw * .02, height: sy + 40 + sh * .2, class: "f-post" }
      : { x: px, y: sy + sh * .5, width: sw * .028, height: H + 40 - sy, class: "f-post" }, sign);
  }
  el("rect", { x: sx, y: sy, width: sw, height: sh, rx: sh * .03, class: "f-sign" }, sign);
  el("rect", { x: sx + sw * .035, y: sy + sh * .8, width: sw * .93, height: sh * .035, class: "f-red" }, sign);
  signParts = {
    w: sw, h: sh,
    name: el("text", { x: sx + sw * .05, y: sy + sh * .42, class: "sign-name", "font-size": sh * .3 }, sign),
    lat: el("text", { x: sx + sw * .05, y: sy + sh * .68, class: "sign-lat", "font-size": sh * .17 }, sign),
    num: el("text", { x: sx + sw * .865, y: sy + sh * .6, class: "sign-num", "font-size": sh * .5, "text-anchor": "middle" }, sign),
    small: el("text", { x: sx + sw * .865, y: sy + sh * .73, class: "sign-small", "font-size": sh * .075, "text-anchor": "middle" }, sign, "Платформа | Platform"),
  };
  const lit = el("g", { class: "glow", style: "opacity:calc(var(--lamps) * .5)" }, svg);
  el("ellipse", { cx: sx + sw * .8, cy: sy + sh * .4, rx: sw * .5, ry: sh * 1.1, fill: "url(#gPool)" }, lit);
}

function updateSign() {
  if (!signParts) return;
  const name = state.info?.name || title(state.info?.rzdName || "");
  signParts.name.textContent = name;
  signParts.lat.textContent = translit(name);
  signParts.num.textContent = state.shown?.train.platform || "–";
  const refit = () => {
    fitText(signParts.name, signParts.w * .66);
    fitText(signParts.lat, signParts.w * .66);
  };
  refit();
  document.fonts?.ready.then(refit);
}

/* ---------- данные ---------- */

const state = { info: null, shown: null, list: [], board: null };

function updatePlate() {
  for (const g of plateGroups) drawPlate(g, state.shown?.train || null);
}

function formatPlace(train) {
  const parts = [train.platform ? `платф. ${train.platform}` : null, train.track ? `путь ${train.track}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "уточняется";
}

function updateInfo(now) {
  const info = $("info"), item = state.shown;
  info.classList.toggle("empty", !item);
  if (!item) return;
  const t = item.train, off = state.info.utcOffset;
  const arrival = item.event === "arrival";
  $("headline").textContent = headline(item);
  $("headline").classList.toggle("arrival", arrival);
  $("countdown").textContent = countdown(item, now);
  $("number").textContent = `№ ${numberText(t)}`;
  $("from").textContent = city(t.from);
  $("to").textContent = city(t.to);
  const ev = arrival ? t.arrival : t.departure;
  const plan = localTime(ev.plan * 1000, off), expected = localTime(ev.expected * 1000, off);
  $("kTime").textContent = eventWord(item);
  $("vTime").textContent = plan === expected ? plan : `${expected} (по расписанию ${plan})`;
  $("vPlace").textContent = formatPlace(t);
  const delay = delayInfo(item);
  const stop = t.kind === "transit" ? stopMinutes(t) : null;
  $("vDelay").textContent = delay.text + (stop != null && item.event === "departure" ? `, стоянка ${stop} мин` : "");
  $("vDelay").className = `v ${delay.level}`;
  const pos = t.position && t.position !== state.info.rzdName ? title(t.position) : null;
  $("kPos").textContent = t.status === "UNDEF" ? "Состав" : "Сейчас";
  $("vPos").textContent = pos ? `${pos}${t.positionTime ? `, ${localTime(t.positionTime * 1000, off)}` : ""}` :
    t.status === "UNDEF" ? "ещё не в пути" : "у платформы";
  const rest = state.list.filter(x => x.train.id !== t.id).slice(0, 2);
  $("next").replaceChildren(...(rest.length ? [Object.assign(document.createElement("div"), { className: "title", textContent: "Дальше" })] : []),
    ...rest.map(x => {
      const row = document.createElement("div");
      row.className = "row";
      const other = x.event === "arrival" ? `из ${city(x.train.from)}` : `в ${city(x.train.to)}`;
      row.innerHTML = `<span class="t"></span><span class="n"></span><span class="d"></span>`;
      row.children[0].textContent = localTime(x.time, off);
      row.children[1].textContent = x.train.number;
      row.children[2].textContent = other;
      return row;
    }));
}

/* ---------- движение и параллакс ---------- */

const motion = new Motion((offset, present) => {
  const dx = offset * L.S / 2.2;
  trainGroup?.setAttribute("transform", `translate(${dx.toFixed(1)} 0)`);
  spillGroup?.setAttribute("transform", `translate(${dx.toFixed(1)} 0)`);
  $("train").style.visibility = present ? "visible" : "hidden";
  if (spillGroup) spillGroup.style.visibility = present ? "visible" : "hidden";
});

const showTrain = swapper({
  motion,
  instant: () => noAnimation || document.hidden,
  departDistance: () => (L.W - L.xe + 60) / (L.S / 2.2),
  arriveDistance: () => (L.xe + 1.6 * PITCH * L.S) / (L.S / 2.2),
  show(item) {
    state.shown = item;
    $("info").classList.add("swap");
    updatePlate();
    updateSign();
    updateInfo(Date.now());
    requestAnimationFrame(() => $("info").classList.remove("swap"));
  },
});

const layers = [[$("sky"), 3], [$("far"), 8], [$("train"), 16], [$("near"), 26]];
let tx = 0, ty = 0, cx = 0, cy = 0;
addEventListener("pointermove", e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; });
(function parallax() {
  if (L && (L.W !== innerWidth || L.H !== innerHeight)) build();     // размер окна поменялся — пересобираем сразу
  cx += (tx - cx) * .06;
  cy += (ty - cy) * .06;
  for (const [node, k] of layers) node.style.transform = `translate3d(${(-cx * k).toFixed(2)}px,${(-cy * k * .35).toFixed(2)}px,0)`;
  requestAnimationFrame(parallax);
})();

/* ---------- сборка ---------- */

function build() {
  L = layout();
  farLamps = [];
  for (const id of ["far", "train", "near"]) $(id).setAttribute("viewBox", `-40 -40 ${L.W + 80} ${L.H + 80}`);
  drawFar();
  drawNear();
  drawTrain();
  updatePlate();
  updateSign();
  motion.apply(motion.offset, motion.present);
}

build();

startApp({
  name: "flat",
  env(env, sky) {
    applyPalette(poster, env);
    renderSky(env, sky, { horizon: L.horizon, view: 200, fov: 140 });
  },
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    state.board = board;
    if (stationChanged) updateSign();
    if (changed || stationChanged || !state.shown) return showTrain(current);
    state.shown = current;                 // тот же поезд, обновились данные
    updatePlate();
    updateSign();
  },
  tick(now) {
    if (state.info) updateInfo(now);
  },
});
