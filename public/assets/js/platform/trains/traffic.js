// Движение поездов по путям сцены. Роли задаются в сцене (traffic: [...]):
//
// role: "board" — поезд с табло. Показывается ближайшее событие: прибывший стоит ещё 10 минут,
//   отправляющийся — до минуты после отправления (lib/trains.js). Когда поезд меняется, текущий
//   уезжает, а следующий подходит и тормозит у платформы. При загрузке страницы поезд уже стоит.
//   {
//     role: "board", track: "main",
//     arrival:   { heading: 1, stop: { far: -7.2 }, from: 260, ms: 21000 },  // приходит с горизонта
//     departure: { heading: 1, stop: { far: -7.2 }, ms: 9000 },              // уходит мимо камеры
//     pause: 1800,                                                           // пауза между поездами, мс
//   }
//   heading — куда смотрит голова (+1 — к камере, −1 — к горизонту), см. trains/train.js;
//   stop.far — z дальнего от камеры конца поезда, stop.near — z ближнего (одно из двух);
//   from — с какого расстояния (м) поезд начинает подход; to — куда уходит (для heading −1).
//
// role: "passing" — поезд без остановки: грузовой или транзитный, раз в несколько минут.
//   { role: "passing", track: "second", type: "freight", heading: -1, speed: 22, every: [240, 720], first: 40 }
//   every — пауза между поездами, с (случайно в диапазоне), first — через сколько секунд первый.
import { easeInQuad, easeOutQuad } from "../../lib/motion.js";
import { Train } from "./train.js";
import { trainTypeFor } from "./index.js";

/** Хвост s для стоящего поезда длины L по описанию остановки. */
function stopTail(stop, heading, L) {
  if (stop.near != null) return heading > 0 ? stop.near - L : stop.near;
  const far = stop.far ?? -7.2;
  return heading > 0 ? far : far + L;
}

/** Плавное движение хвоста от a до b за ms с функцией ease; кадры — через цикл движка. */
function move(engine, key, train, track, heading, a, b, ms, ease) {
  return new Promise(resolve => {
    const t0 = performance.now();
    engine.loop.animate(key, now => {
      const k = Math.min(1, (now - t0) / ms);
      train.place(track, a + (b - a) * ease(k), heading);
      engine.loop.invalidate("scene", "shadow");
      if (k >= 1) { resolve(); return false; }
      return true;
    });
  });
}

export class BoardTraffic {
  /**
   * engine — движок, world — собранная сцена, cfg — описание роли, sceneTrains — настройки составов сцены,
   * onShow(item) — сменился поезд у платформы (табло, табличка).
   */
  constructor({ engine, world, cfg, sceneTrains, instant, onShow }) {
    this.engine = engine;
    this.world = world;
    this.cfg = { pause: 1800, ...cfg };
    this.track = world.tracks.get(cfg.track);
    this.sceneTrains = sceneTrains;
    this.instant = instant;
    this.onShow = onShow;
    this.pool = new Map();             // поезд каждого типа строится один раз
    this.current = null;               // { item, train, heading }
    this.pending = undefined;
    this.busy = false;
    this.first = true;
    this.key = `board:${cfg.track}`;
  }

  #train(type) {
    if (!this.pool.has(type)) this.pool.set(type, new Train(type));
    const train = this.pool.get(type);
    if (!train.object.parent) this.world.group.add(train.object);
    return train;
  }

  /** Показать поезд item (или никакой — null). Повторные вызовы во время смены ставятся в очередь. */
  show(item) {
    this.pending = item;
    this.#run();
  }

  /** Тот же поезд, но табло обновилось (путь назначили, время сдвинулось): только табличка. */
  update(item) {
    if (this.current?.item && item && this.current.item.train.id === item.train.id) {
      this.current.item = item;
      this.current.train.setPlate(item.train);
      this.engine.loop.invalidate("scene");
    }
  }

  async #run() {
    if (this.busy) return;
    this.busy = true;
    const camZ = () => this.engine.rig.pose.position[2];
    while (this.pending !== undefined) {
      const next = this.pending;
      this.pending = undefined;
      // первым считается первый настоящий поезд: пока табло грузится, приходит пустое значение
      const quick = this.instant() || (this.first && next);
      const cur = this.current;
      if (cur) {
        if (quick) {
          cur.train.object.removeFromParent();
        } else {
          const dep = cur.item?.event === "arrival" ? this.cfg.arrival : this.cfg.departure;
          const L = cur.train.length, s0 = cur.train.s;
          // heading +1 — уходит мимо камеры (пока хвост не окажется за спиной), −1 — к горизонту
          const s1 = cur.heading > 0 ? Math.max(s0 + 1, camZ() + 14) : s0 - (dep?.to ?? 700) - L;
          const dist = Math.abs(s1 - s0);
          await move(this.engine, this.key, cur.train, this.track, cur.heading, s0, s1, (dep?.ms ?? 9000) * Math.sqrt(dist / 16), easeInQuad);
          cur.train.object.removeFromParent();
        }
        this.current = null;
        this.engine.loop.invalidate("scene", "shadow");
      }
      if (!quick && this.cfg.pause && next) await new Promise(r => setTimeout(r, this.cfg.pause));
      this.onShow?.(next);
      if (!next) continue;
      const type = trainTypeFor(next, this.sceneTrains);
      const train = this.#train(type);
      train.setPlate(next.train);
      const spec = (next.event === "arrival" ? this.cfg.arrival : this.cfg.departure) || {};
      const heading = spec.heading ?? 1;
      const sStop = stopTail(spec.stop || {}, heading, train.length);
      if (quick) {
        train.place(this.track, sStop, heading);
        this.engine.loop.invalidate("scene", "shadow");
      } else {
        // подход: heading +1 — из-за горизонта, −1 — из-за спины камеры
        const L = train.length;
        const s0 = heading > 0 ? sStop - L - (spec.from ?? 260) : Math.max(sStop + (spec.from ?? 60), camZ() + 20 + L);
        train.place(this.track, s0, heading);
        await move(this.engine, this.key, train, this.track, heading, s0, sStop, spec.ms ?? 21000, easeOutQuad);
      }
      this.current = { item: next, train, heading };
      this.first = false;
    }
    this.busy = false;
  }

  dispose() {
    this.engine.loop.stop(this.key);
    for (const t of this.pool.values()) t.dispose();
    this.pool.clear();
  }
}

export class PassingTraffic {
  constructor({ engine, world, cfg }) {
    this.engine = engine;
    this.world = world;
    this.cfg = { type: "freight", heading: -1, speed: 22, every: [240, 720], first: 40, ...cfg };
    this.track = world.tracks.get(cfg.track);
    this.key = `passing:${cfg.track}`;
    this.timer = 0;
    this.train = null;
    this.seed = 1;
  }

  start() {
    this.#schedule(this.cfg.first * 1000);
  }

  #schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#pass(), ms);
  }

  async #pass() {
    if (document.hidden) return this.#schedule(30000);          // в фоне не тратим силы
    const { heading, speed, every, type } = this.cfg;
    const train = new Train(type, { seed: this.seed++ });
    this.train = train;
    this.world.group.add(train.object);
    const L = train.length, camZ = this.engine.rig.pose.position[2];
    // heading +1 едет к камере: начинает за горизонтом, кончает за спиной; −1 — наоборот
    const s0 = heading > 0 ? -900 - L : camZ + 30 + L;
    const s1 = heading > 0 ? camZ + 30 : -900;
    await move(this.engine, this.key, train, this.track, heading, s0, s1, Math.abs(s1 - s0) / speed * 1000, t => t);
    train.dispose();
    this.train = null;
    this.engine.loop.invalidate("scene", "shadow");
    this.#schedule((every[0] + Math.random() * (every[1] - every[0])) * 1000);
  }

  dispose() {
    clearTimeout(this.timer);
    this.engine.loop.stop(this.key);
    this.train?.dispose();
  }
}

/** Создать роли движения по описанию сцены. */
export function createTraffic({ engine, world, sceneDef, instant, onShow }) {
  const roles = [];
  for (const cfg of sceneDef.traffic || []) {
    if (!world.tracks.has(cfg.track)) { console.warn(`Сцена «${sceneDef.name}»: нет пути «${cfg.track}» для движения`); continue; }
    if (cfg.role === "board") roles.push(new BoardTraffic({ engine, world, cfg, sceneTrains: sceneDef.trains, instant, onShow }));
    else if (cfg.role === "passing") roles.push(new PassingTraffic({ engine, world, cfg }));
  }
  return roles;
}
