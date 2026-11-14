// Палитра: имена цветов, которые можно писать в данных вместо "#rrggbb" ({ "color": "floor" }).
// У каждого движка своя палитра — engine.palette; её задаёт проект:
//   new Engine({ palette: { floor: "#c4c4bf" } })  или  engine.palette.define({ floor: "#c4c4bf" }).
// Манифест моделей (assets/models/index.jsonc, поле palette) дополняет палитру своего движка.
//
// Код моделей строится синхронно внутри build(params, kit): на это время «текущей» становится палитра
// строящего движка, поэтому rgb("roof"), new LineBatch(), geometry.Batch внутри модели берут цвета
// из нужной палитры, даже если на странице два движка с разными палитрами.
// @ts-check
import { parseColor } from "../core/data.js";

export class Palette {
  /** @param {Record<string, string>} [colors] */
  constructor(colors = {}) {
    /** @type {Record<string, string>} */
    this.colors = { ...colors };
  }

  /** Добавить или заменить именованные цвета. @param {Record<string, string>} colors */
  define(colors) {
    Object.assign(this.colors, colors);
    return this;
  }

  /** Цвет из имени палитры, "#rrggbb" или [r, g, b] → [r, g, b] (0…1). @param {string | number[]} c */
  rgb(c) {
    return parseColor(c, this.colors);
  }
}

/** Палитра без имён: когда цвет разбирается вне движка (только "#rrggbb" и [r, g, b]). */
const EMPTY = new Palette();
/** @type {Palette[]} стек «текущих» палитр (построение модели) */
const stack = [];
/** @type {Palette | null} палитра последнего созданного движка — для старого кода без движка под рукой */
let last = null;

/** Текущая палитра: строящегося движка, иначе последнего созданного. */
export function currentPalette() {
  return stack[stack.length - 1] || last || EMPTY;
}

/**
 * Выполнить fn с палитрой palette как текущей (движок оборачивает так построение моделей).
 * @template T
 * @param {Palette} palette
 * @param {() => T} fn
 * @returns {T}
 */
export function withPalette(palette, fn) {
  stack.push(palette);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** Палитра нового движка становится запасной для кода вне построения моделей. @param {Palette} palette */
export function registerPalette(palette) {
  last = palette;
}

/**
 * Цвет по текущей палитре (внутри модели — палитра её движка). В компонентах лучше this.engine.palette.rgb().
 * @param {string | number[]} c
 */
export const rgb = c => currentPalette().rgb(c);
