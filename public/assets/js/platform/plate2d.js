// Маршрутная табличка (canvas) и вывод картинки на перспективный четырёхугольник без 3D:
// картинка режется на вертикальные полоски, каждая натягивается своим аффинным преобразованием.
import { plateLines } from "../lib/names.js";
import { numberText } from "../lib/trains.js";

export const PLATE_W = 1000, PLATE_H = 400;
const RED_W = 690;

export function plateCanvas() {
  const c = document.createElement("canvas");
  c.width = PLATE_W; c.height = PLATE_H;
  return c;
}

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

/**
 * Рисует img на четырёхугольник в плоскости, заданный функцией corner(s, t) → точка экрана
 * (s — по ширине картинки 0…1, t — по высоте 0…1). Картинка режется на вертикальные полоски,
 * каждая натягивается своим аффинным преобразованием — так получается перспектива вдоль вагона.
 * opaque = true: полоски кладутся внахлёст без отдельной обрезки (картинка непрозрачная, внахлёст
 * не видно), общую обрезку по контуру делает вызывающий — швов нет.
 */
export function drawImageQuad(ctx, img, corner, slices = 16, opaque = false) {
  const W = img.width, H = img.height;
  for (let j = 0; j < slices; j++) {
    const s0 = j / slices, s1 = (j + 1) / slices;
    const a = corner(s0, 0), b = corner(s1, 0), c = corner(s0, 1), d = corner(s1, 1);
    if (!a || !b || !c || !d) continue;
    ctx.save();
    if (!opaque) {
      ctx.beginPath();
      ctx.moveTo(a[0] - .4, a[1]); ctx.lineTo(b[0] + .4, b[1]); ctx.lineTo(d[0] + .4, d[1]); ctx.lineTo(c[0] - .4, c[1]);
      ctx.closePath();
      ctx.clip();
    }
    const sw = (s1 - s0) * W;
    // середина нижней кромки полоски — среднее c и d: так соседние полоски сходятся без ступенек
    const cx = [(c[0] + d[0] - (b[0] - a[0])) / 2, (c[1] + d[1] - (b[1] - a[1])) / 2];
    ctx.transform((b[0] - a[0]) / sw, (b[1] - a[1]) / sw, (cx[0] - a[0]) / H, (cx[1] - a[1]) / H, a[0], a[1]);
    const extra = opaque ? Math.min(3, W - (s0 * W + sw)) : 1;     // внахлёст на соседнюю полоску
    ctx.drawImage(img, s0 * W, 0, sw + extra, H, 0, 0, sw + extra, H);
    ctx.restore();
  }
}
