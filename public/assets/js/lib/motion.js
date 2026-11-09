// @ts-check
// Движение поезда вдоль пути: offset в метрах, + — вперёд (к голове поезда).
// Отправление — разгон, прибытие — торможение до полной остановки.

export const easeInQuad = t => t * t;
export const easeOutQuad = t => 1 - (1 - t) ** 2;
export const easeInCubic = t => t * t * t;
export const easeOutCubic = t => 1 - (1 - t) ** 3;

export class Motion {
  constructor(apply) {
    this.apply = apply;              // apply(offset, present)
    this.offset = 0;
    this.present = false;
    this.moving = false;
  }

  place(present = true) {
    this.offset = 0;
    this.present = present;
    this.apply(0, present);
  }

  animate(from, to, ms, ease) {
    this.moving = true;
    return new Promise((/** @type {(v?: any) => void} */ resolve) => {
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / ms);
        this.offset = from + (to - from) * ease(t);
        this.apply(this.offset, true);
        if (t < 1) requestAnimationFrame(step);
        else { this.moving = false; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  async depart(distance, ms = 5200, ease = easeInCubic) {
    await this.animate(0, distance, ms, ease);
    this.present = false;
    this.apply(distance, false);
  }

  async arrive(distance, ms = 7000, ease = easeOutCubic) {
    this.present = true;
    await this.animate(-distance, 0, ms, ease);
  }
}

/**
 * Очередь смен поезда: уходящий уезжает, затем подходит следующий.
 * firstInstant — самый первый поезд просто стоит у платформы (без анимации при загрузке).
 * @param {{motion: any, departDistance: () => number, arriveDistance: () => number, show: (item: any) => void, instant: () => boolean,
 *   departMs?: number, arriveMs?: number, departEase?: (t: number) => number, arriveEase?: (t: number) => number, pauseMs?: number, firstInstant?: boolean}} o
 */
export function swapper({ motion, departDistance, arriveDistance, show, instant,
  departMs, arriveMs, departEase, arriveEase, pauseMs = 0, firstInstant = false }) {
  let busy = false, pending, first = true;
  async function run() {
    if (busy) return;
    busy = true;
    while (pending !== undefined) {
      const next = pending;
      pending = undefined;
      // «первым» считается первый настоящий поезд: пока табло грузится, приходит пустое значение
      const quick = instant() || (firstInstant && first);
      if (motion.present && !quick) await motion.depart(departDistance(), departMs, departEase);
      if (!quick && pauseMs && next) await new Promise(r => setTimeout(r, pauseMs));
      show(next);
      if (next) {
        if (quick) motion.place(true);
        else await motion.arrive(arriveDistance(), arriveMs, arriveEase);
        first = false;
      } else {
        motion.place(false);
      }
    }
    busy = false;
  }
  return next => {
    pending = next;
    run();
  };
}
