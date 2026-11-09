// Тесты update(dt), sleep/wake, tween и таймеров компонентов: node --test (three — из vendor, см. tools/test-setup.js)
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { fakeEngine } from "../../../tools/fake-engine.js";
import { Component } from "./component.js";
import { CancelledError } from "./time.js";

class Blinker extends Component {
  static type = "TestBlinker";
  static fps = 4;
  calls = 0;
  /** @type {number | undefined} */
  t = undefined;
  /** @param {number} dt */
  update(dt) { this.calls++; this.t = (this.t ?? 0) + dt; this.object3D.visible = this.t % 1 < .5; }
}

class Still extends Component {
  static type = "TestStill";
}

test("без компонентов с update — ни одного кадра в простое", () => {
  const f = fakeEngine();
  f.object("Столб").addComponent(Still);
  f.advance(4000);
  assert.equal(f.stats.frames, 0);
  assert.equal(f.loop.anims.size, 0);
});

test("Blinker со static fps = 4 — ровно 4 вызова в секунду; после sleep() — снова 0 кадров", () => {
  const f = fakeEngine();
  const b = f.object("Мигалка").addComponent(Blinker);
  f.advance(1000);
  const first = b.calls;
  f.advance(1000);
  assert.equal(b.calls - first, 4);
  b.sleep();
  const frames = f.stats.frames;
  f.advance(4000);
  assert.equal(f.stats.frames, frames);
  b.wake();
  f.advance(1000);
  assert.ok(b.calls > first + 4);
});

test("dt — секунды симуляции: при scale 10 за секунду набегает ~10 с; на паузе update не вызывается", () => {
  const f = fakeEngine();
  const b = f.object("М").addComponent(Blinker);
  f.time.scale = 10;
  f.advance(2000);
  const t0 = b.t ?? 0;
  f.advance(1000);
  assert.ok(Math.abs((b.t ?? 0) - t0 - 10) < .6, `набежало ${(b.t ?? 0) - t0}`);
  f.time.pause();
  const calls = b.calls;
  f.advance(2000);
  assert.equal(b.calls, calls);
  assert.equal(f.loop.anims.size, 0);              // на паузе цикл спит
});

test("выключенный объект и выключенный компонент — update спит; включили — проснулся", () => {
  const f = fakeEngine();
  const parent = f.object("Родитель");
  const b = f.object("М", parent).addComponent(Blinker);
  parent.setActive(false);
  assert.equal(b.awakeNow, false);
  parent.setActive(true);
  assert.equal(b.awakeNow, true);
  b.enabled = false;
  assert.equal(b.awakeNow, false);
  b.enabled = true;
  assert.equal(b.awakeNow, true);
  b.gameObject.destroy();
  assert.equal(b.awakeNow, false);
  assert.equal(f.loop.anims.size, 0);
});

test("таймеры компонента по часам симуляции; destroy снимает их, wait отклоняется CancelledError", async () => {
  const f = fakeEngine();
  const c = f.object("Скрипт").addComponent(Still);
  let n = 0;
  c.every(60, () => n++);
  f.time.scale = 1440;
  f.advance(1010);                                   // 1440 с симуляции = 24 минуты
  assert.equal(n, 24);
  const p = c.wait(3600);
  c.gameObject.destroy();
  await assert.rejects(p, (/** @type {any} */ e) => e instanceof CancelledError);
  f.advance(5000);
  assert.equal(n, 24);
  assert.equal(f.time.pending, 0);
});

test("в простое с таймером через 10 минут нет ни одного кадра до срабатывания", () => {
  const f = fakeEngine();
  const c = f.object("Скрипт").addComponent(Still);
  let fired = false;
  c.after(600, () => { fired = true; });
  f.advance(599000);
  assert.equal(f.stats.frames, 0);
  assert.equal(fired, false);
  f.advance(2000);
  assert.equal(fired, true);
});

test("async start с корутиной: работает по часам и тихо останавливается при destroy", async () => {
  const f = fakeEngine();
  /** @type {number[]} */
  const log = [];
  class Co extends Component {
    static type = "TestCo";
    async start() { for (;;) { await this.wait(10); log.push(this.time.ms); } }
  }
  const c = f.object("К").addComponent(Co);
  for (let i = 0; i < 3; i++) { f.advance(10005); await new Promise(r => setTimeout(r, 0)); }
  assert.equal(log.length, 3);
  const err = console.error;
  /** @type {any[]} */
  const errors = [];
  console.error = (...a) => errors.push(a);
  c.gameObject.destroy();
  await new Promise(r => setTimeout(r, 0));
  console.error = err;
  assert.equal(errors.length, 0);
});

test("tween: значение доходит до конца, промис выполняется, кадры только пока идёт", async () => {
  const f = fakeEngine();
  const c = f.object("Т").addComponent(Still);
  /** @type {number[]} */
  const values = [];
  const p = c.tween({ from: 0, to: 10, duration: 1, ease: "linear", onUpdate: v => values.push(v) });
  f.advance(1200);
  await p;
  assert.equal(values.at(-1), 10);
  assert.ok(values.length > 30);
  const frames = f.stats.frames;
  f.advance(2000);
  assert.equal(f.stats.frames, frames);
});

test("tween массивов и отмена вместе с компонентом", async () => {
  const f = fakeEngine();
  const c = f.object("Т").addComponent(Still);
  /** @type {any} */
  let last = null;
  const p = c.tween({ from: [0, 0], to: [2, 4], duration: 2, onUpdate: v => { last = v; } });
  f.advance(1000);
  assert.ok(last[0] > 0 && last[0] < 2 && Math.abs(last[1] - 2 * last[0]) < 1e-9);
  c.gameObject.destroy();
  await assert.rejects(p, (/** @type {any} */ e) => e instanceof CancelledError);
  assert.equal(f.loop.anims.size, 0);
});
