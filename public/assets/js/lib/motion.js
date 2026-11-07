// Движение поезда вдоль пути: offset в метрах, + — вперёд (к голове поезда).
// Отправление — разгон, прибытие — торможение до полной остановки.

export class Motion {
  constructor(apply) {
    this.apply = apply;              // apply(offset, present)
    this.offset = 0;
    this.present = false;
  }

  place(present = true) {
    this.offset = 0;
    this.present = present;
    this.apply(0, present);
  }

  animate(from, to, ms, ease) {
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / ms);
        this.offset = from + (to - from) * ease(t);
        this.apply(this.offset, true);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async depart(distance, ms = 5200) {
    await this.animate(0, distance, ms, t => t * t * t);
    this.present = false;
    this.apply(distance, false);
  }

  async arrive(distance, ms = 7000) {
    this.present = true;
    await this.animate(-distance, 0, ms, t => 1 - (1 - t) ** 3);
  }
}

/** Очередь смен поезда: уходящий уезжает, затем подходит следующий. */
export function swapper({ motion, departDistance, arriveDistance, show, instant }) {
  let busy = false, pending;
  async function run() {
    if (busy) return;
    busy = true;
    while (pending !== undefined) {
      const next = pending;
      pending = undefined;
      if (motion.present && !instant()) await motion.depart(departDistance());
      show(next);
      if (next) {
        if (instant()) motion.place(true);
        else await motion.arrive(arriveDistance());
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
