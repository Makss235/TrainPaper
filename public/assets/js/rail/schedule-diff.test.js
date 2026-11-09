// Тесты расписания: времена строк и сравнение расписаний. node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { SimClock } from "../../../engine/core/time.js";
import { diffRows, onlyTimesChanged, parseTime, rowTimes } from "./schedule-diff.js";

const clock = new SimClock({ start: 0, realNow: () => 0, setTimer: () => 0, clearTimer: () => {} });
clock.utcOffset = 180;
const nextAt = (/** @type {string} */ h, /** @type {number | undefined} */ from) => clock.nextAt(h, from);
const at = (/** @type {number} */ h, /** @type {number} */ m, s = 0) => Date.UTC(2026, 10, 8, h - 3, m, s);   // по Москве

test("parseTime: мс, ISO, ЧЧ:ММ", () => {
  assert.equal(parseTime(5, nextAt, 0), 5);
  assert.equal(parseTime("2026-11-08T14:05:00+03:00", nextAt, 0), at(14, 5));
  assert.equal(parseTime("14:05", nextAt, at(13, 0)), at(14, 5));
  assert.equal(parseTime(null, nextAt, 0), null);
});

test("rowTimes: стоянка по dwell; прошедшая строка — завтра", () => {
  const row = { id: "1", action: "stop", arrive: "14:05", dwell: 40 };
  const t = rowTimes(row, at(14, 0), nextAt);
  assert.equal(t.arrive, at(14, 5));
  assert.equal(t.depart, at(14, 5, 40));
  const later = rowTimes(row, at(14, 10), nextAt);
  assert.equal(later.arrive, at(14, 5) + 86400000);
});

test("rowTimes: поезд ещё стоит — сегодняшний раз", () => {
  const row = { id: "1", action: "stop", arrive: "14:05", depart: "14:20" };
  const t = rowTimes(row, at(14, 10), nextAt);
  assert.equal(t.arrive, at(14, 5));
  assert.equal(t.depart, at(14, 20));
});

test("rowTimes: повтор every — ближайший незакончившийся раз", () => {
  const row = { id: "э", action: "stop", arrive: "06:05", dwell: 40, every: 20 };
  const t = rowTimes(row, at(14, 10), nextAt);
  assert.equal(t.arrive, at(14, 25));
  const standing = rowTimes(row, at(14, 25, 20), nextAt);
  assert.equal(standing.arrive, at(14, 25));
});

test("rowTimes: enter now / standing и depart: null — стоять до снятия строки", () => {
  const now = at(12, 0);
  const t = rowTimes({ id: "x", enter: "standing", depart: null }, now, nextAt);
  assert.equal(t.arrive, now);
  assert.equal(t.depart, null);
  assert.equal(t.end, Infinity);
});

test("rowTimes: проход — конец через минуту после прохода", () => {
  const t = rowTimes({ id: "p", action: "pass", arrive: "14:20" }, at(14, 0), nextAt);
  assert.equal(t.arrive, at(14, 20));
  assert.equal(t.end, at(14, 21));
});

test("diffRows: новые, удалённые, изменённые, прежние", () => {
  const prev = [{ id: "a", arrive: "14:05" }, { id: "b", arrive: "14:20" }, { id: "c", arrive: "15:00" }];
  const next = [{ id: "a", arrive: "14:05" }, { id: "b", arrive: "14:25" }, { id: "d", arrive: "16:00" }];
  const d = diffRows(prev, next);
  assert.deepEqual(d.added.map(r => r.id), ["d"]);
  assert.deepEqual(d.removed.map(r => r.id), ["c"]);
  assert.deepEqual(d.changed.map(c => c.to.id), ["b"]);
  assert.deepEqual(d.kept.map(r => r.id), ["a"]);
});

test("diffRows: порядок ключей не важен; повтор id пропускается", () => {
  const warn = console.warn;
  console.warn = () => {};
  const d = diffRows([{ id: 1, a: 1, b: 2 }], [{ b: 2, a: 1, id: 1 }, { id: 1, a: 5 }]);
  console.warn = warn;
  assert.equal(d.kept.length, 1);
  assert.equal(d.changed.length, 0);
});

test("onlyTimesChanged: время отправления и табличка — на ходу, путь — нет", () => {
  assert.equal(onlyTimesChanged({ id: 1, track: "П1", depart: "14:00" }, { id: 1, track: "П1", depart: "14:10" }), true);
  assert.equal(onlyTimesChanged({ id: 1, track: "П1" }, { id: 1, track: "П2" }), false);
});
