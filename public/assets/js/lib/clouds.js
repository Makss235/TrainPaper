// Облака: плоские кучевые с ровным низом, в два тона — освещённая часть смещена к солнцу.
// Ближе к горизонту облака мельче и бледнее (перспектива), медленно плывут по небу.

const NS = "http://www.w3.org/2000/svg";

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const el = (tag, attrs, parent) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
};

const circles = lobes => lobes.map(([x, y, r]) =>
  `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0`).join("");

/** Одно облако шириной w: «шапки» разного размера над общим плоским низом. */
function cloudShape(w, random) {
  const lobes = [], n = 4 + Math.floor(random() * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + .5) / n, mid = 1 - Math.abs(t - .5) * 1.5;
    const r = w * (.09 + .12 * mid + random() * .05);
    lobes.push([w * (.08 + .84 * t) + (random() - .5) * w * .05, -r * (.35 + .4 * random()), r]);
  }
  for (let x = .1; x < .92; x += .12) lobes.push([w * x, -w * .03, w * (.07 + random() * .03)]);   // низ без щелей
  return lobes;
}

/**
 * Рисует облака в svg. avoid — прямоугольники {x0,y0,x1,y1}, куда облака не ставим (например, под текстом).
 * Возвращает объект для дрейфа и подсветки.
 */
export function drawClouds(svg, { W, H, horizon, count = 7, seed = 7, avoid = [] }) {
  svg.replaceChildren();
  const random = rng(seed), clouds = [];
  const defs = el("defs", {}, svg);
  let tries = 0;
  while (clouds.length < count && tries++ < count * 12) {
    const y = H * .05 + random() * (horizon - H * .12);
    const near = Math.max(0, Math.min(1, (horizon - y) / horizon));   // 1 — высоко над головой, 0 — у горизонта
    const w = W * (.09 + .17 * near) * (.75 + random() * .5), h = w * .42;
    const x = -w + random() * (W + w);
    const box = { x0: x - 10, y0: y - h, x1: x + w + 10, y1: y + 6 };
    if (avoid.some(a => box.x0 < a.x1 && box.x1 > a.x0 && box.y0 < a.y1 && box.y1 > a.y0)) continue;
    if (clouds.some(c => Math.abs(c.y - y) < h * .7 && box.x0 < c.x + c.w && box.x1 > c.x)) continue;
    const id = `cl${seed}-${clouds.length}`, lobes = cloudShape(w, random), d = circles(lobes);
    const g = el("g", { class: "cloud", opacity: (.55 + .45 * near).toFixed(2) }, svg);
    const clip = el("clipPath", { id }, defs);
    el("path", { d }, clip);
    const flat = el("clipPath", { id: `${id}f` }, defs);
    el("rect", { x: -w, y: -h * 2, width: w * 3, height: h * 2 }, flat);       // плоский низ облака
    const body = el("g", { "clip-path": `url(#${id}f)` }, g);
    el("path", { d, class: "cloud-shade" }, body);
    const litWrap = el("g", { "clip-path": `url(#${id})` }, body);
    const lit = el("path", { d, class: "cloud-lit" }, litWrap);
    clouds.push({ g, lit, x, y, w, h, speed: (4 + random() * 6) * (.4 + .6 * near) });
  }
  return { clouds, W, t0: performance.now() };
}

/** Дрейф по ветру: облако уходит за правый край и возвращается слева. */
export function driftClouds(field, now = performance.now()) {
  if (!field) return;
  const s = (now - field.t0) / 1000;
  for (const c of field.clouds) {
    const span = field.W + c.w * 2 + 80;
    c.cx = ((c.x + c.w + 40 + s * c.speed) % span + span) % span - c.w - 40;
    c.g.setAttribute("transform", `translate(${c.cx.toFixed(1)} ${c.y.toFixed(1)})`);
  }
}

/** Освещённая часть облака смещается к солнцу (sx, sy — солнце на экране). */
export function lightClouds(field, sx, sy) {
  if (!field) return;
  for (const c of field.clouds) {
    const cx = (c.cx ?? c.x) + c.w / 2, cy = c.y - c.h * .4;
    const dx = sx - cx, dy = sy - cy, len = Math.hypot(dx, dy) || 1;
    // солнце высоко — свет сверху; ниже облака — свет снизу, как на закате
    const k = c.w * .07;
    c.lit.setAttribute("transform", `translate(${(dx / len * k).toFixed(1)} ${(Math.min(dy / len, .35) * k - k * .25).toFixed(1)})`);
  }
}
