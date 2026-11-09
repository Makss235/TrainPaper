// Тесты префабов и повторов: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { applyPrefab, expandRepeat } from "./prefab.js";

const lamp = {
  name: "Фонарь",
  components: [
    { type: "Model", model: "lamp-post", params: { height: 5.2 } },
    { type: "Light", range: 11 },
    { type: "Glow", id: "a", radius: 1 },
    { type: "Glow", id: "b", radius: 2 },
  ],
  children: [{ name: "Табличка" }],
};

test("applyPrefab: поля экземпляра заменяют поля префаба", () => {
  const out = applyPrefab(lamp, { prefab: "lamp", name: "Фонарь 3", position: [1, 2, 3] });
  assert.equal(out.name, "Фонарь 3");
  assert.deepEqual(out.position, [1, 2, 3]);
  assert.equal(out.prefab, undefined);
});

test("applyPrefab: компоненты сливаются по type и id, новые добавляются, remove убирает", () => {
  const out = applyPrefab(lamp, { components: [
    { type: "Model", params: { arm: 1 } },
    { type: "Glow", id: "b", radius: 5 },
    { type: "Light", remove: true },
    { type: "Sprite", texture: "x.png" },
  ] });
  const model = out.components.find((/** @type {any} */ c) => c.type === "Model");
  assert.deepEqual(model.params, { height: 5.2, arm: 1 });
  assert.equal(out.components.find((/** @type {any} */ c) => c.id === "a").radius, 1);
  assert.equal(out.components.find((/** @type {any} */ c) => c.id === "b").radius, 5);
  assert.equal(out.components.find((/** @type {any} */ c) => c.type === "Light").remove, true);
  assert.equal(out.components.at(-1).type, "Sprite");
});

test("applyPrefab: дочерние объекты префаба и экземпляра складываются, префаб не меняется", () => {
  const out = applyPrefab(lamp, { children: [{ name: "Флаг" }] });
  assert.deepEqual(out.children.map((/** @type {any} */ c) => c.name), ["Табличка", "Флаг"]);
  out.children[0].name = "X";
  assert.equal(lamp.children[0].name, "Табличка");
});

test("expandRepeat: без repeat — сам объект", () => {
  const od = { name: "A" };
  assert.deepEqual(expandRepeat(od), [od]);
});

test("expandRepeat: шаг, имена, поворот", () => {
  const list = expandRepeat({ name: "Столб", position: [1, 0, 0], repeat: { count: 3, step: [0, 0, -10], rotate: [0, 15, 0] } });
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(o => o.name), ["Столб 1", "Столб 2", "Столб 3"]);
  assert.deepEqual(list[2].position, [1, 0, -20]);
  assert.deepEqual(list[2].rotation, [0, 30, 0]);
  assert.equal(list[0].repeat, undefined);
});

test("expandRepeat: шаблон имени и случайность с зерном повторяется", () => {
  const od = { name: "Дерево", repeat: { count: 4, jitter: [2, 0, 2], scaleJitter: .2, seed: 5, name: "Ель {i}" } };
  const a = expandRepeat(od), b = expandRepeat(od);
  assert.equal(a[3].name, "Ель 4");
  assert.deepEqual(a, b);
  for (const o of a) assert.ok(Math.abs(o.position[0]) <= 2 && o.scale[0] >= .8 && o.scale[0] <= 1.2);
});
