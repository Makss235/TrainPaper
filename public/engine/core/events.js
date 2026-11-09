// Простые события: on(имя, fn) → функция отписки, off, emit. Ошибка в подписчике не ломает остальных.
// Используются движком (engine.on), часами (engine.time.on) и объектами сцены (go.on).
// @ts-check

export class Emitter {
  constructor() {
    /** @type {Map<string, Set<(...args: any[]) => void>>} */
    this.map = new Map();
  }

  /**
   * Подписаться. Возвращает функцию отписки.
   * @param {string} name @param {(...args: any[]) => void} fn
   */
  on(name, fn) {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  /** @param {string} name @param {(...args: any[]) => void} fn */
  once(name, fn) {
    const off = this.on(name, (...args) => { off(); fn(...args); });
    return off;
  }

  /** @param {string} name @param {(...args: any[]) => void} fn */
  off(name, fn) {
    this.map.get(name)?.delete(fn);
  }

  /** @param {string} name @param {...any} args */
  emit(name, ...args) {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(`Ошибка в обработчике события «${name}»:`, e); }
    }
  }

  /** @param {string} name */
  has(name) {
    return !!this.map.get(name)?.size;
  }
}
