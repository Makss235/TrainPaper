// Встроенные однопроходные эффекты сборки кадра — бывшие фильтры style.filters:
//   grade     — экспозиция, контраст, насыщенность, тёплый/холодный тон;
//   vignette  — виньетка (как прежняя CSS-виньетка: эллипс, тёмный к краям);
//   posterize — постеризация (уровней на канал);
//   grain     — плёночное зерно (animated — зерно «живое», кадры сборки ~12 раз в секунду);
//   dither    — дизеринг ±½ ступени 8 бит: убирает полосы на градиентах неба. Всегда последний.
// Формулы — те же, что были в composite.js: кадр совпадает с прежним (±1 из-за дизеринга).
// @ts-check
import { PostEffect } from "../post.js";

export class Grade extends PostEffect {
  static type = "grade";
  static order = 10;
  static doc = "Цветокоррекция: экспозиция, контраст, насыщенность, теплота.";
  static props = {
    exposure: { type: "number", default: 1, min: 0, doc: "Экспозиция (множитель)" },
    contrast: { type: "number", default: 1.03, min: 0, doc: "Контраст" },
    saturation: { type: "number", default: 1.04, min: 0, doc: "Насыщенность" },
    warmth: { type: "number", default: 0, doc: "Тёплый (+) / холодный (−) тон" },
  };
  static glsl = /* glsl */`
    uniform vec4 uGrade;           // экспозиция, контраст, насыщенность, теплота
    vec3 grade(vec3 col, vec2 uv){
      col *= uGrade.x;
      col = (col - .5) * uGrade.y + .5;
      float lum = dot(col, vec3(.299, .587, .114));
      col = mix(vec3(lum), col, uGrade.z);
      return col * vec3(1.0 + uGrade.w * .06, 1.0, 1.0 - uGrade.w * .06);
    }`;
  /** @param {Record<string, any>} p */
  uniforms(p) { return { uGrade: [p.exposure, p.contrast, p.saturation, p.warmth] }; }
}

export class Vignette extends PostEffect {
  static type = "vignette";
  static order = 20;
  static doc = "Виньетка: эллипс, прозрачный в середине, к краям — цвет color.";
  static props = {
    amount: { type: "number", default: .24, min: 0, max: 1, doc: "Сила" },
    color: { type: "color", default: [6, 10, 26], doc: "Цвет края [r, g, b] (0…255) или \"#rrggbb\"" },
  };
  static glsl = /* glsl */`
    uniform float uVignetteAmount;
    uniform vec3 uVignetteColor;
    vec3 vignette(vec3 col, vec2 uv){
      vec2 e = (uv - vec2(.5, .54)) / vec2(.78, .72);
      float v = smoothstep(.58, 1.0, length(e));
      return mix(col, uVignetteColor, v * uVignetteAmount);
    }`;
  /** @param {Record<string, any>} p */
  uniforms(p) {
    const c = Array.isArray(p.color) ? p.color.map((/** @type {number} */ v) => v / 255) : this.stack.engine.palette.rgb(p.color);
    return { uVignetteAmount: p.amount, uVignetteColor: c };
  }
}

export class Posterize extends PostEffect {
  static type = "posterize";
  static order = 30;
  static doc = "Постеризация: уровней на канал (0 — выключено).";
  static props = { levels: { type: "number", default: 0, min: 0, doc: "Уровней на канал" } };
  static glsl = /* glsl */`
    uniform float uPosterize;
    vec3 posterize(vec3 col, vec2 uv){
      if (uPosterize > 1.0) col = floor(col * uPosterize + .5) / uPosterize;
      return col;
    }`;
  /** @param {Record<string, any>} p */
  uniforms(p) { return { uPosterize: p.levels }; }
}

export class Grain extends PostEffect {
  static type = "grain";
  static order = 900;
  static fps = 12;
  static doc = "Плёночное зерно. animated — зерно меняется ~12 раз в секунду (кадры сборки только пока эффект включён).";
  static props = {
    amount: { type: "number", default: 0, min: 0, doc: "Сила зерна (0 — нет)" },
    animated: { type: "boolean", default: false, doc: "Живое зерно (иначе неподвижное)" },
  };
  static glsl = /* glsl */`
    uniform vec2 uGrain;           // сила, зерно кадра
    vec3 grain(vec3 col, vec2 uv){
      vec2 f = gl_FragCoord.xy + uGrain.y;
      float n = hash12(f) + hash12(f + 17.31) - 1.0;
      return col + n * uGrain.x * .08;
    }`;
  get animated() { return !!this.props.animated && this.props.amount > 0; }
  /** @param {Record<string, any>} p */
  uniforms(p) { return { uGrain: [p.amount, p.animated ? Math.floor(Math.random() * 997) : 0] }; }
}

export class Dither extends PostEffect {
  static type = "dither";
  static order = 1000;
  static doc = "Дизеринг ±½ ступени 8 бит: плавные градиенты неба без полос. Всегда последний.";
  static props = { amount: { type: "number", default: 1, min: 0, doc: "Сила (1 — ±½ ступени)" } };
  static glsl = /* glsl */`
    uniform float uDither;
    vec3 dither(vec3 col, vec2 uv){
      vec2 f = gl_FragCoord.xy;
      float n = hash12(f) + hash12(f + 17.31) - 1.0;
      return col + n * (uDither / 255.0);
    }`;
  /** @param {Record<string, any>} p */
  uniforms(p) { return { uDither: p.amount }; }
}
