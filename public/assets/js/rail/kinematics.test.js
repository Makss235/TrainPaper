// Тесты кинематики поезда: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { advance, approachSpeed, brakingDistance, travelTime } from "./kinematics.js";

const limits = { vmax: 25, accel: .5, brake: 1 };

test("остановка точно у отметки, без перелёта, скорость 0", () => {
  for (const [d, v0] of [[300, 20], [37.3, 5], [1000, 25], [0.4, 0], [150, 0]]) {
    const st = { traveled: 0, v: v0, arrived: false };
    let t = 0, maxSeen = 0;
    while (!st.arrived && t < 600) { advance(st, 1 / 60, { ...limits, stopAt: d }); t += 1 / 60; maxSeen = Math.max(maxSeen, st.traveled); }
    assert.equal(st.arrived, true, `d=${d}`);
    assert.ok(Math.abs(st.traveled - d) < 1e-9 && maxSeen <= d + 1e-9, `d=${d}: ${st.traveled}`);
    assert.equal(st.v, 0);
  }
});

test("ускорение и торможение не превышают пределов", () => {
  const st = { traveled: 0, v: 0, arrived: false };
  let prev = 0;
  for (let i = 0; i < 6000 && !st.arrived; i++) {
    advance(st, .05, { ...limits, stopAt: 800 });
    const a = (st.v - prev) / .05;
    assert.ok(a <= limits.accel + 1e-6, `разгон ${a}`);
    // у самой отметки поезд «доползает» — там торможение до нуля может быть резче лишь на долю м/с
    if (800 - st.traveled > 1) assert.ok(a >= -limits.brake - 1e-6, `торможение ${a}`);
    assert.ok(st.v <= limits.vmax + 1e-9);
    prev = st.v;
  }
  assert.equal(st.arrived, true);
});

test("большой шаг (ускорение часов ×1440) даёт тот же результат, что мелкие", () => {
  const a = { traveled: 0, v: 22, arrived: false }, b = { traveled: 0, v: 22, arrived: false };
  advance(a, 25, { ...limits, stopAt: 400 });
  for (let i = 0; i < 1500; i++) advance(b, 1 / 60, { ...limits, stopAt: 400 });
  assert.ok(Math.abs(a.traveled - b.traveled) < .5, `${a.traveled} vs ${b.traveled}`);
});

test("без остановки — разгон до целевой скорости", () => {
  const st = { traveled: 0, v: 0, arrived: false };
  advance(st, 100, { ...limits, stopAt: null, target: 15 });
  assert.ok(Math.abs(st.v - 15) < 1e-9);
});

test("travelTime совпадает с движением", () => {
  const d = 320, v0 = approachSpeed(d, 25, 1);
  const T = travelTime(d, v0, limits);
  const st = { traveled: 0, v: v0, arrived: false };
  let t = 0;
  while (!st.arrived) { advance(st, 1 / 60, { ...limits, stopAt: d }); t += 1 / 60; }
  assert.ok(Math.abs(T - t) < .5, `${T} vs ${t}`);
  assert.ok(Math.abs(travelTime(200, 20, { ...limits, target: 20, stop: false }) - 10) < .2);
});

test("тормозной путь и скорость подхода", () => {
  assert.equal(brakingDistance(20, 1), 200);
  assert.equal(approachSpeed(200, 25, 1), 20);
  assert.equal(approachSpeed(1000, 25, 1), 25);
});
