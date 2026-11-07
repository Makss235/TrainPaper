// Камера и рисование в перспективе на canvas 2D. Мир в метрах: y — вверх (0 — головка рельса),
// камера смотрит вдоль −z. Повороты совпадают с камерой three.js (порядок YXZ), поэтому
// сцена и WebGL-небо под ней всегда сходятся.
import { clamp } from "../lib/color.js";

export const NEAR = .25;

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class View {
  constructor() {
    this.pos = [0, 2.75, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.f = 1000; this.cx = 0; this.cy = 0; this.W = 0; this.H = 0;
    this.light = { L: [0, 1, 0], amb: [1, 1, 1], sun: [0, 0, 0], fog: [200, 210, 220], fogNear: 90, fogFar: 1600, fogMax: .92 };
    this.update();
  }

  update() {
    this.c1 = Math.cos(this.yaw); this.s1 = Math.sin(this.yaw);
    this.c2 = Math.cos(this.pitch); this.s2 = Math.sin(this.pitch);
  }

  /** Мир → пространство камеры (вперёд — −z). */
  cam(p) {
    const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
    const x1 = dx * this.c1 - dz * this.s1, z1 = dx * this.s1 + dz * this.c1;
    return [x1, dy * this.c2 + z1 * this.s2, -dy * this.s2 + z1 * this.c2];
  }

  proj(c) {
    const k = this.f / -c[2];
    return [this.cx + c[0] * k, this.cy - c[1] * k];
  }

  /** Точка мира на экране или null, если за спиной. */
  screen(p) {
    const c = this.cam(p);
    return c[2] < -NEAR ? this.proj(c) : null;
  }

  dist(p) {
    return Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]);
  }

  /** Многоугольник мира → точки экрана (отсечён ближней плоскостью) или null. */
  polyScreen(pts) {
    const out = [];
    let prev = this.cam(pts[pts.length - 1]);
    for (let i = 0; i < pts.length; i++) {
      const cur = this.cam(pts[i]);
      const inP = prev[2] <= -NEAR, inC = cur[2] <= -NEAR;
      if (inP !== inC) {
        const t = (-NEAR - prev[2]) / (cur[2] - prev[2]);
        out.push(this.proj([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t, -NEAR]));
      }
      if (inC) out.push(this.proj(cur));
      prev = cur;
    }
    return out.length > 2 ? out : null;
  }

  path(ctx, pts) {
    const s = this.polyScreen(pts);
    if (!s) return false;
    ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
    ctx.closePath();
    return true;
  }

  fill(ctx, pts, style) {
    ctx.beginPath();
    if (!this.path(ctx, pts)) return;
    ctx.fillStyle = style;
    ctx.fill();
  }

  /** Отрезок мира в путь (с отсечением). */
  seg(ctx, a, b) {
    let ca = this.cam(a), cb = this.cam(b);
    const ia = ca[2] <= -NEAR, ib = cb[2] <= -NEAR;
    if (!ia && !ib) return;
    if (!ia || !ib) {
      const t = (-NEAR - ca[2]) / (cb[2] - ca[2]);
      const m = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, -NEAR];
      if (!ia) ca = m; else cb = m;
    }
    const p = this.proj(ca), q = this.proj(cb);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }

  polyline(ctx, pts) {
    for (let i = 1; i < pts.length; i++) this.seg(ctx, pts[i - 1], pts[i]);
  }

  /** Видна ли грань с нормалью n, проходящая через точку p. */
  faces(n, p) {
    return n[0] * (this.pos[0] - p[0]) + n[1] * (this.pos[1] - p[1]) + n[2] * (this.pos[2] - p[2]) > 0;
  }

  /** Освещённость грани с нормалью n: множитель по каналам (cel: одна грань — один тон). */
  lightK(n, extra = 0) {
    const { L, amb, sun } = this.light;
    const d = n ? Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) : .5;
    return [0, 1, 2].map(i => {
      const k = amb[i] + sun[i] * d + extra;
      return k < 1 ? k : 1 + (k - 1) * .3;          // мягкий потолок: светлые грани не выгорают
    });
  }

  /** Цвет грани: материал × свет, затем дымка по расстоянию. */
  shade(base, n, at, { extra = 0, haze = 1 } = {}) {
    const k = this.lightK(n, extra);
    return this.fogged([base[0] * k[0], base[1] * k[1], base[2] * k[2]], at, haze);
  }

  fogged(c, at, haze = 1) {
    const { fog, fogNear, fogFar, fogMax } = this.light;
    const t = at ? smooth(fogNear, fogFar, this.dist(at)) * fogMax * haze : 0;
    return `rgb(${Math.round(Math.min(255, c[0] + (fog[0] - c[0]) * t))},${Math.round(Math.min(255, c[1] + (fog[1] - c[1]) * t))},${Math.round(Math.min(255, c[2] + (fog[2] - c[2]) * t))})`;
  }

  /** Коробка: рисует видимые грани, каждая — своим тоном. */
  box(ctx, base, [x0, x1], [y0, y1], [z0, z1], opts) {
    const faces = [
      [[-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]],
      [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
      [[0, -1, 0], [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]]],
      [[0, 0, 1], [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]]],
      [[0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]],
    ];
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    for (const [n, pts] of faces) {
      if (this.faces(n, pts[0])) this.fill(ctx, pts, this.shade(base, n, mid, opts));
    }
  }
}

export const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/** Границы участков по глубине: длинные полосы режем, чтобы дымка нарастала к горизонту. */
export const DEPTHS = [4, -2, -6, -12, -22, -40, -70, -120, -200, -340, -560, -900, -1500];

/**
 * Слой теней: тени собираются в отдельном холсте одним цветом (без двойного затемнения
 * в местах наложения), затем ложатся на сцену умножением с лёгким размытием края.
 */
export class ShadowLayer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
  }

  /** Слой считается в половинном разрешении: растягивание при наложении само смягчает край тени. */
  resize(w, h, dpr) {
    this.scale = Math.max(.5, dpr * .5);
    this.canvas.width = Math.round(w * this.scale);
    this.canvas.height = Math.round(h * this.scale);
    this.dpr = this.scale;
    this.w = w; this.h = h;
  }

  begin() {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return g;
  }

  /** Накладывает слой: color — во сколько раз темнеет освещённая поверхность в тени (0…1 по каналам). */
  apply(ctx, color) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = `rgb(${color.map(v => Math.round(clamp(v) * 255))})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(this.canvas, 0, 0, this.w, this.h);
    ctx.restore();
  }
}

/** Выпуклая оболочка точек плоскости. */
export function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Обрезка многоугольника полосой min ≤ p[axis] ≤ max. */
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

export const corners = (x0, x1, y0, y1, z0, z1) =>
  [x0, x1].flatMap(x => [y0, y1].flatMap(y => [z0, z1].map(z => [x, y, z])));
