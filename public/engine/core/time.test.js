// Тесты часов симуляции и таймеров: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { CancelledError, SimClock } from "./time.js";

/** Часы с поддельным реальным временем и поддельным setTimeout: advance(мс) — «прошло» реальное время. */
function fakeClock(start = Date.UTC(2026, 10, 8, 11, 0)) {
  let real = 0;
  /** @type {{fn: () => void, at: number, id: number} | null} */
  let pending = null;
  let id = 0, armed = 0;
  const clock = new SimClock({
    start, realNow: () => real,
    setTimer: (fn, ms) => { armed++; pending = { fn, at: real + ms, id: ++id }; return id; },
    clearTimer: h => { if (pending?.id === h) pending = null; },
  });
  clock.utcOffset = 180;
  /** @param {number} ms */
  const advance = ms => {
    const end = real + ms;
    while (pending && pending.at <= end) { real = pending.at; const p = pending; pending = null; p.fn(); }
    real = end;
  };
  return { clock, advance, armed: () => armed, pending: () => pending };
}

test("скорость: при scale 1440 минута реального времени — сутки симуляции", () => {
  const { clock, advance } = fakeClock();
  const t0 = clock.ms;
  clock.scale = 1440;
  advance(60000);
  assert.equal(clock.ms - t0, 86400000);
});

test("пауза: время стоит, после resume идёт дальше без скачка", () => {
  const { clock, advance } = fakeClock();
  advance(1000);
  const t1 = clock.ms;
  clock.pause();
  advance(5000);
  assert.equal(clock.ms, t1);
  clock.resume();
  advance(2000);
  assert.equal(clock.ms, t1 + 2000);
});

test("set во время ускорения: новый момент, ускорение сохраняется", () => {
  const { clock, advance } = fakeClock();
  clock.scale = 60;
  advance(1000);
  const target = Date.UTC(2026, 10, 8, 2, 30);
  clock.set(new Date(target));
  assert.equal(clock.ms, target);
  advance(1000);
  assert.equal(clock.ms, target + 60000);
  assert.equal(clock.scale, 60);
});

test("монотонность: при смене scale и паузах время не идёт назад", () => {
  const { clock, advance } = fakeClock();
  let prev = clock.ms;
  for (const k of [1, 10, 0.5, 1440, 3, 0, 7]) {
    clock.scale = k;
    advance(137);
    if (k === 3) clock.pause();
    if (k === 0) clock.resume();
    assert.ok(clock.ms >= prev);
    prev = clock.ms;
  }
});

test("событие timeChanged при set, scale, pause, resume", () => {
  const { clock } = fakeClock();
  /** @type {string[]} */
  const reasons = [];
  clock.on("timeChanged", (/** @type {any} */ e) => reasons.push(e.reason));
  clock.set(Date.UTC(2026, 0, 1));
  clock.scale = 2;
  clock.scale = 2;                  // без изменения — без события
  clock.pause();
  clock.resume();
  assert.deepEqual(reasons, ["set", "scale", "pause", "resume"]);
});

test("таймеры: порядок срабатывания по времени, при равном — по постановке", () => {
  const { clock, advance } = fakeClock();
  /** @type {string[]} */
  const log = [];
  clock.after(3, () => log.push("c"));
  clock.after(1, () => log.push("a"));
  clock.after(1, () => log.push("b"));
  clock.after(2, () => log.push("x"));
  advance(10000);
  assert.deepEqual(log, ["a", "b", "x", "c"]);
});

test("таймеры: при ускорении ×1440 десять минут симуляции проходят за ~0,42 с", () => {
  const { clock, advance } = fakeClock();
  clock.scale = 1440;
  let fired = false;
  clock.after(600, () => { fired = true; });
  advance(400);
  assert.equal(fired, false);
  advance(30);
  assert.equal(fired, true);
});

test("таймеры: пауза задерживает срабатывание, настоящий таймер снимается", () => {
  const { clock, advance, pending } = fakeClock();
  let fired = false;
  clock.after(5, () => { fired = true; });
  advance(2000);
  clock.pause();
  assert.equal(pending(), null);
  advance(60000);
  assert.equal(fired, false);
  clock.resume();
  advance(2900);
  assert.equal(fired, false);
  advance(200);
  assert.equal(fired, true);
});

test("таймеры: один настоящий setTimeout на ближайший таймер", () => {
  const { clock, armed } = fakeClock();
  clock.after(600, () => {});
  const n = armed();
  clock.after(900, () => {});                 // дальше ближайшего — не перезаводит
  clock.after(1200, () => {});
  assert.equal(armed(), n);
});

test("every: повторяется; далеко вперёд — без догонялок", () => {
  const { clock, advance } = fakeClock();
  let n = 0;
  const stop = clock.every(60, () => n++);
  advance(60000 * 3 + 10);
  assert.equal(n, 3);
  clock.set(clock.ms + 86400000);             // every — относительный: оставшееся время сохраняется
  advance(60000);
  assert.equal(n, 4);
  stop();
  advance(600000);
  assert.equal(n, 4);
});

test("at: «ЧЧ:ММ» — ближайшее такое время в поясе utcOffset", () => {
  const { clock } = fakeClock(Date.UTC(2026, 10, 8, 11, 0));          // 14:00 по Москве
  assert.equal(clock.nextAt("14:05"), Date.UTC(2026, 10, 8, 11, 5));
  assert.equal(clock.nextAt("13:59"), Date.UTC(2026, 10, 9, 10, 59)); // уже прошло — завтра
  assert.throws(() => clock.nextAt("25 минут"));
});

test("at: срабатывает после перевода часов вперёд", () => {
  const { clock, advance } = fakeClock(Date.UTC(2026, 10, 8, 11, 0));
  let fired = false;
  clock.at("14:30", () => { fired = true; });
  clock.set(Date.UTC(2026, 10, 8, 11, 40));
  advance(5);
  assert.equal(fired, true);
});

test("отмена по signal: таймеры снимаются, wait отклоняется CancelledError", async () => {
  const { clock, advance } = fakeClock();
  const ac = new AbortController();
  let fired = false;
  clock.after(1, () => { fired = true; }, { signal: ac.signal });
  const p = clock.wait(5, { signal: ac.signal });
  ac.abort();
  advance(10000);
  assert.equal(fired, false);
  assert.equal(clock.pending, 0);
  await assert.rejects(p, (/** @type {any} */ e) => e instanceof CancelledError);
});

test("wait: выполняется по часам симуляции", async () => {
  const { clock, advance } = fakeClock();
  clock.scale = 10;
  let done = false;
  const p = clock.wait(30).then(() => { done = true; });
  advance(2900);
  await Promise.resolve();
  assert.equal(done, false);
  advance(200);
  await p;
  assert.equal(done, true);
});

test("ошибка в таймере не ломает остальные", () => {
  const { clock, advance } = fakeClock();
  const err = console.error;
  console.error = () => {};
  let ok = false;
  clock.after(1, () => { throw new Error("сбой"); });
  clock.after(1, () => { ok = true; });
  advance(2000);
  console.error = err;
  assert.equal(ok, true);
});
