// Палитра: имена цветов, которые можно писать в данных вместо "#rrggbb" ({ "color": "platform" }).
// Движок поставляется с пустой палитрой — её задаёт проект: definePalette({ platform: "#c4c4bf" }).
// @ts-check
import { parseColor } from "../core/data.js";

/** @type {Record<string, string>} */
export const PALETTE = {};

/** Добавить или заменить именованные цвета. @param {Record<string, string>} colors */
export function definePalette(colors) {
  Object.assign(PALETTE, colors);
}

/** Цвет из имени палитры, "#rrggbb" или [r, g, b] → [r, g, b] (0…1). @param {string | number[]} c */
export const rgb = c => parseColor(c, PALETTE);
