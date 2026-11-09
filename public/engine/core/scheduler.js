// Планировщик поведения: update(dt) компонентов и tween() — плавные переходы.
//
// Компонент попадает сюда, только если в его классе объявлен update(), он включён, объект активен
// и start() уже был. Пока нет ни одного бодрствующего update и ни одного tween, планировщик снимает
// свою анимацию с цикла — и движок спит (ни кадров, ни таймеров).
//
// Частота: static fps у класса компонента (по умолчанию — частота кадров), порядок — static order
// (меньше — раньше). dt — секунды СИМУЛЯЦИИ (с учётом engine.time.scale; на паузе update не вызывается),
// static realTime = true — реальные секунды (визуальные скрипты).
//
// Чистая логика без three.js: цикл и часы передаются снаружи (тесты — scheduler.test.js).
// @ts-check
import { easing } from "./easing.js";
import { CancelledError } from "./time.js";

/**
 * @typedef {object} Updatable  то, что планировщик вызывает (компонент с update)
 * @property {(dt: number) => void} update
 * @property {string} [type]
 * @property {{name?: string}} [gameObject]
 */

/**
 * @typedef {object} TweenOptions
 * @property {number | number[]} [from]   начальное значение (число или массив чисел), по умолчанию 0
 * @property {number | number[]} [to]     конечное, по умолчанию 1
 * @property {number} [duration]          секунды (симуляции; realTime — реальные), по умолчанию 1
 * @property {string | ((t: number) => number)} [ease]  linear, inQuad, outQuad, inOutCubic, smoothstep (по умолчанию)
 * @property {(value: any, k: number) => void} [onUpdate]  каждый кадр: текущее значение и доля пути 0…1
 * @property {boolean} [realTime]         по реальному времени (не зависит от ускорения и паузы)
 * @property {AbortSignal} [signal]       отмена (у компонента — сам компонент: при удалении)
 * @property {number} [fps]               частота шагов (по умолчанию — частота кадров)
 */

/**
 * @typedef {object} Tween
 * @property {number} elapsed
 * @property {number} duration
 * @property {any} from
 * @property {any} to
 * @property {(t: number) => number} ease
 * @property {(value: any, k: number) => void} [onUpdate]
 * @property {boolean} realTime
 * @property {number} fps
 * @property {number} last
 * @property {() => void} resolve
 * @property {(e: any) => void} reject
 * @property {() => void} [unlink]
 */

const KEY = "scheduler";

export class Scheduler {
  /**
   * @param {{animate: (key: string, tick: (now: number, dt: number) => boolean | void, fps?: number) => void, stop: (key: string) => void, maxFps: number}} loop
   * @param {{running: boolean, scale: number, on: (name: string, fn: () => void) => any}} time
   * @param {{instant?: () => boolean}} [o]  instant — переходы сразу в конец (скриншоты, «без анимации»)
   */
  constructor(loop, time, { instant = () => false } = {}) {
    this.loop = loop;
    this.time = time;
    this.instant = instant;
    /** @type {Set<Updatable>} */
    this.awake = new Set();
    /** @type {Updatable[] | null} по order — пересобирается при изменениях */
    this.sorted = null;
    /** @type {Set<Tween>} */
    this.tweens = new Set();
    /** @type {WeakMap<object, number>} когда компонент вызывался в последний раз (реальные мс) */
    this.lastCall = new WeakMap();
    this.fps = 0;
    this.stats = { updates: 0, tweens: 0 };
    time.on("timeChanged", () => this.#sync());
  }

  /** Сколько бодрствует (для инспектора). */
  get counts() { return { updates: this.awake.size, tweens: this.tweens.size }; }

  /** Разбудить компонент (начать вызывать update). @param {Updatable} c */
  wake(c) {
    if (this.awake.has(c)) return;
    this.awake.add(c);
    this.lastCall.delete(c);
    this.sorted = null;
    this.#sync();
  }

  /** Усыпить компонент. @param {Updatable} c */
  sleep(c) {
    if (!this.awake.delete(c)) return;
    this.sorted = null;
    this.#sync();
  }

  /** @param {Updatable} c */
  isAwake(c) { return this.awake.has(c); }

  /**
   * Плавный переход значения. Промис выполняется в конце, отклоняется CancelledError при отмене.
   * @param {TweenOptions} o
   * @returns {Promise<void>}
   */
  tween(o) {
    return new Promise((resolve, reject) => {
      const from = o.from ?? 0, to = o.to ?? 1;
      if (o.signal?.aborted) { reject(new CancelledError()); return; }
      const duration = Math.max(0, o.duration ?? 1);
      if (duration === 0 || this.instant()) {
        try { o.onUpdate?.(to, 1); } catch (e) { reject(e); return; }
        resolve();
        return;
      }
      /** @type {Tween} */
      const t = { elapsed: 0, duration, from, to, ease: easing(o.ease), onUpdate: o.onUpdate, realTime: !!o.realTime,
        fps: o.fps || this.loop.maxFps, last: 0, resolve, reject };
      if (o.signal) {
        const abort = () => { this.#endTween(t); reject(new CancelledError()); };
        o.signal.addEventListener("abort", abort, { once: true });
        t.unlink = () => o.signal?.removeEventListener("abort", abort);
      }
      this.tweens.add(t);
      this.#sync();
    });
  }

  /** @param {Tween} t */
  #endTween(t) {
    if (!this.tweens.delete(t)) return;
    t.unlink?.();
    this.#sync();
  }

  /** Нужна ли анимация цикла и с какой частотой. */
  #sync() {
    const running = this.time.running;
    let fps = 0;
    for (const c of this.awake) {
      const C = /** @type {any} */ (c.constructor);
      if (!C.realTime && !running) continue;
      fps = Math.max(fps, C.fps || this.loop.maxFps);
    }
    for (const t of this.tweens) if (t.realTime || running) fps = Math.max(fps, t.fps);
    fps = Math.min(fps, this.loop.maxFps);
    if (fps === this.fps) return;
    this.fps = fps;
    if (fps > 0) this.loop.animate(KEY, (now, dt) => this.tick(now, dt), fps);
    else this.loop.stop(KEY);
  }

  /**
   * Шаг: вызывается циклом. now — реальные мс.
   * @param {number} now @param {number} [_dt]
   */
  tick(now, _dt) {
    const running = this.time.running, scale = this.time.scale;
    if (!this.sorted) this.sorted = [...this.awake].sort((a, b) => ((/** @type {any} */ (a.constructor)).order || 0) - ((/** @type {any} */ (b.constructor)).order || 0));
    for (const c of this.sorted) {
      if (!this.awake.has(c)) continue;                            // усыпили в этом же шаге
      const C = /** @type {any} */ (c.constructor);
      if (!C.realTime && !running) continue;
      const fps = Math.min(C.fps || this.loop.maxFps, this.loop.maxFps);
      const last = this.lastCall.get(c);
      if (last !== undefined && now - last < 1000 / fps - 3) continue;
      const dtReal = last === undefined ? 1 / fps : Math.min(.25, (now - last) / 1000);
      this.lastCall.set(c, now);
      this.stats.updates++;
      try {
        c.update(C.realTime ? dtReal : dtReal * scale);
      } catch (error) {
        console.error(`Ошибка в update() — объект «${c.gameObject?.name ?? "?"}», компонент ${c.type ?? C.name}; компонент усыплён:`, error);
        this.sleep(c);
      }
    }
    for (const t of [...this.tweens]) {
      if (!t.realTime && !running) continue;
      if (t.last && now - t.last < 1000 / t.fps - 3) continue;
      const dtReal = t.last ? Math.min(.25, (now - t.last) / 1000) : 0;
      t.last = now;
      t.elapsed += t.realTime ? dtReal : dtReal * scale;
      const k = Math.min(1, t.elapsed / t.duration);
      const e = t.ease(k);
      this.stats.tweens++;
      try {
        t.onUpdate?.(lerp(t.from, t.to, e), k);
      } catch (error) {
        this.#endTween(t);
        t.reject(error);
        continue;
      }
      if (k >= 1) { this.#endTween(t); t.resolve(); }
    }
    return this.fps > 0;
  }
}

/** @param {any} a @param {any} b @param {number} e */
function lerp(a, b, e) {
  if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * e);
  return a + (b - a) * e;
}
