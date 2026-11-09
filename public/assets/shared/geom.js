// Многоугольники со скруглёнными углами — общий «язык» для плоского и перспективного вида.
// Скругления сразу разворачиваются в точки, чтобы перспективная проекция гнула их правильно.

const STEPS = 10;

export function arc(cx, cy, r, a0, a1, steps = STEPS) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * i / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** Скругляет вершины многоугольника: radii[i] — радиус i-й вершины (0 — острый угол). */
export function roundPoly(points, radii, steps = STEPS) {
  const out = [], n = points.length;
  for (let i = 0; i < n; i++) {
    const r = Array.isArray(radii) ? radii[i] || 0 : radii;
    const P = points[i], A = points[(i + n - 1) % n], B = points[(i + 1) % n];
    if (!r) { out.push(P); continue; }
    const la = Math.hypot(A[0] - P[0], A[1] - P[1]), lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const d1 = [(A[0] - P[0]) / la, (A[1] - P[1]) / la], d2 = [(B[0] - P[0]) / lb, (B[1] - P[1]) / lb];
    const cos = Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]));
    const theta = Math.acos(cos);
    if (theta < 1e-3 || Math.PI - theta < 1e-3) { out.push(P); continue; }
    let t = r / Math.tan(theta / 2);
    t = Math.min(t, la / 2, lb / 2);
    const rr = t * Math.tan(theta / 2);
    const T1 = [P[0] + d1[0] * t, P[1] + d1[1] * t], T2 = [P[0] + d2[0] * t, P[1] + d2[1] * t];
    const bis = [d1[0] + d2[0], d1[1] + d2[1]], bl = Math.hypot(...bis);
    const dist = rr / Math.sin(theta / 2);
    const C = [P[0] + bis[0] / bl * dist, P[1] + bis[1] / bl * dist];
    let a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(...arc(C[0], C[1], rr, a0, a0 + delta, steps));
  }
  return out;
}

export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const roundRect = (x0, y0, x1, y1, r, steps) => roundPoly(rect(x0, y0, x1, y1), r, steps);
export const stadium = (x0, y0, x1, y1, steps = 14) =>
  roundRect(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) / 2 - 1e-6, steps);

/** Путь SVG из точек, уже переведённых в экранные координаты. */
export function pathD(points, close = true) {
  if (!points.length) return "";
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`;
  return close ? d + "Z" : d;
}
