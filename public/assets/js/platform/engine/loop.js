// Отрисовка «по требованию» — главное, что держит нагрузку обоев около нуля в простое.
//
// Кадр рисуется, только когда что-то поменялось: кто-то вызвал invalidate("слой").
// Слои дорогие по-разному, поэтому перерисовываются раздельно:
//   "shadow"    — карта теней от солнца (сдвинулось солнце или проехал поезд);
//   "scene"     — сама сцена (камера, поезд, свет);
//   "sky"       — небо с облаками (рисуется в пониженном разрешении);
//   "composite" — только финальная сборка кадра и фильтры (дождь, снег).
// Непрерывные процессы (плывущие облака, едущий поезд, плавный поворот камеры) регистрируются
// через animate(ключ, tick, fps): tick вызывается с нужной частотой, пока возвращает не false.
// Если ничего не движется, цикл полностью засыпает: ни requestAnimationFrame, ни таймеров.

export class Loop {
  /** render(layers: Set<string>, now) — нарисовать кадр с перечисленными «грязными» слоями. */
  constructor(render, { maxFps = 60 } = {}) {
    this.render = render;
    this.maxFps = maxFps;
    this.dirty = new Set();
    this.anims = new Map();
    this.raf = 0;
    this.timer = 0;
    this.lastRender = -1e9;
    this.stats = { frames: 0, layers: {} };      // для инструмента разработчика (?dev)
  }

  /** Отметить слои как изменившиеся: кадр будет нарисован в ближайший vsync. */
  invalidate(...layers) {
    for (const layer of layers) this.dirty.add(layer);
    this.#schedule(0);
  }

  /**
   * Непрерывная анимация. tick(now, dt) вызывается не чаще fps раз в секунду и сам решает,
   * какие слои перерисовать (через invalidate). Вернул false — анимация снимается.
   * Повторный вызов с тем же ключом заменяет анимацию.
   */
  animate(key, tick, fps = this.maxFps) {
    const old = this.anims.get(key);
    this.anims.set(key, { tick, fps, last: old?.last ?? 0 });
    this.#schedule(0);
  }

  stop(key) {
    this.anims.delete(key);
  }

  has(key) {
    return this.anims.has(key);
  }

  #schedule(delay) {
    if (this.raf) return;
    if (delay > 6) {
      // долгая пауза (облака раз в 80 мс): спим на таймере, кадр всё равно рисуем в vsync
      if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.#request(); }, delay - 4);
    } else {
      clearTimeout(this.timer);
      this.timer = 0;
      this.#request();
    }
  }

  #request() {
    if (!this.raf) this.raf = requestAnimationFrame(now => this.#frame(now));
  }

  #frame(now) {
    this.raf = 0;
    let wait = Infinity;
    for (const [key, a] of this.anims) {
      const interval = 1000 / Math.min(a.fps, this.maxFps);
      if (now - a.last >= interval - 3) {
        const dt = a.last ? Math.min(.25, (now - a.last) / 1000) : 1 / a.fps;
        a.last = now;
        if (a.tick(now, dt) === false) {
          this.anims.delete(key);
          continue;
        }
      }
      wait = Math.min(wait, a.last + interval - now);
    }
    if (this.dirty.size) {
      const minGap = 1000 / this.maxFps - 3;
      if (now - this.lastRender >= minGap) {
        const layers = this.dirty;
        this.dirty = new Set();
        this.lastRender = now;
        this.stats.frames++;
        for (const l of layers) this.stats.layers[l] = (this.stats.layers[l] || 0) + 1;
        this.render(layers, now);
      }
      if (this.dirty.size) wait = Math.min(wait, Math.max(0, this.lastRender + minGap - now));
    }
    if (wait < Infinity) this.#schedule(wait);
  }
}
