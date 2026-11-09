// Встроенные эффекты пост-обработки — регистрируются при подключении движка.
// Набор по умолчанию (из style.filters): grade, vignette, posterize, grain, dither.
// По желанию (в данных сцены "post" или engine.post.add): bloom, outline, lut.
// @ts-check
import { registerPostEffect } from "../post.js";
import { Dither, Grade, Grain, Posterize, Vignette } from "./basic.js";
import { Bloom, Lut, Outline } from "./passes.js";

for (const C of [Grade, Vignette, Posterize, Grain, Dither, Bloom, Outline, Lut]) registerPostEffect(/** @type {any} */ (C));

export { Bloom, Dither, Grade, Grain, Lut, Outline, Posterize, Vignette };

/**
 * Набор эффектов по умолчанию из style.filters (прежний формат стиля).
 * @param {Record<string, any>} F  style.filters
 */
export function defaultEffects(F) {
  return [
    { type: "grade", exposure: F.exposure, contrast: F.contrast, saturation: F.saturation, warmth: F.warmth },
    { type: "vignette", amount: F.vignette, color: F.vignetteColor },
    { type: "posterize", levels: F.posterize },
    { type: "grain", amount: F.grain, animated: !!F.grainAnimated },
    { type: "dither", amount: F.dither },
  ];
}
