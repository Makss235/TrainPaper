// Математика пути: ось пути — прямые и дуги в горизонтальной плоскости (xz), высота y — линейно по длине.
// Чистая логика без three.js и DOM — проверяется `node --test` (track-math.test.js).
//
// Два способа задать путь (в осях объекта пути, метры):
//   points + radius — ломаная [[x, y, z], ...]; углы скругляются дугами радиуса radius
//                     (если прямых не хватает на такую дугу, радиус уменьшается);
//   segments        — явные участки от start по направлению heading (°, 0 — к −z, 90 — к −x):
//                     [{ "straight": 400 }, { "arc": { "radius": 800, "angle": 12 } }]  (angle > 0 — влево).
//
//   const path = buildPath({ points: [[0, 0, 60], [0, 0, -400], [-60, 0, -900]], radius: 800 });
//   path.length                 // м
//   path.pointAt(120)           // { position: [x, y, z], tangent: [tx, 0, tz] } — s в метрах от начала;
//                               // за концами путь продолжается прямой по касательной
//   path.project([x, y, z])     // { s, distance } — ближайшая точка оси
//   path.sample(2)              // точки оси через ~2 м на дугах (для модели пути)
// @ts-check

const DEG = Math.PI / 180;

/**
 * @typedef {object} Segment
 * @property {"line" | "arc"} kind
 * @property {number} s0        начало участка, м от начала пути
 * @property {number} length
 * @property {number[]} a       начало [x, z]
 * @property {number[]} b       конец [x, z]
 * @property {number[]} [dir]   прямая: направление [dx, dz]
 * @property {number[]} [center] дуга: центр [x, z]
 * @property {number} [radius]
 * @property {number} [angle0]  дуга: угол начала от центра, рад (atan2(z, x))
 * @property {number} [sweep]   дуга: угол поворота, рад (> 0 — против часовой в осях (x, z))
 */

/**
 * @typedef {object} PathSpec
 * @property {number[][]} [points]
 * @property {number} [radius]
 * @property {any[]} [segments]
 * @property {number[]} [start]
 * @property {number} [heading]
 */

/**
 * @typedef {object} TrackPath
 * @property {number} length
 * @property {Segment[]} segments
 * @property {(s: number) => {position: number[], tangent: number[]}} pointAt
 * @property {(p: number[]) => {s: number, distance: number}} project
 * @property {(step?: number) => number[][]} sample
 */

/** @param {number[]} v */
const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/**
 * Путь из описания (points + radius или segments).
 * @param {PathSpec} spec
 * @returns {TrackPath}
 */
export function buildPath(spec) {
  /** @type {Segment[]} */
  let segs;
  /** @type {[number, number][]} опорные высоты: [s, y] */
  let heights;
  if (spec.segments?.length) ({ segs, heights } = fromSegments(spec.segments, spec.start || [0, 0, 0], spec.heading ?? 0));
  else ({ segs, heights } = fromPoints(spec.points?.length ? spec.points : [[0, 0, 0], [0, 0, -100]], spec.radius ?? 0));
  const length = segs.reduce((t, g) => t + g.length, 0);
  const yAt = (/** @type {number} */ s) => {
    if (heights.length === 1 || s <= heights[0][0]) return heights[0][1];
    for (let i = 1; i < heights.length; i++) {
      const [s1, y1] = heights[i], [s0, y0] = heights[i - 1];
      if (s <= s1) return s1 === s0 ? y1 : y0 + (y1 - y0) * (s - s0) / (s1 - s0);
    }
    return heights[heights.length - 1][1];
  };

  /** @param {number} s */
  function pointAt(s) {
    const first = segs[0], last = segs[segs.length - 1];
    if (s < 0) {                                              // до начала — прямая назад по касательной
      const t = tangentOf(first, 0);
      return { position: [first.a[0] + t[0] * s, yAt(0), first.a[1] + t[1] * s], tangent: [t[0], 0, t[1]] };
    }
    if (s > length) {
      const t = tangentOf(last, last.length), d = s - length;
      return { position: [last.b[0] + t[0] * d, yAt(length), last.b[1] + t[1] * d], tangent: [t[0], 0, t[1]] };
    }
    const g = segmentAt(segs, s), u = s - g.s0;
    const [x, z] = positionOf(g, u), t = tangentOf(g, u);
    return { position: [x, yAt(s), z], tangent: [t[0], 0, t[1]] };
  }

  /** @param {number[]} p */
  function project(p) {
    let best = { s: 0, distance: Infinity };
    for (const g of segs) {
      const u = closestOn(g, [p[0], p[2]]);
      const [x, z] = positionOf(g, u);
      const d = Math.hypot(x - p[0], z - p[2]);
      if (d < best.distance) best = { s: g.s0 + u, distance: d };
    }
    return best;
  }

  /** @param {number} [step] */
  function sample(step = 2) {
    /** @type {number[][]} */
    const out = [];
    for (const g of segs) {
      const n = g.kind === "line" ? 1 : Math.max(2, Math.ceil(g.length / step));
      for (let i = out.length ? 1 : 0; i <= n; i++) {
        const u = g.length * i / n, [x, z] = positionOf(g, u);
        out.push([round(x), round(yAt(g.s0 + u)), round(z)]);
      }
    }
    return out;
  }

  return { length, segments: segs, pointAt, project, sample };
}

const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** @param {Segment[]} segs @param {number} s */
function segmentAt(segs, s) {
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].s0 <= s) lo = mid; else hi = mid - 1;
  }
  return segs[lo];
}

/** @param {Segment} g @param {number} u */
function positionOf(g, u) {
  if (g.kind === "line") return [g.a[0] + /** @type {number[]} */ (g.dir)[0] * u, g.a[1] + /** @type {number[]} */ (g.dir)[1] * u];
  const R = /** @type {number} */ (g.radius), c = /** @type {number[]} */ (g.center), sweep = /** @type {number} */ (g.sweep);
  const ang = /** @type {number} */ (g.angle0) + Math.sign(sweep) * u / R;
  return [c[0] + R * Math.cos(ang), c[1] + R * Math.sin(ang)];
}

/** @param {Segment} g @param {number} u */
function tangentOf(g, u) {
  if (g.kind === "line") return /** @type {number[]} */ (g.dir);
  const R = /** @type {number} */ (g.radius), sweep = /** @type {number} */ (g.sweep);
  const ang = /** @type {number} */ (g.angle0) + Math.sign(sweep) * u / R;
  const k = Math.sign(sweep);
  return [-Math.sin(ang) * k, Math.cos(ang) * k];
}

/** Ближайшее u на участке к точке p [x, z]. @param {Segment} g @param {number[]} p */
function closestOn(g, p) {
  if (g.kind === "line") {
    const d = /** @type {number[]} */ (g.dir);
    return Math.max(0, Math.min(g.length, (p[0] - g.a[0]) * d[0] + (p[1] - g.a[1]) * d[1]));
  }
  const c = /** @type {number[]} */ (g.center), R = /** @type {number} */ (g.radius), sweep = /** @type {number} */ (g.sweep);
  let ang = Math.atan2(p[1] - c[1], p[0] - c[0]) - /** @type {number} */ (g.angle0);
  ang *= Math.sign(sweep);
  ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const total = Math.abs(sweep);
  if (ang > total) ang = ang - total > 2 * Math.PI - ang ? 0 : total;   // за пределами дуги — ближний конец
  return Math.max(0, Math.min(g.length, ang * R));
}

/** @param {number[]} a @param {number[]} b @param {number} s0 @returns {Segment} */
function line(a, b, s0) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { kind: "line", s0, length, a, b, dir: norm2([b[0] - a[0], b[1] - a[1]]) };
}

/**
 * Дуга от точки a с направлением dir, радиус R, поворот sigma (рад) в математическом смысле на плоскости (x, z):
 * sigma > 0 — против часовой в осях (x, z). Сверху (y вверх, −z вперёд) это поворот ВПРАВО.
 * @param {number[]} a @param {number[]} dir @param {number} R @param {number} sigma @param {number} s0 @returns {Segment}
 */
function arc(a, dir, R, sigma, s0) {
  const k = Math.sign(sigma) || 1;
  const n = k > 0 ? [-dir[1], dir[0]] : [dir[1], -dir[0]];          // к центру
  const center = [a[0] + n[0] * R, a[1] + n[1] * R];
  const angle0 = Math.atan2(a[1] - center[1], a[0] - center[0]);
  /** @type {Segment} */
  const g = { kind: "arc", s0, length: Math.abs(sigma) * R, a, b: [0, 0], center, radius: R, angle0, sweep: sigma };
  g.b = positionOf(g, g.length);
  return g;
}

/** @param {number[][]} points @param {number} radius */
function fromPoints(points, radius) {
  const P = points.map(p => [p[0], p[2]]);
  /** @type {Segment[]} */
  const segs = [];
  /** @type {[number, number][]} */
  const heights = [];
  let s = 0, cur = P[0];
  heights.push([0, points[0][1] ?? 0]);
  for (let i = 1; i < P.length; i++) {
    const last = i === P.length - 1;
    const p = P[i];
    if (last || !radius) {
      const g = line(cur, p, s);
      if (g.length > 1e-9) { segs.push(g); s += g.length; }
      cur = p;
      heights.push([s, points[i][1] ?? 0]);
      continue;
    }
    // скругление угла в p между cur→p и p→next
    const next = P[i + 1];
    const d1 = norm2([p[0] - cur[0], p[1] - cur[1]]), d2 = norm2([next[0] - p[0], next[1] - p[1]]);
    const cross = d1[0] * d2[1] - d1[1] * d2[0], dot = d1[0] * d2[0] + d1[1] * d2[1];
    const theta = Math.atan2(Math.abs(cross), dot);
    if (theta < 1e-6) { heights.push([s + Math.hypot(p[0] - cur[0], p[1] - cur[1]), points[i][1] ?? 0]); continue; }
    const len1 = Math.hypot(p[0] - cur[0], p[1] - cur[1]), len2 = Math.hypot(next[0] - p[0], next[1] - p[1]) / (i + 1 === P.length - 1 ? 1 : 2);
    let R = radius, t = R * Math.tan(theta / 2);
    const tMax = Math.min(len1, len2);
    if (t > tMax) { t = tMax; R = t / Math.tan(theta / 2); }
    const t1 = [p[0] - d1[0] * t, p[1] - d1[1] * t];
    const g = line(cur, t1, s);
    if (g.length > 1e-9) { segs.push(g); s += g.length; }
    // cross > 0 — поворот против часовой в осях (x, z)
    const a = arc(t1, d1, R, cross > 0 ? theta : -theta, s);
    segs.push(a);
    heights.push([s + a.length / 2, points[i][1] ?? 0]);
    s += a.length;
    cur = a.b;
  }
  if (!segs.length) segs.push(line(P[0], [P[0][0], P[0][1] - 1], 0));
  return { segs, heights };
}

/** @param {any[]} list @param {number[]} start @param {number} heading */
function fromSegments(list, start, heading) {
  /** @type {Segment[]} */
  const segs = [];
  let s = 0, cur = [start[0], start[2]];
  // heading 0 — к −z, 90 — к −x (поворот влево)
  let dir = [-Math.sin(heading * DEG), -Math.cos(heading * DEG)];
  for (const item of list) {
    if (item.straight != null) {
      const b = [cur[0] + dir[0] * item.straight, cur[1] + dir[1] * item.straight];
      const g = line(cur, b, s);
      segs.push(g);
      s += g.length;
      cur = b;
    } else if (item.arc) {
      // angle > 0 — влево при взгляде сверху: в осях (x, z) это поворот по часовой
      const g = arc(cur, dir, item.arc.radius ?? 500, -(item.arc.angle ?? 0) * DEG, s);
      segs.push(g);
      s += g.length;
      cur = g.b;
      dir = tangentOf(g, g.length);
    }
  }
  if (!segs.length) segs.push(line(cur, [cur[0] + dir[0], cur[1] + dir[1]], 0));
  /** @type {[number, number][]} */
  const heights = [[0, start[1] ?? 0]];
  return { segs, heights };
}
