// Дневные цвета материалов «Платформы». Основа — общая палитра lib/palette.js (её же использует
// вид «Вагон»), сверху — цвета окружения, которые нужны только здесь.
// Освещение, дымку и ночь накладывает шейдер, поэтому здесь — цвет при ровном дневном свете.
import { MATERIALS } from "../lib/palette.js";

export const COLORS = {
  ...MATERIALS,
  // земля и дальний план
  ground: "#86926f", ground2: "#7c8a68", city: "#9aa6b3", city2: "#adb7c2", city3: "#8f9ba8",
  hills: "#7d8b86", hills2: "#8f9c97", snow: "#eef2f6",
  trunk: "#5b4636", tree1: "#4f7a4a", tree2: "#5d8650", tree3: "#557c58", tree4: "#678f55", tree5: "#4a6f4f",
  // платформа
  platform: "#c4c4bf", tileLine: "#a7a8a2", coping: "#e0dfd8", platformSide: "#9fa09b",
  // путь
  ballast: "#8a8378", sleeper: "#8e8a82", rail: "#7d8287", railTop: "#c6cace",
  // металл и бетон
  fence: "#2b2e32", post: "#3a3e43", lamp: "#4b4f54", concrete: "#a9aaa6", concreteDark: "#8e8f8b",
  steel: "#7f858c", wire: "#33373c", insulator: "#5c3d2e", mastBand: "#b04a3e", foundation: "#9e9e98",
  bridge: "#7c8590", canopy: "#5e646b", canopyUnder: "#8a9097", column: "#6c727a",
  // здания-заготовки
  wall: "#c9c2b3", wallDark: "#a59e90", roofDark: "#59606a", windowDark: "#46505b", trim: "#eceae4",
};

/** "#rrggbb" или [r, g, b] (0…1) → [r, g, b] (0…1). */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  const name = COLORS[c];
  const h = name || c;
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** Цвет темнее/светлее: k < 1 — темнее. */
export const shadeRgb = (c, k) => rgb(c).map(v => Math.min(1, v * k));
export const mixRgb = (a, b, t) => rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t);
