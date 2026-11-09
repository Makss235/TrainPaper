// Кривые плавности для tween(): t — доля времени 0…1 → доля пути 0…1.
//   this.tween({ from: 0, to: 1, duration: 2, ease: "inOutCubic", onUpdate: v => … })
// @ts-check

/** @type {Record<string, (t: number) => number>} */
export const EASING = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  smoothstep: t => t * t * (3 - 2 * t),
};

/**
 * Кривая по имени или функции (неизвестное имя — linear с предупреждением).
 * @param {string | ((t: number) => number) | undefined} ease
 * @returns {(t: number) => number}
 */
export function easing(ease) {
  if (typeof ease === "function") return ease;
  if (!ease) return EASING.smoothstep;
  const f = EASING[ease];
  if (!f) console.warn(`Нет кривой «${ease}». Есть: ${Object.keys(EASING).join(", ")}`);
  return f || EASING.linear;
}
