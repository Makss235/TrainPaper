// Цвета неба и освещённость по высоте солнца: таблица «высота → зенит/горизонт» и производные
// величины (сумерки, фонари, звёзды). Цвета в 0…255. Чистая математика — без three.js.
//
// Таблица неба своя у каждого движка: engine.environment.setSkyTable(rows) или в данных сцены
//   "environment": { "sky": [[-18, "#050814", "#0b1226"], [3, "#3b61a5", "#f0ac76"], ...] }
// @ts-check
const clamp = (/** @type {number} */ v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const hex = (/** @type {string} */ h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ t) => a.map((v, i) => v + (b[i] - v) * t);

/** @typedef {[number, number[], number[]][]} SkyTable  [высота°, зенит rgb, горизонт rgb] по возрастанию высоты */

/** Таблица из данных: [[высота°, "#зенит", "#горизонт"], ...] → SkyTable. @param {[number, string, string][]} rows @returns {SkyTable} */
export function parseSkyTable(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("Таблица неба: нужно не меньше двух строк [высота°, \"#зенит\", \"#горизонт\"]");
  return rows.map(([alt, top, horizon]) => /** @type {[number, number[], number[]]} */ ([alt, hex(top), hex(horizon)]))
    .sort((a, b) => a[0] - b[0]);
}

/** Встроенная таблица: высота солнца (°) → цвет неба в зените и у горизонта. */
export const DEFAULT_SKY = parseSkyTable([
  [-18, "#050814", "#0b1226"], [-10, "#0a1330", "#1b2446"], [-5, "#1b2a5c", "#5f4b78"],
  [-1.5, "#2b3f7a", "#d9785c"], [3, "#3b61a5", "#f0ac76"], [10, "#3d76bf", "#c6d4dc"],
  [25, "#3878c4", "#a6c9e4"], [50, "#2f6cbc", "#9cc3e6"],
]);

// высота солнца → множитель освещённости материалов (r, g, b)
/** @type {[number, number[]][]} */
const AMBIENT = [
  [-14, [.15, .18, .29]], [-6, [.25, .26, .41]], [-2, [.5, .43, .54]], [1, [.86, .66, .57]],
  [5, [.98, .86, .76]], [12, [1, .97, .94]], [25, [1, 1, 1]],
];

/**
 * @param {any[]} rows @param {number} alt @param {(row: any) => any} pick
 * @returns {any}
 */
function table(rows, alt, pick) {
  if (alt <= rows[0][0]) return pick(rows[0]);
  for (let i = 1; i < rows.length; i++) {
    if (alt <= rows[i][0]) {
      const t = (alt - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
      const a = pick(rows[i - 1]), b = pick(rows[i]);
      return Array.isArray(a[0]) ? a.map((/** @type {number[]} */ c, /** @type {number} */ k) => mix(c, b[k], t)) : mix(a, b, t);
    }
  }
  return pick(rows[rows.length - 1]);
}

/** Цвет неба [зенит, горизонт] при высоте солнца alt. @param {number} alt @param {SkyTable} [sky] @returns {[number[], number[]]} */
export const skyAt = (alt, sky = DEFAULT_SKY) => table(sky, alt, row => [row[1], row[2]]);

/** @param {number} alt @param {boolean} rising */
export function phaseOf(alt, rising) {
  if (alt >= 6) return { key: "day", label: "день" };
  if (alt >= -6) return rising ? { key: "dawn", label: "рассвет" } : { key: "dusk", label: "закат" };
  return { key: "night", label: "ночь" };
}

/**
 * Всё, что нужно сцене для освещения при данной высоте солнца.
 * @param {number} alt @param {boolean} rising @param {SkyTable} [sky]
 */
export function environment(alt, rising, sky = DEFAULT_SKY) {
  const [top, horizon] = skyAt(alt, sky);
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
