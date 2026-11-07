// Маршрутная табличка в окне вагона: красная часть — маршрут и номер поезда,
// синяя — крупная цифра. У настоящей таблички это номер вагона; его в табло РЖД нет,
// поэтому на синем поле — путь, к которому подан поезд.
import { plateLines } from "./names.js";
import { numberText } from "./trains.js";

const NS = "http://www.w3.org/2000/svg";
export const PLATE_W = 1000, PLATE_H = 400;
const RED_W = 690;

const el = (tag, attrs = {}, text) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
};

function fit(node, max) {
  node.removeAttribute("textLength");
  const width = node.getComputedTextLength();
  if (width > max) {
    node.setAttribute("textLength", max);
    node.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
}

/** Рисует табличку в группу g (координаты 0..1000 × 0..400). */
export function drawPlate(g, train) {
  g.replaceChildren();
  g.append(
    el("rect", { x: 0, y: 0, width: PLATE_W, height: PLATE_H, rx: 10, class: "plate-blue" }),
    el("rect", { x: 0, y: 0, width: RED_W, height: PLATE_H, rx: 10, class: "plate-red" }),
    el("rect", { x: RED_W - 12, y: 0, width: 12, height: PLATE_H, class: "plate-red" }),
  );
  if (!train) return;
  const from = plateLines(train.from, 18), to = plateLines(train.to, 18);
  from[from.length - 1] += " –";
  const lines = [...from, ...to];
  const f = Math.min(66, 344 / (1.05 * lines.length + 1.925));
  const texts = [];
  let y = 28 + f * .92;
  for (const line of lines) {
    texts.push([el("text", { x: 30, y, class: "plate-text", "font-size": f.toFixed(1) }, line), RED_W - 60]);
    y += f * 1.05;
  }
  y += f * .62 * .2;
  const small = train.platform ? `ПЛАТФОРМА ${train.platform}` : train.type === "long" ? "ДАЛЬНЕГО СЛЕДОВАНИЯ" : "";
  texts.push([el("text", { x: 30, y, class: "plate-text small", "font-size": (f * .62).toFixed(1) }, small), RED_W - 60]);
  y += f * 1.12;
  texts.push([el("text", { x: 30, y: Math.min(y, PLATE_H - 26), class: "plate-text", "font-size": f.toFixed(1) }, `№ ${numberText(train)}`), RED_W - 60]);
  const track = train.track || "–";
  texts.push([el("text", { x: RED_W + (PLATE_W - RED_W) / 2, y: 262, class: "plate-num", "font-size": track.length > 2 ? 150 : 220, "text-anchor": "middle" }, track), PLATE_W - RED_W - 40]);
  texts.push([el("text", { x: RED_W + (PLATE_W - RED_W) / 2, y: 352, class: "plate-label", "font-size": 62, "text-anchor": "middle" }, "путь"), PLATE_W - RED_W - 40]);
  for (const [node] of texts) g.append(node);
  const refit = () => texts.forEach(([node, max]) => node.isConnected && fit(node, max));
  refit();
  document.fonts?.ready.then(refit);
}
