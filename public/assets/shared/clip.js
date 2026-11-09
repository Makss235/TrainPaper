// Геометрия теней: выпуклая оболочка проекций и обрезка многоугольника полосой по одной из осей.

export const box = (x0, x1, y0, y1, z0, z1) =>
  [x0, x1].flatMap(x => [y0, y1].flatMap(y => [z0, z1].map(z => [x, y, z])));

/** Выпуклая оболочка точек на плоскости (монотонная цепь Эндрю), против часовой стрелки. */
export function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Обрезка многоугольника полосой min ≤ p[axis] ≤ max (Сазерленд — Ходжмен). */
export function clipAxis(poly, axis, min, max) {
  let out = poly;
  for (const [limit, keep] of [[min, v => v >= min], [max, v => v <= max]]) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      if (keep(a[axis])) out.push(a);
      if (keep(a[axis]) !== keep(b[axis])) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        out.push(a.map((v, k) => (k === axis ? limit : v + (b[k] - v) * t)));
      }
    }
  }
  return out;
}
