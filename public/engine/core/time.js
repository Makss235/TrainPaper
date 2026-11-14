// Часы симуляции — engine.time. Время суток, движение объектов и таймеры скриптов идут
// по этим часам; чисто визуальное (облака, осадки, переходы камеры и погоды) — по реальному времени.
//
// Часы не тикают сами: момент симуляции вычисляется по запросу,
//   sim = simBase + (realNow − realBase) × scale,
// поэтому в простое они не держат ни кадров, ни таймеров. Таймеры (after/every/at/wait) лежат в очереди
// по времени симуляции; часы ставят ОДИН настоящий setTimeout на ближайший: (due − sim) / scale
// и пересчитывают его при смене scale, паузе и set().
//
//   engine.time.now            // Date — момент симуляции
//   engine.time.ms             // то же в миллисекундах
//   engine.time.scale = 1440   // «сутки за минуту»
//   engine.time.set(new Date("2026-11-08T05:30:00+03:00"))
//   engine.time.pause(); engine.time.resume();
//   engine.time.on("timeChanged", ({ reason }) => …)   // set, scale, pause, resume
//
// Чистая логика без three.js и DOM — проверяется `node --test` (time.test.js).
// @ts-check
import { Emitter } from "./events.js";

/** Отмена ожидания: промис wait() отклоняется этой ошибкой, когда компонент удалён. Движок её не выводит. */
export class CancelledError extends Error {
  constructor(message = "Отменено") {
    super(message);
    this.name = "CancelledError";
  }
}

/** @param {any} e */
export const isCancelled = e => e instanceof CancelledError || e?.name === "CancelledError" || e?.name === "AbortError";

/**
 * @typedef {object} Timer
 * @property {number} due       момент симуляции, мс
 * @property {number} seq       порядок постановки (для одинаковых due)
 * @property {() => void} fn
 * @property {boolean} relative  после set() сохраняет оставшееся время (wait, every), иначе — абсолютный момент (at)
 * @property {number} [interval] повтор, мс симуляции (every)
 * @property {string} [label]    для сообщений об ошибке
 * @property {() => void} [unlink]
 */

/**
 * @typedef {object} TimerOptions
 * @property {AbortSignal} [signal]  отмена (у компонента — this.signal: снимается при удалении)
 * @property {string} [label]        имя владельца для сообщений об ошибке
 */

const MAX_DELAY = 2 ** 30;          // предел setTimeout — дальше просто перепроверим

export class SimClock {
  /**
   * @param {object} [o]
   * @param {number | Date} [o.start]               начальный момент симуляции (по умолчанию — сейчас)
   * @param {() => number} [o.realNow]               реальное время, мс (по умолчанию performance.now)
   * @param {(fn: () => void, ms: number) => any} [o.setTimer]   для тестов
   * @param {(id: any) => void} [o.clearTimer]
   */
  constructor({ start = Date.now(), realNow = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
    this.realNow = realNow;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.simBase = +start;
    this.realBase = realNow();
    this._scale = 1;
    this._paused = false;
    /** Часовой пояс для at("ЧЧ:ММ"): минуты к UTC (180 — Москва) или null — местное время браузера. @type {number | null} */
    this.utcOffset = null;
    this.events = new Emitter();
    /** @type {Timer[]} по возрастанию due */
    this.timers = [];
    this.seq = 0;
    /** @type {any} */
    this.handle = 0;
  }

  // ---------- момент ----------

  /** Момент симуляции, мс. */
  get ms() {
    return this._paused ? this.simBase : this.simBase + (this.realNow() - this.realBase) * this._scale;
  }

  /** Момент симуляции. */
  get now() { return new Date(this.ms); }

  /** Ускорение: 1 — как в жизни, 1440 — «сутки за минуту». */
  get scale() { return this._scale; }
  set scale(k) { this.setScale(k); }

  get paused() { return this._paused; }
  /** Идут ли часы (не на паузе и scale > 0). */
  get running() { return !this._paused && this._scale > 0; }

  #rebase() {
    this.simBase = this.ms;
    this.realBase = this.realNow();
  }

  /** @param {string} reason @param {Record<string, any>} [extra] */
  #changed(reason, extra = {}) {
    this.#arm();
    this.events.emit("timeChanged", { reason, ms: this.ms, scale: this._scale, paused: this._paused, ...extra });
  }

  /**
   * Перевести часы. Таймеры wait/every сохраняют оставшееся время, at — срабатывают, если их момент прошёл.
   * @param {Date | number} date
   */
  set(date) {
    const before = this.ms, to = +date;
    if (!Number.isFinite(to)) throw new Error(`time.set: не дата — ${date}`);
    this.simBase = to;
    this.realBase = this.realNow();
    const delta = to - before;
    if (delta) for (const t of this.timers) if (t.relative) t.due += delta;
    this.timers.sort(order);
    this.#changed("set", { delta });
  }

  /** @param {number} k */
  setScale(k) {
    if (!(k >= 0)) throw new Error(`time.scale: нужно число ≥ 0, а не ${k}`);
    if (k === this._scale) return;
    this.#rebase();
    this._scale = k;
    this.#changed("scale");
  }

  pause() {
    if (this._paused) return;
    this.#rebase();
    this._paused = true;
    this.#changed("pause");
  }

  resume() {
    if (!this._paused) return;
    this.realBase = this.realNow();
    this._paused = false;
    this.#changed("resume");
  }

  /** @param {string} name @param {(...args: any[]) => void} fn */
  on(name, fn) { return this.events.on(name, fn); }

  // ---------- таймеры ----------

  /** Сколько таймеров ждёт (для инспектора). */
  get pending() { return this.timers.length; }

  /**
   * Ближайший момент «ЧЧ:ММ[:СС]» после from (по часовому поясу utcOffset или местному).
   * @param {string} hhmm @param {number} [from]
   */
  nextAt(hhmm, from = this.ms) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmm).trim());
    if (!m) throw new Error(`Время «${hhmm}»: нужно "ЧЧ:ММ"`);
    const sec = (+m[1] * 60 + +m[2]) * 60 + +(m[3] || 0);
    const offset = this.offsetAt(from);
    const local = from + offset * 60000;                       // «местное» время как UTC
    const day = Math.floor(local / 86400000) * 86400000;
    let t = day + sec * 1000 - offset * 60000;
    if (t <= from) t += 86400000;
    return t;
  }

  /** Смещение часового пояса в момент ms, минуты к UTC. @param {number} ms */
  offsetAt(ms) {
    return this.utcOffset ?? -new Date(ms).getTimezoneOffset();
  }

  /**
   * Вызвать fn через seconds секунд симуляции. Возвращает функцию отмены.
   * @param {number} seconds @param {() => void} fn @param {TimerOptions} [o]
   */
  after(seconds, fn, o = {}) {
    return this.#add({ due: this.ms + Math.max(0, seconds) * 1000, fn, relative: true, label: o.label }, o.signal);
  }

  /**
   * Вызывать fn каждые seconds секунд симуляции. Если часы перевели далеко вперёд, пропущенные
   * срабатывания не догоняются — fn вызывается один раз.
   * @param {number} seconds @param {() => void} fn @param {TimerOptions} [o]
   */
  every(seconds, fn, o = {}) {
    const interval = Math.max(1, seconds * 1000);
    return this.#add({ due: this.ms + interval, fn, relative: true, interval, label: o.label }, o.signal);
  }

  /**
   * Вызвать fn в момент when: Date, мс или "ЧЧ:ММ" (ближайшее такое время).
   * @param {Date | number | string} when @param {() => void} fn @param {TimerOptions} [o]
   */
  at(when, fn, o = {}) {
    const due = typeof when === "string" ? this.nextAt(when) : +when;
    return this.#add({ due, fn, relative: false, label: o.label }, o.signal);
  }

  /**
   * Промис, который выполнится через seconds секунд симуляции (или отклонится CancelledError по signal).
   * @param {number} seconds @param {TimerOptions} [o]
   * @returns {Promise<void>}
   */
  wait(seconds, o = {}) {
    return new Promise((resolve, reject) => {
      if (o.signal?.aborted) { reject(new CancelledError()); return; }
      const cancel = this.after(seconds, () => { o.signal?.removeEventListener("abort", onAbort); resolve(); }, o);
      const onAbort = () => { cancel(); reject(new CancelledError()); };
      o.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Промис до момента when (Date, мс или "ЧЧ:ММ").
   * @param {Date | number | string} when @param {TimerOptions} [o]
   * @returns {Promise<void>}
   */
  until(when, o = {}) {
    return new Promise((resolve, reject) => {
      if (o.signal?.aborted) { reject(new CancelledError()); return; }
      const cancel = this.at(when, () => { o.signal?.removeEventListener("abort", onAbort); resolve(); }, o);
      const onAbort = () => { cancel(); reject(new CancelledError()); };
      o.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Снять все таймеры. */
  clearTimers() {
    for (const t of this.timers) t.unlink?.();
    this.timers = [];
    this.#arm();
  }

  /**
   * @param {Omit<Timer, "seq">} spec @param {AbortSignal} [signal]
   * @returns {() => void} отмена
   */
  #add(spec, signal) {
    /** @type {Timer} */
    const t = { ...spec, seq: ++this.seq };
    const cancel = () => this.#remove(t);
    if (signal) {
      if (signal.aborted) return () => {};
      signal.addEventListener("abort", cancel, { once: true });
      t.unlink = () => signal.removeEventListener("abort", cancel);
    }
    insert(this.timers, t);
    if (this.timers[0] === t) this.#arm();
    return cancel;
  }

  /** @param {Timer} t */
  #remove(t) {
    const i = this.timers.indexOf(t);
    if (i < 0) return;
    this.timers.splice(i, 1);
    t.unlink?.();
    if (i === 0) this.#arm();
  }

  /** Выполнить все таймеры, чей момент наступил (часы вызывают сами; в тестах — вручную). */
  runDue() {
    let guard = 0;
    while (this.timers.length && this.timers[0].due <= this.ms && guard++ < 10000) {
      const t = /** @type {Timer} */ (this.timers.shift());
      if (t.interval) {
        const now = this.ms;
        t.due += t.interval;
        if (t.due <= now) t.due = now + t.interval;            // далеко перевели вперёд — не догоняем
        t.seq = ++this.seq;
        insert(this.timers, t);
      } else {
        t.unlink?.();
      }
      try {
        t.fn();
      } catch (error) {
        console.error(`Ошибка в таймере${t.label ? ` (${t.label})` : ""}:`, error);
      }
    }
    this.#arm();
  }

  /** Один настоящий таймер на ближайший момент. */
  #arm() {
    if (this.handle) { this.clearTimer(this.handle); this.handle = 0; }
    const first = this.timers[0];
    if (!first || !this.running) return;
    const delay = Math.min(MAX_DELAY, Math.max(0, (first.due - this.ms) / this._scale));
    this.handle = this.setTimer(() => { this.handle = 0; this.runDue(); }, Math.ceil(delay) + 1);
  }
}

/** @param {Timer} a @param {Timer} b */
const order = (a, b) => a.due - b.due || a.seq - b.seq;

/** Вставка с сохранением порядка. @param {Timer[]} list @param {Timer} t */
function insert(list, t) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (order(list[mid], t) <= 0) lo = mid + 1; else hi = mid;
  }
  list.splice(lo, 0, t);
}
