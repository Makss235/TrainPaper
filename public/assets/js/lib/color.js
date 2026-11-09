// @ts-check
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const mul = (c, k) => c.map((v, i) => v * (Array.isArray(k) ? k[i] : k));
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const rgb = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 255)))})`;
export const rgba = (c, a = 1) => `rgba(${c.map(v => Math.round(clamp(v, 0, 255)))},${a})`;

/** Цвет материала при освещении: дневной цвет × окружающий свет, плюс «дымка» к цвету горизонта. */
export function lit(base, env, haze = 0) {
  const c = typeof base === "string" ? hex(base) : base;
  const shaded = mul(c, env.ambient);
  return haze ? mix(shaded, env.horizon, haze * env.hazeAmount) : shaded;
}
