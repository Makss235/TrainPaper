// Тесты событий объекта, подписок компонента и поиска компонентов: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { fakeEngine } from "../../../tools/fake-engine.js";
import { Component, registerComponent } from "./component.js";

class Track extends Component { static type = "TestTrack"; }
class Train extends Component {
  static type = "TestTrain";
  /** @type {any[]} */
  got = [];
  /** @param {any} x */
  depart(x) { this.got.push(x); }
}
registerComponent(Track);
registerComponent(Train);

test("go.emit / go.on и всплытие к родителям", () => {
  const f = fakeEngine();
  const station = f.object("Станция"), box = f.object("Ящик", station);
  /** @type {string[]} */
  const log = [];
  station.on("door", (/** @type {any} */ d, /** @type {any} */ src) => log.push(`станция:${d}:${src.name}`));
  box.on("door", (/** @type {any} */ d) => log.push(`ящик:${d}`));
  box.emit("door", "open");
  assert.deepEqual(log, ["ящик:open"]);
  box.emit("door", "close", { bubble: true });
  assert.deepEqual(log, ["ящик:open", "ящик:close", "станция:close:Ящик"]);
});

test("this.on: подписка на другой объект и engine.time — снимается при уничтожении", () => {
  const f = fakeEngine();
  const target = f.object("Цель");
  const c = f.object("Слушатель").addComponent(Track);
  let n = 0, t = 0;
  c.on(target, "ping", () => n++);
  c.on(f.time, "timeChanged", () => t++);
  target.emit("ping");
  f.time.scale = 2;
  assert.equal(n, 1);
  assert.equal(t, 1);
  c.gameObject.destroy();
  target.emit("ping");
  f.time.scale = 3;
  assert.equal(n, 1);
  assert.equal(t, 1);
});

test("go.send вызывает метод у всех компонентов, у которых он есть", () => {
  const f = fakeEngine();
  const go = f.object("Машина");
  const a = go.addComponent(Train), b = go.addComponent(Train);
  go.addComponent(Track);
  assert.equal(go.send("depart", 5), 2);
  assert.deepEqual([a.got, b.got], [[5], [5]]);
});

test("поиск компонентов: по имени и по классу, вверх и вниз по иерархии", () => {
  const f = fakeEngine();
  const station = f.object("Станция"), path = f.object("Путь 1", station), box = f.object("Ящик", path);
  const track = path.addComponent(Track);
  const t1 = box.addComponent(Train), t2 = station.addComponent(Train);
  assert.equal(box.getComponentInParent("TestTrack"), track);
  assert.equal(box.getComponentInParent(Track), track);
  assert.equal(station.getComponentInChildren(Track), track);
  assert.deepEqual(station.getComponentsInChildren("TestTrain"), [t2, t1]);
  assert.equal(f.engine.scene.findComponent(Track), track);
  assert.equal(box.getComponentInParent("Нет такого"), undefined);
});

test("свойства-ссылки ref и component раскрываются перед start() и пишутся обратно именем", () => {
  const f = fakeEngine();
  class Driver extends Component {
    static type = "TestDriver";
    static props = {
      track: { type: "ref", default: null },
      rail: { type: "component", default: null, component: "TestTrack" },
      other: { type: "component", default: null },
    };
    /** @type {any} */
    seen = null;
    start() { this.seen = this.props.track; }
  }
  const path = f.object("Путь 2");
  const track = path.addComponent(Track);
  const warn = console.warn;
  /** @type {any[]} */
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  const d = f.object("Машинист").addComponent(Driver, { track: "Путь 2", rail: "Путь 2", other: "Нет#TestTrack" });
  console.warn = warn;
  assert.equal(d.seen, path);
  assert.equal(d.props.rail, track);
  assert.equal(d.props.other, null);
  assert.equal(warnings.length, 1);
  const json = d.toJSON();
  assert.equal(json.track, "Путь 2");
  assert.equal(json.rail, "Путь 2#TestTrack");
});
