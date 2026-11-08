// Маршрутная табличка в окне вагона, как настоящая: маршрут и номер на красном поле, справа на синем —
// крупная цифра. У настоящей таблички это номер вагона; его в табло РЖД нет, поэтому — путь.
// Одна табличка (canvas → текстура) на поезд: во всех вагонах она одинаковая.
// @ts-nocheck
import * as THREE from "three";
import { plateLines } from "../lib/names.js";
import { numberText } from "../lib/trains.js";

export const PLATE_W = 1000, PLATE_H = 400;
const RED_W = 690;

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

/** Табличка поезда: текстура, которую ставят в окна всех вагонов этого поезда. */
export class Plate {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = PLATE_W;
    this.canvas.height = PLATE_H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = 4;
    this.train = null;
    paintPlate(this.canvas, null);
    document.fonts?.ready.then(() => this.set(this.train));
  }

  set(train) {
    this.train = train;
    paintPlate(this.canvas, train);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
