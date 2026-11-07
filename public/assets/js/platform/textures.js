// Текстуры сцены рисуются на canvas: борт вагона — из той же модели ливреи, что и плоский вид
// (lib/coach.js), чтобы ливрея была одна на оба вида.
import * as THREE from "three";
import { CAR_L, coachShapes, RZD_LOGO } from "../lib/coach.js";
import { MATERIALS } from "../lib/palette.js";
import { plateLines } from "../lib/names.js";
import { numberText } from "../lib/trains.js";

let maxAniso = 8;
export const setAnisotropy = n => { maxAniso = n; };

export function canvasTexture(canvas, { repeat = null, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  return tex;
}

const make = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
};
const color = cls => MATERIALS[cls] || "#ff00ff";

/* ---------- борт вагона ---------- */

/**
 * Борт вагона: u — по длине (0 — торец с логотипом), v — по высоте боковины (0…1).
 * Возвращает {map, emissive}: emissive — где ночью светятся окна.
 */
export function coachSideTextures(ppu = 512) {
  const W = Math.round(CAR_L * ppu), H = Math.round(ppu * 1.0);
  const [c, g] = make(W, H);
  const [e, ge] = make(W, H);
  const X = u => u * ppu, Y = v => (1 - v) * ppu;
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);
  const poly = (ctx, pts) => {
    ctx.beginPath();
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
    ctx.closePath();
  };
  const roundRect = (ctx, x0, y0, x1, y1, r) => {
    ctx.beginPath();
    ctx.roundRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), r);
  };
  for (const s of coachShapes({ index: 1 })) {
    if (s.kind === "logo") {
      g.save();
      if (s.clipTop) { g.beginPath(); g.rect(0, Y(s.clipTop), W, H); g.clip(); }
      g.translate(X(s.u0), Y(s.v0));
      g.scale(s.k * ppu, s.k * ppu);
      g.fillStyle = color(s.cls.slice(2));
      g.fill(new Path2D(RZD_LOGO));
      g.restore();
    } else if (s.kind === "window" || s.kind === "doorWindow") {
      const isWin = s.kind === "window";
      const [u0, v0, u1, v1] = isWin ? [s.u0, s.v0, s.u1, s.v1]
        : [Math.min(...s.pts.map(p => p[0])), Math.min(...s.pts.map(p => p[1])), Math.max(...s.pts.map(p => p[0])), Math.max(...s.pts.map(p => p[1]))];
      const r = isWin ? s.r * ppu : (u1 - u0) * ppu / 2;
      // стекло: днём отражает небо, сверху — тёмная шторка; рама — тёмная
      roundRect(g, X(u0), Y(v1), X(u1), Y(v0), r);
      const glass = g.createLinearGradient(0, Y(v1), 0, Y(v0));
      glass.addColorStop(0, "#7f93a6");
      glass.addColorStop(.55, "#9fb0bf");
      glass.addColorStop(1, "#6d7c8a");
      g.fillStyle = glass;
      g.fill();
      g.save();
      g.clip();
      if (isWin) {
        g.fillStyle = color("glasstop");
        g.fillRect(X(u0), Y(v1), X(u1) - X(u0), Y(s.transom) - Y(v1));
      }
      g.globalAlpha = .28;                                  // блики
      g.fillStyle = "#ffffff";
      const ww = X(u1) - X(u0), hh = Y(v0) - Y(v1);
      g.beginPath();
      g.moveTo(X(u0) + ww * .15, Y(v0)); g.lineTo(X(u0) + ww * .32, Y(v0));
      g.lineTo(X(u0) + ww * .7, Y(v1)); g.lineTo(X(u0) + ww * .53, Y(v1));
      g.fill();
      g.restore();
      g.lineWidth = Math.max(2, ppu * (isWin ? .016 : .014));
      g.strokeStyle = color("frame");
      roundRect(g, X(u0), Y(v1), X(u1), Y(v0), r);
      g.stroke();
      if (isWin) {
        g.beginPath(); g.moveTo(X(u0), Y(s.transom)); g.lineTo(X(u1), Y(s.transom));
        g.lineWidth = ppu * .008; g.stroke();
      }
      // ночью окно светится тёплым: верх (шторка) — приглушённо
      roundRect(ge, X(u0), Y(v1), X(u1), Y(v0), r);
      const glow = ge.createLinearGradient(0, Y(v1), 0, Y(v0));
      glow.addColorStop(0, isWin ? "#5a4a30" : "#ffffff");
      glow.addColorStop(isWin ? .3 : 0, isWin ? "#ffe0a0" : "#ffffff");
      glow.addColorStop(1, "#ffd27a");
      ge.fillStyle = glow;
      ge.fill();
    } else if (s.kind === "text") {
      g.fillStyle = color(s.cls?.slice(2) || "text");
      g.font = `700 ${Math.round(s.size * ppu)}px "Exo 2", sans-serif`;
      g.fillText(s.text, X(s.u), Y(s.v));
    } else if (s.pts && s.cls) {
      if (s.pts.every(([, v]) => v < 0 || v > 1.001)) continue;     // низ и крыша — отдельной геометрией
      poly(g, s.pts);
      if (s.cls.startsWith("o-")) {
        g.fillStyle = s.cls === "o-light1" ? "rgba(255,255,255,.18)" : s.cls === "o-dark2" ? "rgba(0,0,0,.2)" : "rgba(0,0,0,.09)";
      } else {
        g.fillStyle = color(s.cls.slice(2));
      }
      g.fill();
      if (s.stroke) { g.lineWidth = s.sw * ppu; g.strokeStyle = color(s.stroke.slice(2)); g.stroke(); }
    } else if (s.line) {
      g.beginPath();
      g.moveTo(X(s.line[0][0]), Y(s.line[0][1]));
      g.lineTo(X(s.line[1][0]), Y(s.line[1][1]));
      g.lineWidth = Math.max(1, s.w * ppu);
      g.strokeStyle = color(s.cls.slice(2).replace("-v", ""));
      g.stroke();
    }
  }
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

/** Торец вагона по схеме: тёмно-серый, дверь с овальным окном и козырьком, сигнальные фонари. */
export function coachEndTexture() {
  const [c, g] = make(512, 512);
  g.fillStyle = color("darkend");
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = "rgba(0,0,0,.18)";
  g.fillRect(0, 440, 512, 72);
  g.fillStyle = "#3f4347";
  g.fillRect(160, 70, 192, 26);                                    // козырёк
  g.fillStyle = "#4a4e52";
  g.fillRect(176, 96, 160, 330);                                   // дверь
  g.strokeStyle = "#2d3033"; g.lineWidth = 8; g.strokeRect(176, 96, 160, 330);
  g.fillStyle = "#8696a3"; g.strokeStyle = "#202224"; g.lineWidth = 9;
  g.beginPath(); g.roundRect(222, 150, 68, 110, 34); g.fill(); g.stroke();
  for (const [x, y] of [[70, 130], [442, 130], [70, 380], [442, 380]]) {
    g.fillStyle = "#2a2c2e"; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
    g.fillStyle = "#9a5a2a"; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill();
  }
  return canvasTexture(c);
}

/** Гармошка перехода: вертикальные складки. */
export function bellowsTexture() {
  const [c, g] = make(64, 256);
  g.fillStyle = color("bellows");
  g.fillRect(0, 0, 64, 256);
  for (let x = 0; x < 64; x += 8) {
    g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(x, 0, 3, 256);
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x + 4, 0, 2, 256);
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

/* ---------- локомотив ---------- */

/** Борт пассажирского электровоза в цветах РЖД: красный кузов, серый низ, тёмная полоса окон кабины. */
export function locoSideTexture(lengthM, heightM) {
  const ppm = 128, W = Math.round(lengthM * ppm), H = Math.round(heightM * ppm);
  const [c, g] = make(W, H);
  g.fillStyle = MATERIALS.red; g.fillRect(0, 0, W, H);
  g.fillStyle = "#5f6368"; g.fillRect(0, H * .8, W, H * .2);                 // серый низ
  g.fillStyle = "#d0d1d1"; g.fillRect(0, H * .76, W, H * .04);               // светлая линия
  for (let x = W * .08; x < W * .86; x += W * .085) {                          // жалюзи машинного отделения
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(x, H * .2, W * .05, H * .22);
  }
  g.fillStyle = "#1d2023";                                                     // окна кабины у переднего торца
  g.beginPath(); g.roundRect(W * .9, H * .14, W * .07, H * .26, 10); g.fill();
  g.save();
  g.translate(W * .36, H * .68); g.scale(H * .012, H * .012);
  g.fillStyle = "#ffffff"; g.fill(new Path2D(RZD_LOGO));
  g.restore();
  return canvasTexture(c);
}

/** Лобовая часть электровоза: окна кабины, буферные фонари, логотип. */
export function locoFrontTexture() {
  const [c, g] = make(512, 640);
  g.fillStyle = MATERIALS.red; g.fillRect(0, 0, 512, 640);
  g.fillStyle = "#5f6368"; g.fillRect(0, 512, 512, 128);
  g.fillStyle = "#d0d1d1"; g.fillRect(0, 488, 512, 22);
  g.fillStyle = "#1b1e21";
  g.beginPath(); g.roundRect(40, 70, 205, 150, 18); g.fill();
  g.beginPath(); g.roundRect(267, 70, 205, 150, 18); g.fill();
  g.fillStyle = "rgba(160,190,215,.35)";
  g.beginPath(); g.moveTo(60, 210); g.lineTo(110, 210); g.lineTo(200, 80); g.lineTo(150, 80); g.fill();
  g.save(); g.translate(176, 300); g.scale(2.9, 2.9); g.fillStyle = "#ffffff"; g.fill(new Path2D(RZD_LOGO)); g.restore();
  for (const x of [90, 422]) { g.fillStyle = "#26292c"; g.beginPath(); g.arc(x, 430, 30, 0, 7); g.fill(); }
  return canvasTexture(c);
}

/* ---------- платформа и окрестности ---------- */

export function tileTexture() {
  const [c, g] = make(256, 256);
  g.fillStyle = MATERIALS.platform; g.fillRect(0, 0, 256, 256);
  // лёгкая неоднородность плиток
  let seed = 9;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      g.fillStyle = `rgba(${rnd() < .5 ? "255,255,255" : "0,0,0"},${.02 + rnd() * .035})`;
      g.fillRect(i * 64, j * 64, 64, 64);
    }
  }
  g.strokeStyle = MATERIALS.tile; g.lineWidth = 3;
  for (let k = 0; k <= 256; k += 64) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke();
  }
  return canvasTexture(c);
}

export function tactileTexture() {
  const [c, g] = make(128, 128);
  g.fillStyle = MATERIALS.tactile; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(0,0,0,.14)";
  for (let y = 0; y < 128; y += 32) g.fillRect(0, y + 12, 128, 9);
  return canvasTexture(c);
}

/** Круглое мягкое пятно — свечение, световое пятно фонаря, отсвет. */
export function radialTexture(stops, size = 256) {
  const [c, g] = make(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return canvasTexture(c);
}

/** Полоса-градиент для отсвета окон на платформе: ярко у края, к центру платформы гаснет. */
export function spillTexture() {
  const [c, g] = make(128, 32);
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgba(255,214,140,0)");                  // ярко у вагона (справа), к центру платформы гаснет
  grad.addColorStop(1, "rgba(255,214,140,1)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 32);
  const fade = g.createLinearGradient(0, 0, 0, 32);
  g.globalCompositeOperation = "destination-in";
  fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(.25, "#000"); fade.addColorStop(.75, "#000"); fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade; g.fillRect(0, 0, 128, 32);
  return canvasTexture(c);
}

/** Ограда вдали: полупрозрачные вертикальные прутья (вместо тысяч отдельных). */
export function fenceTexture() {
  const [c, g] = make(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = MATERIALS.fence;
  g.fillRect(0, 0, 64, 4); g.fillRect(0, 56, 64, 4);
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 3, 64);
  return canvasTexture(c, { repeat: [1, 1] });
}

/* ---------- маршрутная табличка ---------- */

const PLATE_W = 1000, PLATE_H = 400, RED_W = 690;

/** Табличка в окне вагона, как настоящая: маршрут и номер на красном, путь — на синем. */
export function paintPlate(canvas, train) {
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, PLATE_W, PLATE_H);
  g.fillStyle = "#134c73"; g.beginPath(); g.roundRect(0, 0, PLATE_W, PLATE_H, 12); g.fill();
  g.fillStyle = "#c8141c"; g.beginPath(); g.roundRect(0, 0, RED_W, PLATE_H, [12, 0, 0, 12]); g.fill();
  if (!train) return;
  const from = plateLines(train.from, 18), to = plateLines(train.to, 18);
  from[from.length - 1] += " –";
  const lines = [...from, ...to];
  const f = Math.min(66, 344 / (1.05 * lines.length + 1.925));
  const text = (str, x, y, size, weight, max, fill, align = "left") => {
    g.font = `${weight} ${size}px "Exo 2", sans-serif`;
    g.fillStyle = fill; g.textAlign = align;
    const w = g.measureText(str).width;
    g.save();
    if (w > max) { g.translate(x, 0); g.scale(max / w, 1); g.translate(-x, 0); }
    g.fillText(str, x, y);
    g.restore();
  };
  let y = 28 + f * .92;
  for (const line of lines) { text(line, 30, y, f, 600, RED_W - 60, "#f7ecec"); y += f * 1.05; }
  y += f * .12;
  const small = train.platform ? `ПЛАТФОРМА ${train.platform}` : train.type === "long" ? "ДАЛЬНЕГО СЛЕДОВАНИЯ" : "";
  text(small, 30, y, f * .62, 500, RED_W - 60, "#f7ecec");
  y += f * 1.12;
  text(`№ ${numberText(train)}`, 30, Math.min(y, PLATE_H - 26), f, 600, RED_W - 60, "#f7ecec");
  const track = train.track || "–";
  text(track, RED_W + (PLATE_W - RED_W) / 2, 262, track.length > 2 ? 150 : 220, 500, PLATE_W - RED_W - 40, "#cdeee3", "center");
  text("путь", RED_W + (PLATE_W - RED_W) / 2, 352, 62, 500, PLATE_W - RED_W - 40, "#cdeee3", "center");
}

export function plateCanvas() {
  return make(PLATE_W, PLATE_H)[0];
}
export const PLATE_ASPECT = PLATE_W / PLATE_H;
