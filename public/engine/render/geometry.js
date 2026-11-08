// Строители геометрии — для моделей (assets/models/*.js) и встроенных компонентов. Всё — с плоскими гранями: у каждой грани своя нормаль и, значит, свой тон
// (cel-стиль). Мир в метрах: x — поперёк пути (вправо), y — вверх (0 — головка рельса),
// z — вдоль пути (−z — к горизонту, туда смотрит камера по умолчанию).
//
// Batch склеивает много мелких деталей одного материала в один меш (один вызов отрисовки):
//   const b = new Batch();
//   b.box([x0, x1], [y0, y1], [z0, z1], "post");           // коробка цвета из colors.js
//   b.add(geometry, "steel", matrix);                        // любая геометрия
//   group.add(b.mesh(material));                             // материал с vertexColors: true
import * as THREE from "three";
import { rgb } from "./palette.js";

/** Коробка по границам: [x0, x1], [y0, y1], [z0, z1]. */
export function boxGeometry([x0, x1], [y0, y1], [z0, z1]) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Плоские нормали: каждая грань — свой тон. */
export function flat(g) {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

/**
 * Вытягивание поперечного профиля вдоль z: profile — точки [x, y] (обход по кругу или открытая
 * линия), от z0 до z1. uv: u — доля длины, v — (y − vBase) / vScale. Возвращает плоскогранную геометрию.
 * closed — замкнуть профиль (последняя точка соединится с первой).
 */
export function extrude(profile, z0, z1, { closed = false, vBase = 0, vScale = 1, uFlip = false, center = null, uLength = null } = {}) {
  const pos = [], uv = [];
  const n = closed ? profile.length : profile.length - 1;
  for (let i = 0; i < n; i++) {
    const [xa, ya] = profile[i], [xb, yb] = profile[(i + 1) % profile.length];
    const q = [[xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]];
    const len = uLength ?? (z1 - z0);
    const u = z => (uFlip ? 1 - (z - Math.min(z0, z1)) / len : (z - Math.min(z0, z1)) / len);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...q[k]);
      uv.push(u(q[k][2]), (q[k][1] - vBase) / vScale);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return outward(g, center || [profile.reduce((s, p) => s + p[0], 0) / profile.length, profile.reduce((s, p) => s + p[1], 0) / profile.length]);
}

/** Разворачивает грани наружу от оси [cx, cy] (центр сечения). */
function outward(g, [cx, cy]) {
  const p = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    const mx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - cx, my = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - cy;
    if (nrm.getX(i) * mx + nrm.getY(i) * my < 0) flipTriangle(g, i);
  }
  g.computeVertexNormals();
  return g;
}

function flipTriangle(g, i) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name], s = a.itemSize;
    for (let k = 0; k < s; k++) {
      const t = a.array[(i + 1) * s + k];
      a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
      a.array[(i + 2) * s + k] = t;
    }
  }
}

/** Направить все грани геометрии в сторону normal (вектор). */
export function face(g, normal) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i += 3) {
    if (nrm.getX(i) * normal[0] + nrm.getY(i) * normal[1] + nrm.getZ(i) * normal[2] < 0) flipTriangle(g, i);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Лофт: поверхность через последовательные сечения одинаковой длины.
 * sections — [{ z, pts: [[x, y], ...] }]; nose: true — замкнуть последнее сечение плоской «крышкой».
 * Так строятся носовые части электропоездов и кабины локомотивов.
 */
export function loft(sections, { closed = false, capEnd = false, capStart = false, center = null } = {}) {
  const pos = [];
  const m = sections[0].pts.length;
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s], B = sections[s + 1];
    const n = closed ? m : m - 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % m;
      const a0 = [...A.pts[i], A.z], a1 = [...A.pts[j], A.z], b0 = [...B.pts[i], B.z], b1 = [...B.pts[j], B.z];
      pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const parts = [outwardLoft(g, sections, center)];
  if (capEnd) parts.push(cap(sections[sections.length - 1].pts, sections[sections.length - 1].z, Math.sign(sections.at(-1).z - sections[0].z)));
  if (capStart) parts.push(cap(sections[0].pts, sections[0].z, Math.sign(sections[0].z - sections.at(-1).z)));
  return parts.length > 1 ? merge(parts) : parts[0];
}

function outwardLoft(g, sections, center) {
  const cx = center ? center[0] : sections[0].pts.reduce((s, p) => s + p[0], 0) / sections[0].pts.length;
  const cy = center ? center[1] : sections[0].pts.reduce((s, p) => s + p[1], 0) / sections[0].pts.length;
  const p = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    const mx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - cx, my = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - cy;
    // нормаль должна смотреть от оси; для почти плоских торцевых граней — по направлению лофта
    const dot = nrm.getX(i) * mx + nrm.getY(i) * my;
    if (dot < 0) flipTriangle(g, i);
  }
  g.computeVertexNormals();
  return g;
}

/** Плоская крышка многоугольника pts ([x, y]) в плоскости z, нормалью по dir (±1 вдоль z). */
export function cap(pts, z, dir = 1) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = flat(new THREE.ShapeGeometry(shape));
  g.translate(0, 0, z);
  return face(g, [0, 0, dir]);
}

/**
 * Плоская стена с проёмами (борт вагона с окнами): outline и holes — точки [s, t] в плоскости стены,
 * place(s, t) → [x, y, z] в мире. normal — куда смотрит стена. uv(s, t) → [u, v] для текстуры.
 */
export function wall(outline, holes, place, normal, uvOf) {
  const shape = new THREE.Shape(outline.map(([s, t]) => new THREE.Vector2(s, t)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([s, t]) => new THREE.Vector2(s, t))));
  const g = new THREE.ShapeGeometry(shape).toNonIndexed();
  const p = g.attributes.position;
  const uv = [];
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i), t = p.getY(i);
    const w = place(s, t);
    p.setXYZ(i, w[0], w[1], w[2]);
    uv.push(...(uvOf ? uvOf(s, t) : [0, 0]));
  }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return face(g, normal);
}

/**
 * Откосы проёма: узкие грани по контуру отверстия от плоскости стены вглубь на depth.
 * outline — [s, t], place(s, t, inset) → [x, y, z].
 */
export function reveal(outline, place, depth) {
  const pos = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const a0 = place(a[0], a[1], 0), b0 = place(b[0], b[1], 0), a1 = place(a[0], a[1], depth), b1 = place(b[0], b[1], depth);
    pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Многоугольник ([s, t]) в плоскости стены → плоская геометрия с uv 0…1 по его рамке. */
export function panel(pts, place, normal) {
  const shape = new THREE.Shape(pts.map(([s, t]) => new THREE.Vector2(s, t)));
  const g = new THREE.ShapeGeometry(shape).toNonIndexed();
  const s0 = Math.min(...pts.map(p => p[0])), s1 = Math.max(...pts.map(p => p[0]));
  const t0 = Math.min(...pts.map(p => p[1])), t1 = Math.max(...pts.map(p => p[1]));
  const p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i), t = p.getY(i), w = place(s, t);
    uv.push((s - s0) / (s1 - s0 || 1), (t - t0) / (t1 - t0 || 1));
    p.setXYZ(i, w[0], w[1], w[2]);
  }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return face(g, normal);
}

/** Склейка геометрий в одну: позиции, нормали, uv, цвета (если есть хоть у одной — у всех). */
export function merge(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const hasColor = parts.some(g => g.attributes.color), hasUv = parts.some(g => g.attributes.uv);
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const uv = hasUv ? new Float32Array(total * 2) : null;
  const col = hasColor ? new Float32Array(total * 3).fill(1) : null;
  let at = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, at * 3);
    nrm.set(g.attributes.normal.array, at * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, at * 2);
    if (col && g.attributes.color) col.set(g.attributes.color.array, at * 3);
    at += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** Покрасить всю геометрию в один цвет (атрибут color). */
export function paint(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  const c = rgb(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Склейка мелких деталей с цветом у вершин — один меш, один вызов отрисовки. */
export class Batch {
  constructor() {
    this.parts = [];
  }

  /** Любая геометрия цвета color (имя или [r,g,b]); matrix — необязательное преобразование. */
  add(geometry, color, matrix = null) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    this.parts.push(paint(g, color));
    return this;
  }

  box(x, y, z, color) {
    return this.add(boxGeometry(x, y, z), color);
  }

  get empty() {
    return this.parts.length === 0;
  }

  geometry() {
    return merge(this.parts);
  }

  mesh(material) {
    const m = new THREE.Mesh(this.geometry(), material);
    return m;
  }
}

/** Матрица из положения, поворота (градусы, порядок YXZ) и масштаба. */
export function transform(position = [0, 0, 0], rotationDeg = [0, 0, 0], scale = 1) {
  const r = rotationDeg.map(a => a * Math.PI / 180);
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], "YXZ")),
    new THREE.Vector3(...s));
}

export { rng } from "../core/data.js";
