// Пример детальных моделей (examples): скоростной электропоезд с обтекаемым носом.
// Скоростной электропоезд (обобщённый, в духе «Ласточки»): светлый кузов, сплошная тёмная лента окон,
// красный низ с подъёмом к носу, красные двери. Головной вагон с обтекаемым носом и промежуточный.
// Состав собирается так: голова, промежуточные, голова развёрнутая (см. trains/index.js).
import * as THREE from "three";
import { MATERIALS } from "../../../js/lib/palette.js";
import { geometry, rgb } from "../../../../engine/index.js";

const { loft } = geometry;
import { buildCoach } from "./_coach.js";
import { drawLogo, liveryCanvas } from "./_livery.js";

const BOTTOM = 1.05, WALL_TOP = 3.95, VSCALE = 3.65;
const SHOULDER = [[0, 0], [.06, .18], [.16, .36], [.34, .52], [.62, .64], [1.0, .7], [1.6, .72]];
const BAND = [2.08, 2.86];                     // лента окон по высоте
const NOSE = 5.4;

/**
 * Ливрея борта. mirror — рисунок для борта +x: смотрим «с другой стороны», поэтому нос (z = L)
 * оказывается слева на холсте; буквы и логотип при этом не зеркальные.
 */
function paint(canvas, L, { head, mirror = false }) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, ppm = W / L;
  const X = z => (mirror ? L - z : z) * ppm, Y = y => (1 - (y - BOTTOM) / VSCALE) * H;
  const box = (z0, z1, y0, y1, r = 0) => {
    const a = Math.min(X(z0), X(z1)), w = Math.abs(X(z1) - X(z0));
    g.beginPath(); g.roundRect(a, Y(y1), w, Y(y0) - Y(y1), r); g.fill();
  };
  g.fillStyle = "#e6e8e9"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#3b4046"; g.fillRect(0, Y(BAND[1] + .06), W, Y(BAND[0] - .06) - Y(BAND[1] + .06));
  g.fillStyle = MATERIALS.band; g.fillRect(0, Y(1.32), W, H - Y(1.32));
  g.fillStyle = MATERIALS.red; g.fillRect(0, Y(1.62), W, Y(1.32) - Y(1.62));
  if (head) {
    // у носа красный низ поднимается волной к ленте окон
    g.beginPath(); g.moveTo(X(L - 11), Y(1.62));
    g.bezierCurveTo(X(L - 7.5), Y(1.62), X(L - 6.5), Y(BAND[0] - .1), X(L - 4.2), Y(BAND[0] - .1));
    g.lineTo(X(L), Y(BAND[0] - .1)); g.lineTo(X(L), Y(1.32)); g.lineTo(X(L - 11), Y(1.32)); g.closePath(); g.fill();
  }
  // двери: красные, с узким окном
  for (const z of doors(L, head)) {
    g.fillStyle = MATERIALS.red; box(z, z + 1.3, 1.12, 3.55, ppm * .06);
    g.fillStyle = "#30363c"; box(z + .2, z + 1.1, 2.2, 3.25, ppm * .08);
  }
  const lw = ppm * .45 * 55.12 / 24.41, lz = head ? L - 9.6 : L / 2 - .7;
  drawLogo(g, mirror ? X(lz) - lw : X(lz), Y(3.75), ppm * .45, MATERIALS.red);
}

const doors = (L, head) => (head ? [3.6, L - 9.2] : [3.6, L - 4.9]);

/** Сплошные ленты окон между дверями. */
function bands(L, head) {
  const ds = doors(L, head), out = [];
  let z = .6;
  for (const d of ds) { if (d - z > .5) out.push({ z0: z, z1: d - .15, y0: BAND[0], y1: BAND[1] }); z = d + 1.45; }
  const end = head ? L - NOSE - .2 : L - .6;
  if (end - z > .5) out.push({ z0: z, z1: end, y0: BAND[0], y1: BAND[1] });
  return out;
}

/**
 * Нос головного вагона: сечения кузова сужаются и опускаются к лбу. Цвет — полосами по отрезкам
 * профиля (как ливрея борта): тёмный низ, красная полоса, лобовое стекло, светлый кузов.
 */
function nose(L) {
  return ({ parts, profile: base }) => {
    // вертикальные стенки профиля режем по границам цветовых зон: иначе вся стенка — один отрезок
    // и красится одним цветом
    const cuts = [1.32, 1.62, BAND[0] - .05, BAND[1] + .05, 3.3];
    const profile = [];
    base.forEach((p, i) => {
      const q = base[(i + 1) % base.length];
      profile.push(p);
      if (Math.abs(p[0] - q[0]) < 1e-3) {
        const ys = cuts.filter(y => (y - p[1]) * (y - q[1]) < 0).sort((a, b) => (q[1] > p[1] ? a - b : b - a));
        for (const y of ys) profile.push([p[0], y]);
      }
    });
    // сечения гуще к лбу: там профиль меняется быстрее всего
    const ts = Array.from({ length: 17 }, (_, i) => 1 - (1 - i / 16) ** 1.4);
    const sections = ts.map(t => {
      const sx = 1 - .34 * t ** 2, k = 1 - .52 * t ** 1.6;
      return { z: L - NOSE + NOSE * t, pts: profile.map(([x, y]) => [x * sx, BOTTOM + (y - BOTTOM) * k]) };
    });
    const g = loft(sections, { closed: true, capEnd: true, center: [0, BOTTOM + 1.2] });
    const red = rgb("red"), glassC = [.17, .2, .24], body = rgb("#e6e8e9"), dark = rgb("band");
    const n = profile.length;                                   // отрезков в сечении (профиль замкнут)
    const zone = (i, s) => {
      const y = (profile[i][1] + profile[(i + 1) % n][1]) / 2;   // высота отрезка на полном сечении
      const t = ts[s];
      if (y < 1.32) return dark;
      if (y < 1.62 + (BAND[0] - .1 - 1.62) * Math.min(1, t * 2.2)) return red;   // красный поднимается к стеклу
      // лента окон продолжается на нос, у самого лба переходит в лобовое стекло
      const top = BAND[1] + .05 + Math.max(0, t - .55) * 2.4;
      if (y >= BAND[0] - .05 && y <= top) return glassC;
      return body;
    };
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const loftTris = (ts.length - 1) * n * 2;
    for (let tri = 0; tri < p.count / 3; tri++) {
      let c = red;                                               // лоб (крышка) — красный
      if (tri < loftTris) {
        const q = Math.floor(tri / 2);
        c = zone(q % n, Math.floor(q / n));
      }
      for (let k = 0; k < 3; k++) col.set(c, (tri * 3 + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.parts.push(g);
  };
}

function spec(L, head) {
  const canvas = liveryCanvas(4096, Math.round(4096 / L * VSCALE));
  paint(canvas, L, { head });
  // у головного вагона борта разные (нос с одной стороны) — второй холст для борта +x
  const canvasRight = head ? liveryCanvas(4096, canvas.height) : null;
  if (canvasRight) paint(canvasRight, L, { head, mirror: true });
  const s = {
    length: L, half: 1.6, bottom: BOTTOM, wallTop: WALL_TOP, shoulder: SHOULDER, liveryBands: 3,
    livery: { canvas, canvasRight, vBase: BOTTOM, vScale: VSCALE },
    windows: [], plateWindow: null, glassBands: bands(L, head),
    bogies: head ? [3.2, L - 7.6] : [3.2, L - 3.2],
    boxes: [[6, 9], [14, 17.5]], steps: [],
    roofBoxes: head ? [[6, 11]] : [[8, 14]],
    colors: { roof: "#c9ccce", end: "#3b4046" },
    ...(head ? { bodyEnd: L - NOSE, nose: nose(L) } : {}),
  };
  document.fonts?.ready.then(() => {
    paint(canvas, L, { head });
    if (canvasRight) paint(canvasRight, L, { head, mirror: true });
    if (s.texture) s.texture.needsUpdate = true;
    if (s.textureRight) s.textureRight.needsUpdate = true;
  });
  return s;
}

const HEAD = spec(26.2, true), MIDDLE = spec(25.0, false);

export const emuHead = {
  name: "Электропоезд, головной (детальный)",
  meta: {
    length: HEAD.length, gap: .5, cab: true,
    gangway: { half: .7, y: [1.3, 3.7] },
    headLights: [[-.6, 1.6, HEAD.length + .06], [.6, 1.6, HEAD.length + .06]],
    tailLights: [[-1.0, 1.5], [1.0, 1.5]],
    windowSpill: HEAD.glassBands.map(b => [b.z0, b.z1]),
  },
  build: (p, kit) => buildCoach(HEAD, kit),
};

export const emuMiddle = {
  name: "Электропоезд, промежуточный (детальный)",
  meta: {
    length: MIDDLE.length, gap: .5,
    gangway: { half: .7, y: [1.3, 3.7] },
    tailLights: [[-1.0, 1.5], [1.0, 1.5]],
    windowSpill: MIDDLE.glassBands.map(b => [b.z0, b.z1]),
  },
  build: (p, kit) => buildCoach(MIDDLE, kit),
};
