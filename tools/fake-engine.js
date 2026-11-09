// Поддельный движок для тестов node --test: настоящие часы, планировщик, объекты и компоненты,
// но без WebGL. advance(мс) — «прошло» реальное время: срабатывают таймеры часов и шаги цикла.
// @ts-check
import { GameObject } from "../public/engine/core/game-object.js";
import { Scheduler } from "../public/engine/core/scheduler.js";
import { SimClock } from "../public/engine/core/time.js";

/** @param {{start?: number, maxFps?: number}} [o] */
export function fakeEngine({ start = Date.UTC(2026, 10, 8, 11, 0), maxFps = 60 } = {}) {
  let real = 0;
  /** @type {{fn: () => void, at: number, id: number} | null} */
  let timer = null;
  let ids = 0;
  const time = new SimClock({
    start, realNow: () => real,
    setTimer: (fn, ms) => { timer = { fn, at: real + ms, id: ++ids }; return ids; },
    clearTimer: id => { if (timer?.id === id) timer = null; },
  });
  time.utcOffset = 180;
  /** @type {Map<string, {tick: (now: number, dt: number) => any, fps: number, last: number}>} */
  const anims = new Map();
  const loop = {
    maxFps,
    anims,
    /** @param {string} k @param {(now: number, dt: number) => any} tick @param {number} [fps] */
    animate(k, tick, fps = maxFps) { anims.set(k, { tick, fps, last: anims.get(k)?.last ?? -1e9 }); },
    /** @param {string} k */
    stop(k) { anims.delete(k); },
    /** @param {string} k */
    has(k) { return anims.has(k); },
  };
  const stats = { frames: 0, invalidations: 0 };
  /** @type {any} */
  const engine = {
    time, loop, options: {}, events: { emit() {}, on() { return () => {}; } },
    invalidate() { stats.invalidations++; },
    palette: { rgb: (/** @type {any} */ c) => c },
  };
  engine.scheduler = new Scheduler(loop, time);
  const root = new GameObject("Сцена");
  root.engine = engine;
  root.awoken = root.started = true;
  engine.scene = {
    root, started: true,
    markDirty() {},
    /** @param {GameObject} go */
    add: go => root.add(go),
    /** @param {string} n */
    find: n => root.find(n),
    /** @param {any} t */
    components: t => root.getComponentsInChildren(t),
    /** @param {any} t */
    findComponent: t => root.getComponentInChildren(t),
  };
  engine.find = (/** @type {string} */ n) => root.find(n);

  /** Прошло ms реального времени: кадры по 1000/maxFps, таймеры часов — точно в свой момент. @param {number} ms */
  function advance(ms) {
    const end = real + ms, step = 1000 / maxFps;
    while (real < end) {
      const next = Math.min(end, real + step);
      while (timer && timer.at <= next) { real = Math.max(real, timer.at); const t = timer; timer = null; t.fn(); }
      real = next;
      let ticked = false;
      for (const [k, a] of [...anims]) {
        if (real - a.last < 1000 / a.fps - 3) continue;
        const dt = Math.min(.25, (real - a.last) / 1000);
        a.last = real;
        ticked = true;
        if (a.tick(real, dt) === false) anims.delete(k);
      }
      if (ticked) stats.frames++;
    }
  }

  /** Объект в «живой» сцене. @param {string} name @param {GameObject} [parent] */
  function object(name, parent = root) {
    const go = new GameObject(name);
    parent.add(go);
    return go;
  }

  return { engine, time, loop, root, advance, object, stats, get real() { return real; } };
}
