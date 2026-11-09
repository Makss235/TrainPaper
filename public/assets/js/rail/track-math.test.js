// Тесты математики пути: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { buildPath } from "./track-math.js";

const close = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("прямая: длина, точки и касательная", () => {
  const p = buildPath({ points: [[0, 0, 60], [0, 0, -400]] });
  close(p.length, 460);
  const { position, tangent } = p.pointAt(60);
  assert.deepEqual(position.map(v => Math.round(v * 1e6) / 1e6), [0, 0, 0]);
  assert.deepEqual(tangent.map(v => Math.round(v * 1e6) / 1e6), [0, 0, -1]);
});

test("за концами путь продолжается прямой", () => {
  const p = buildPath({ points: [[0, 0, 0], [0, 0, -100]] });
  close(p.pointAt(-20).position[2], 20);
  close(p.pointAt(130).position[2], -130);
});

test("скругление угла: длина дуги и прямых, касательные на стыках непрерывны", () => {
  const R = 800;
  const p = buildPath({ points: [[0, 0, 60], [0, 0, -400], [-60, 0, -900]], radius: R });
  const arcSeg = p.segments.find(g => g.kind === "arc");
  assert.ok(arcSeg);
  const theta = Math.atan2(60, 500);                       // угол поворота
  close(/** @type {any} */ (arcSeg).length, R * theta, 1e-6);
  // непрерывность положения и касательной на каждом стыке
  for (const g of p.segments.slice(1)) {
    const a = p.pointAt(g.s0 - 1e-6), b = p.pointAt(g.s0 + 1e-6);
    for (let i = 0; i < 3; i++) close(a.position[i], b.position[i], 1e-4);
    for (let i = 0; i < 3; i++) close(a.tangent[i], b.tangent[i], 1e-4);
  }
  // конец пути — последняя точка
  const end = p.pointAt(p.length).position;
  close(end[0], -60, 1e-6);
  close(end[2], -900, 1e-6);
});

test("поворот влево (к −x при движении к −z): касательная после дуги смотрит к −x", () => {
  const p = buildPath({ points: [[0, 0, 0], [0, 0, -300], [-100, 0, -600]], radius: 500 });
  const t = p.pointAt(p.length - 1).tangent;
  assert.ok(t[0] < 0 && t[2] < 0);
});

test("явные сегменты: прямая + дуга 90° влево радиусом 100", () => {
  const p = buildPath({ segments: [{ straight: 50 }, { arc: { radius: 100, angle: 90 } }, { straight: 10 }] });
  close(p.length, 50 + Math.PI * 50 + 10, 1e-6);
  const afterArc = p.pointAt(50 + Math.PI * 50);
  close(afterArc.position[0], -100, 1e-6);                 // влево — к −x
  close(afterArc.position[2], -150, 1e-6);
  close(afterArc.tangent[0], -1, 1e-6);
  const mid = p.pointAt(50 + Math.PI * 25).position;       // середина дуги — на радиусе от центра
  close(Math.hypot(mid[0] - -100, mid[2] - -50), 100, 1e-6);
});

test("project: ближайшая точка оси и расстояние", () => {
  const p = buildPath({ points: [[0, 0, 0], [0, 0, -300], [-100, 0, -600]], radius: 500 });
  const s = 137.5, q = p.pointAt(s).position;
  const r = p.project([q[0] + 2, 0, q[2]]);
  close(r.s, s, .05);
  close(r.distance, 2, .05);
  const s2 = p.segments[1].s0 + 20, q2 = p.pointAt(s2).position;       // на дуге
  close(p.project(q2).s, s2, 1e-3);
});

test("высота линейно по длине между точками", () => {
  const p = buildPath({ points: [[0, 0, 0], [0, 10, -100]] });
  close(p.pointAt(50).position[1], 5);
});

test("sample: на прямой — концы, на дуге — шаг", () => {
  const p = buildPath({ points: [[0, 0, 60], [0, 0, -400], [-60, 0, -900]], radius: 800 });
  const pts = p.sample(2);
  assert.ok(pts.length > 20);
  close(pts[0][2], 60);
  close(pts.at(-1)?.[0] ?? 0, -60, 1e-3);
});
