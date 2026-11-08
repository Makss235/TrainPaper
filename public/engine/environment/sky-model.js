// Цвета неба и освещённость по высоте солнца: таблица «высота → зенит/горизонт» и производные
// величины (сумерки, фонари, звёзды). Цвета в 0…255. Таблицу можно заменить: setSkyTable(rows).
// @ts-nocheck
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// высота солнца (°) → цвет неба в зените и у горизонта
let SKY = [
  [-18, "#050814", "#0b1226"], [-10, "#0a1330", "#1b2446"], [-5, "#1b2a5c", "#5f4b78"],
  [-1.5, "#2b3f7a", "#d9785c"], [3, "#3b61a5", "#f0ac76"], [10, "#3d76bf", "#c6d4dc"],
  [25, "#3878c4", "#a6c9e4"], [50, "#2f6cbc", "#9cc3e6"],
].map(([alt, top, horizon]) => [alt, hex(top), hex(horizon)]);

// высота солнца → множитель освещённости материалов (r, g, b)
const AMBIENT = [
  [-14, [.15, .18, .29]], [-6, [.25, .26, .41]], [-2, [.5, .43, .54]], [1, [.86, .66, .57]],
  [5, [.98, .86, .76]], [12, [1, .97, .94]], [25, [1, 1, 1]],
];

function table(rows, alt, pick) {
  if (alt <= rows[0][0]) return pick(rows[0]);
  for (let i = 1; i < rows.length; i++) {
    if (alt <= rows[i][0]) {
      const t = (alt - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
      const a = pick(rows[i - 1]), b = pick(rows[i]);
      return Array.isArray(a[0]) ? a.map((c, k) => mix(c, b[k], t)) : mix(a, b, t);
    }
  }
  return pick(rows[rows.length - 1]);
}

/** Своя таблица цвета неба: [[высота°, "#зенит", "#горизонт"], ...] по возрастанию высоты. */
export function setSkyTable(rows) {
  SKY = rows.map(([alt, top, horizon]) => [alt, hex(top), hex(horizon)]);
}

export const skyAt = alt => table(SKY, alt, row => [row[1], row[2]]);

export function phaseOf(alt, rising) {
  if (alt >= 6) return { key: "day", label: "день" };
  if (alt >= -6) return rising ? { key: "dawn", label: "рассвет" } : { key: "dusk", label: "закат" };
  return { key: "night", label: "ночь" };
}

/** Всё, что нужно сцене для освещения при данной высоте солнца. */
export function environment(alt, rising) {
  const [top, horizon] = skyAt(alt);
  const day = clamp((alt + 4) / 14);
  return {
    alt, rising, top, horizon, day,
    ambient: table(AMBIENT, alt, row => row[1]),
    glow: clamp(1 - Math.abs(alt - 1.5) / 9),          // золотой час
    lamps: clamp((3 - alt) / 6),                       // фонари и свет в окнах
    stars: clamp((-alt - 6) / 8),
    hazeAmount: .35 + .65 * day,
    sunColor: mix([255, 110, 40], [255, 246, 220], clamp(alt / 14)),
    phase: phaseOf(alt, rising),
  };
}
