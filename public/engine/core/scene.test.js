// node --test: загрузка сцены — жизненный цикл компонентов при повторной загрузке и гонка загрузок.
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { fakeEngine } from "../../../tools/fake-engine.js";
import { Component, registerComponent } from "./component.js";
import * as THREE from "three";
import { Scene } from "./scene.js";

/** @type {string[]} */
let log = [];

class Probe extends Component {
  static type = "SceneTestProbe";
  static props = { tag: { type: "string", default: "" } };
  awake() { log.push(`awake ${this.props.tag}`); }
  start() { log.push(`start ${this.props.tag}`); }
  onDestroy() { log.push(`destroy ${this.props.tag}`); }
}
registerComponent(Probe);

/** Настоящая Scene на поддельном движке. @param {{delay?: () => Promise<void>}} [o] */
function setup({ delay = async () => {} } = {}) {
  const f = fakeEngine();
  const engine = f.engine;
  engine.assets = { ready: delay, preloadScripts: async () => {}, prefab: async () => ({}), report() {} };
  engine.options = { batching: false };
  const scene = new Scene(engine);
  engine.scene = scene;
  return { engine, scene };
}

const sceneData = (/** @type {string} */ name) => ({ objects: [
  { name: `${name}-1`, components: [{ type: "SceneTestProbe", tag: `${name}1` }] },
  { name: `${name}-2`, components: [{ type: "SceneTestProbe", tag: `${name}2` }],
    children: [{ name: `${name}-2a`, components: [{ type: "SceneTestProbe", tag: `${name}2a` }] }] },
] });

test("Scene.load: вторая сцена оживает так же, как первая (awake и start у всех компонентов)", async () => {
  const { scene } = setup();
  log = [];
  assert.equal(await scene.load(sceneData("A")), true);
  assert.deepEqual(log, ["awake A1", "awake A2", "awake A2a", "start A1", "start A2", "start A2a"]);

  log = [];
  assert.equal(await scene.load(sceneData("B")), true);
  // раньше здесь было пусто: корень сцены уже «проснулся» при первой загрузке и не будил новые объекты —
  // вторая сцена оставалась без мешей и камер (видны были только небо и HTML-экраны)
  assert.deepEqual(log.filter(l => !l.startsWith("destroy")), ["awake B1", "awake B2", "awake B2a", "start B1", "start B2", "start B2a"]);
  assert.deepEqual(log.filter(l => l.startsWith("destroy")).sort(), ["destroy A1", "destroy A2", "destroy A2a"]);
  assert.deepEqual(scene.root.children.map(c => c.name), ["B-1", "B-2"]);
  assert.ok(scene.components("SceneTestProbe").every(c => c.started));
});

test("Scene.load: объект, добавленный после загрузки, оживает сразу", async () => {
  const { scene } = setup();
  await scene.load(sceneData("A"));
  await scene.load(sceneData("B"));
  log = [];
  scene.add(scene.instantiate({ name: "Новый", components: [{ type: "SceneTestProbe", tag: "N" }] }));
  assert.deepEqual(log, ["awake N", "start N"]);
});

test("Scene.load: из двух одновременных загрузок применяется последняя, сцены не смешиваются", async () => {
  /** @type {(() => void)[]} */
  const gates = [];
  const { scene } = setup({ delay: () => new Promise(resolve => gates.push(resolve)) });
  log = [];
  const a = scene.load(sceneData("A"));
  const b = scene.load(sceneData("B"));
  await Promise.resolve();
  assert.equal(gates.length, 2);
  gates[1]();                                    // вторая готова раньше первой
  assert.equal(await b, true);
  gates[0]();
  assert.equal(await a, false);
  assert.deepEqual(scene.root.children.map(c => c.name), ["B-1", "B-2"]);
  assert.ok(!log.some(l => l.includes("A")), "первая сцена не создавалась вовсе");
});

test("Scene.load: старая сцена остаётся, пока новая готовится", async () => {
  /** @type {(() => void)[]} */
  const gates = [];
  let slow = false;
  const { scene } = setup({ delay: () => (slow ? new Promise(resolve => gates.push(resolve)) : Promise.resolve()) });
  await scene.load(sceneData("A"));
  slow = true;
  const b = scene.load(sceneData("B"));
  await Promise.resolve();
  assert.deepEqual(scene.root.children.map(c => c.name), ["A-1", "A-2"], "пока B грузится, на экране A");
  gates[0]();
  await b;
  assert.deepEqual(scene.root.children.map(c => c.name), ["B-1", "B-2"]);
});

test("Scene.clear: отменяет загрузку, которая ещё готовится", async () => {
  /** @type {(() => void)[]} */
  const gates = [];
  const { scene } = setup({ delay: () => new Promise(resolve => gates.push(resolve)) });
  const a = scene.load(sceneData("A"));
  await Promise.resolve();
  scene.clear();
  gates[0]();
  assert.equal(await a, false);
  assert.equal(scene.root.children.length, 0);
});

test("setActive у неподвижного объекта пересобирает склейку: выключенный объект не остаётся в кадре", async () => {
  const { engine, scene } = setup();
  engine.options = {};                                           // склейка включена
  await scene.load({ objects: [{ name: "A" }, { name: "B" }, { name: "C" }] });
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.ShaderMaterial();
  const meshes = ["A", "B", "C"].map(name => {
    const mesh = new THREE.Mesh(geometry, material);
    /** @type {any} */ (scene.find(name)).object3D.add(mesh);
    return mesh;
  });
  scene.rebatch();
  const batch = () => /** @type {THREE.InstancedMesh | undefined} */ (scene.batches.children[0]);
  assert.equal(batch()?.count, 3);
  assert.deepEqual(meshes.map(m => m.visible), [false, false, false]);   // рисует их общий меш

  /** @type {any} */ (scene.find("B")).setActive(false);
  scene.flush();                                                  // движок вызывает перед кадром
  assert.equal(batch()?.count, 2);                                // B из склейки ушёл

  /** @type {any} */ (scene.find("B")).setActive(true);
  scene.flush();
  assert.equal(batch()?.count, 3);
});
