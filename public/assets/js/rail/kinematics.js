// Кинематика поезда вдоль пути: скорость с ограничением ускорения и торможения, кривая торможения
// «встать точно у отметки». Чистая логика без three.js — проверяется `node --test` (kinematics.test.js).
//
//   const st = { traveled: 0, v: 20, arrived: false };
//   advance(st, dt, { vmax: 25, accel: .5, brake: 1, stopAt: 300 });   // stopAt — сколько метров до остановки
//   travelTime(300, 20, { vmax: 25, accel: .5, brake: 1 })             // сколько секунд ехать до остановки
// @ts-check

/** Скорость «доползти» последние сантиметры (иначе к отметке приближались бы бесконечно). */
const CREEP = .35;
/** Шаг интегрирования, с: при ускорении ×1440 за кадр проходит до ~25 с — считаем мелкими шагами. */
const H = .05;

/**
 * @typedef {object} MotionLimits
 * @property {number} vmax   м/с
 * @property {number} accel  м/с²
 * @property {number} brake  м/с²
 * @property {number | null} [stopAt]  сколько метров (от начала отсчёта traveled) до точки остановки; null — без остановки
 * @property {number} [target]  желаемая скорость без остановки (по умолчанию vmax)
 */

/**
 * @typedef {object} MotionState
 * @property {number} traveled  пройдено с начала команды, м
 * @property {number} v         скорость, м/с (≥ 0)
 * @property {boolean} arrived  встал у точки остановки
 */

/** Тормозной путь со скорости v. @param {number} v @param {number} brake */
export const brakingDistance = (v, brake) => (v * v) / (2 * brake);

/**
 * Продвинуть состояние на dt секунд. Возвращает пройденное за шаг расстояние.
 * Остановка — точно в stopAt (без перелёта), скорость при этом 0.
 * @param {MotionState} st @param {number} dt @param {MotionLimits} o
 */
export function advance(st, dt, o) {
  const start = st.traveled;
  let left = dt;
  while (left > 1e-9 && !st.arrived) {
    const h = Math.min(H, left);
    left -= h;
    let target = Math.min(o.vmax, o.target ?? o.vmax);
    if (o.stopAt != null) {
      const remaining = o.stopAt - st.traveled;
      if (remaining <= 1e-4) { st.traveled = o.stopAt; st.v = 0; st.arrived = true; break; }
      // скорость, с которой ещё успеваем встать: v² = 2·b·d; у самой отметки — «доползти»
      target = Math.min(target, Math.max(Math.sqrt(2 * o.brake * remaining), Math.min(CREEP, remaining / h)));
    }
    if (st.v < target) st.v = Math.min(target, st.v + o.accel * h);
    else if (st.v > target) st.v = Math.max(target, st.v - o.brake * h);
    let ds = st.v * h;
    if (o.stopAt != null && st.traveled + ds >= o.stopAt) {
      st.traveled = o.stopAt;
      st.v = 0;
      st.arrived = true;
      break;
    }
    st.traveled += ds;
  }
  return st.traveled - start;
}

/**
 * Сколько секунд ехать distance метров, если въезжаем со скоростью v0 (разгон до vmax, затем торможение до 0,
 * если stop). Для расчёта, когда пускать поезд, чтобы он прибыл к своему времени.
 * @param {number} distance @param {number} v0 @param {MotionLimits & {stop?: boolean}} o
 */
export function travelTime(distance, v0, o) {
  if (distance <= 0) return 0;
  const st = { traveled: 0, v: v0, arrived: false };
  const limits = { ...o, stopAt: o.stop === false ? null : distance };
  // тем же интегратором, что и движение: расчёт совпадает с поездом (с точностью до доли секунды)
  let t = 0;
  while (!st.arrived && t < 36000) {
    advance(st, H, limits);
    t += H;
    if (o.stop === false && st.traveled >= distance) break;
  }
  return t;
}

/**
 * Скорость въезда, чтобы с distance метров плавно затормозить до остановки (не больше vmax).
 * @param {number} distance @param {number} vmax @param {number} brake
 */
export const approachSpeed = (distance, vmax, brake) => Math.min(vmax, Math.sqrt(2 * brake * Math.max(0, distance)));
