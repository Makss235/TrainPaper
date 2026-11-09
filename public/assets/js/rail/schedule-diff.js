// Расписание — чистая логика (без three.js): времена строк по часам симуляции и сравнение старого
// расписания с новым. Проверяется `node --test` (schedule-diff.test.js).
//
// Строка: { id, number, consist, track, stop, action: "stop" | "pass", arrive, depart, dwell, direction, from, to, speed, every, enter }
//   arrive / depart — "ЧЧ:ММ" (ближайшее такое время), мс или дата ISO; для pass — когда поезд проходит остановку
//   (или середину видимого участка); dwell — стоянка, с (если нет depart); every — повтор, минуты;
//   enter — "now" (появиться и подойти сейчас) или "standing" (уже стоит у платформы); depart: null — стоять,
//   пока строку не уберут (так работает табло РЖД).
// @ts-check

/** @typedef {Record<string, any>} Row */

/**
 * @typedef {object} RowTimes
 * @property {number | null} arrive  мс симуляции: прибытие к остановке (или проход)
 * @property {number | null} depart  мс: отправление (null — стоять, пока не отпустят)
 * @property {number} end            мс: после этого строка закончилась (поезд ушёл)
 */

/**
 * Момент из значения строки: мс, Date, ISO-строка или "ЧЧ:ММ" (через nextAt часов).
 * @param {any} v @param {(hhmm: string, from?: number) => number} nextAt @param {number} from
 * @returns {number | null}
 */
export function parseTime(v, nextAt, from) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(v).trim())) return nextAt(String(v).trim(), from);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Времена строки относительно now. Для "ЧЧ:ММ": если поезд ещё стоит (прибыл, но не ушёл) — сегодняшний раз,
 * иначе ближайший будущий. Повтор every — ближайший незакончившийся раз.
 * @param {Row} row
 * @param {number} now
 * @param {(hhmm: string, from?: number) => number} nextAt  часы: ближайшее "ЧЧ:ММ" после from
 * @returns {RowTimes}
 */
export function rowTimes(row, now, nextAt) {
  const DAY = 86400000;
  const pass = row.action === "pass";
  const span = (/** @type {number} */ arrive) => {
    let depart = row.depart === null ? null : parseTime(row.depart, h => nextAt(h, arrive - 1), arrive);
    if (depart == null && row.depart !== null) depart = arrive + (pass ? 0 : (row.dwell ?? 60) * 1000);
    const end = depart == null ? Infinity : depart + (pass ? 60000 : 0);
    return { arrive, depart, end };
  };
  if (row.enter === "now" || row.enter === "standing") {
    const t = row.arrive != null ? parseTime(row.arrive, nextAt, now) : null;
    return span(t ?? now);
  }
  const hhmm = typeof row.arrive === "string" && /^\d{1,2}:\d{2}/.test(row.arrive.trim());
  let arrive = parseTime(row.arrive, nextAt, now - DAY);
  if (arrive == null) return { arrive: null, depart: null, end: -Infinity };
  if (hhmm) {
    // «вчерашний» раз мог ещё не закончиться (стоянка через полночь), иначе — ближайший
    const prev = nextAt(row.arrive.trim(), now - DAY);
    const cur = prev > now ? prev - DAY : prev;
    // с повтором отсчёт идёт от последнего раза (ниже ищется ближайший незакончившийся)
    arrive = row.every || span(cur).end > now ? cur : nextAt(row.arrive.trim(), now);
  }
  if (row.every) {
    const step = row.every * 60000;
    // первый раз — arrive; ищем ближайший незакончившийся
    let k = Math.max(0, Math.floor((now - arrive) / step) - 1);
    while (span(arrive + k * step).end <= now) k++;
    arrive += k * step;
  }
  return span(arrive);
}

/**
 * Сравнить расписания по id.
 * @param {Row[]} prev @param {Row[]} next
 * @returns {{added: Row[], removed: Row[], changed: {from: Row, to: Row}[], kept: Row[]}}
 */
export function diffRows(prev, next) {
  const before = new Map(prev.map(r => [String(r.id), r]));
  const after = new Map();
  /** @type {Row[]} */ const added = [];
  /** @type {{from: Row, to: Row}[]} */ const changed = [];
  /** @type {Row[]} */ const kept = [];
  for (const r of next) {
    const id = String(r.id);
    if (after.has(id)) { console.warn(`Расписание: повтор id «${id}» — строка пропущена`); continue; }
    after.set(id, r);
    const old = before.get(id);
    if (!old) added.push(r);
    else if (same(old, r)) kept.push(r);
    else changed.push({ from: old, to: r });
  }
  const removed = prev.filter(r => !after.has(String(r.id)));
  return { added, removed, changed, kept };
}

/** @param {any} a @param {any} b */
function same(a, b) {
  return JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
}

/**
 * Поменялось ли в строке только то, что можно применить к поезду на ходу (время отправления, табличка).
 * @param {Row} a @param {Row} b
 */
export function onlyTimesChanged(a, b) {
  const soft = new Set(["depart", "dwell", "info", "number", "from", "to"]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!soft.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}
