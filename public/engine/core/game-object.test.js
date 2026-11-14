// Тесты событий объекта, подписок компонента и поиска компонентов: node --test
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { fakeEngine } from "../../../tools/fake-engine.js";
import { Component, registerComponent } from "./component.js";

class Anchor extends Component { static type = "TestAnchor"; }
class Probe extends Component {
  static type = "TestProbe";
  /** @type {any[]} */
  got = [];
  /** @param {any} x */
  poke(x) { this.got.push(x); }
}
registerComponent(Anchor);
registerComponent(Probe);

test("go.emit / go.on и всплытие к родителям", () => {
  const f = fakeEngine();
  const yard = f.object("Двор"), box = f.object("Ящик", yard);
  /** @type {string[]} */
  const log = [];
  yard.on("door", (/** @type {any} */ d, /** @type {any} */ src) => log.push(`двор:${d}:${src.name}`));
  box.on("door", (/** @type {any} */ d) => log.push(`ящик:${d}`));
  box.emit("door", "open");
  assert.deepEqual(log, ["ящик:open"]);
  box.emit("door", "close", { bubble: true });
  assert.deepEqual(log, ["ящик:open", "ящик:close", "двор:close:Ящик"]);
});

test("this.on: подписка на другой объект и engine.time — снимается при уничтожении", () => {
  const f = fakeEngine();
  const target = f.object("Цель");
  const c = f.object("Слушатель").addComponent(Anchor);
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
  const a = go.addComponent(Probe), b = go.addComponent(Probe);
  go.addComponent(Anchor);
  assert.equal(go.send("poke", 5), 2);
  assert.deepEqual([a.got, b.got], [[5], [5]]);
});

test("поиск компонентов: по имени и по классу, вверх и вниз по иерархии", () => {
  const f = fakeEngine();
  const yard = f.object("Двор"), node = f.object("Узел 1", yard), box = f.object("Ящик", node);
  const anchor = node.addComponent(Anchor);
  const t1 = box.addComponent(Probe), t2 = yard.addComponent(Probe);
  assert.equal(box.getComponentInParent("TestAnchor"), anchor);
  assert.equal(box.getComponentInParent(Anchor), anchor);
  assert.equal(yard.getComponentInChildren(Anchor), anchor);
  assert.deepEqual(yard.getComponentsInChildren("TestProbe"), [t2, t1]);
  assert.equal(f.engine.scene.findComponent(Anchor), anchor);
  assert.equal(box.getComponentInParent("Нет такого"), undefined);
});

test("свойства-ссылки ref и component раскрываются перед start() и пишутся обратно именем", () => {
  const f = fakeEngine();
  class Watcher extends Component {
    static type = "TestWatcher";
    static props = {
      target: { type: "ref", default: null },
      link: { type: "component", default: null, component: "TestAnchor" },
      other: { type: "component", default: null },
    };
    /** @type {any} */
    seen = null;
    start() { this.seen = this.props.target; }
  }
  const node = f.object("Узел 2");
  const anchor = node.addComponent(Anchor);
  const warn = console.warn;
  /** @type {any[]} */
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  const d = f.object("Наблюдатель").addComponent(Watcher, { target: "Узел 2", link: "Узел 2", other: "Нет#TestAnchor" });
  console.warn = warn;
  assert.equal(d.seen, node);
  assert.equal(d.props.link, anchor);
  assert.equal(d.props.other, null);
  assert.equal(warnings.length, 1);
  const json = d.toJSON();
  assert.equal(json.target, "Узел 2");
  assert.equal(json.link, "Узел 2#TestAnchor");
});

test("this.animate: идёт с заданной частотой, пока не вернёт false; снимается stopAnimation() и удалением", () => {
  const f = fakeEngine();
  const c = f.object("Волчок").addComponent(Anchor);
  let a = 0, b = 0, d = 0;
  c.animate(() => { a++; }, 10);
  c.animate(() => ++b < 3, 60, "short");
  f.advance(1000);
  assert.ok(a >= 9 && a <= 11, `10 раз в секунду, было ${a}`);
  assert.equal(b, 3);
  assert.equal(c.isAnimating("short"), false);
  c.gameObject.setActive(false);
  const paused = a;
  f.advance(500);
  assert.equal(a, paused);                       // у выключенного объекта анимация стоит
  c.gameObject.setActive(true);
  f.advance(500);
  assert.ok(a > paused);
  c.stopAnimation();
  const stopped = a;
  f.advance(500);
  assert.equal(a, stopped);
  c.animate(() => { d++; });
  c.gameObject.destroy();
  f.advance(500);
  assert.equal(d, 0);
  assert.equal(f.engine.loop.anims.size, 0);
});
