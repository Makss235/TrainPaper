// Тесты чистой логики данных: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { deepMerge, parseColor, parseJsonc, rng, vec } from "./data.js";

test("parseJsonc: комментарии, висячие запятые, // внутри строк", () => {
  const v = parseJsonc(`{
    // строка
    "a": 1, /* блок */ "url": "http://x//y",
    "list": [1, 2, 3,],
  }`);
  assert.deepEqual(v, { a: 1, url: "http://x//y", list: [1, 2, 3] });
});

test("parseJsonc: экранированные кавычки", () => {
  assert.deepEqual(parseJsonc(`{ "s": "a\\"//b" }`), { s: "a\"//b" });
});

test("deepMerge: объекты сливаются, массивы заменяются, исходники не меняются", () => {
  const base = { a: { x: 1, y: 2 }, list: [1, 2] };
  const out = deepMerge(base, { a: { y: 3 }, list: [9] });
  assert.deepEqual(out, { a: { x: 1, y: 3 }, list: [9] });
  assert.deepEqual(base, { a: { x: 1, y: 2 }, list: [1, 2] });
});

test("parseColor: hex, короткий hex, массив, палитра", () => {
  assert.deepEqual(parseColor("#ff0000"), [1, 0, 0]);
  assert.deepEqual(parseColor("#0f0"), [0, 1, 0]);
  assert.deepEqual(parseColor([.5, .25, 0]), [.5, .25, 0]);
  assert.deepEqual(parseColor("sky", { sky: "#0000ff" }), [0, 0, 1]);
});

test("vec: число и неполный массив", () => {
  assert.deepEqual(vec(2, [0, 0, 0]), [2, 2, 2]);
  assert.deepEqual(vec([1, 2], [0, 0, 5]), [1, 2, 5]);
  assert.deepEqual(vec(undefined, [1, 1]), [1, 1]);
});

test("rng: одно зерно — одна последовательность", () => {
  const a = rng(7), b = rng(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const c = rng(8);
  assert.notEqual(rng(7)(), c());
});
