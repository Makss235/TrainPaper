// Какой поезд сейчас «стоит у платформы» и что про него написать.

const ARRIVED_GRACE = 10 * 60000;     // прибывший поезд показываем ещё 10 минут
const DEPART_GRACE = 60000;           // ушедший — минуту

const ms = s => (s == null ? null : s * 1000);

/** Состояние поезда в момент now или null, если он уже не актуален. */
export function stateOf(train, now) {
  const A = ms(train.arrival?.expected), D = ms(train.departure?.expected);
  if (train.status === "OUT" && (!D || now > D)) return null;
  if (train.kind === "arrival") {
    if (now < A) return { phase: "arriving", event: "arrival", time: A };
    if (now < A + ARRIVED_GRACE) return { phase: "arrived", event: "arrival", time: A };
    return null;
  }
  if (train.kind === "departure") {
    if (now < D + DEPART_GRACE) return { phase: now < D ? "boarding" : "departing", event: "departure", time: D };
    return null;
  }
  const arrived = train.status === "IN" || train.status === "DEPARTING" || (A && now >= A);
  if (A && !arrived) return { phase: "arriving", event: "arrival", time: A };
  if (D && now < D + DEPART_GRACE) return { phase: now < D ? "stop" : "departing", event: "departure", time: D };
  return null;
}

const wanted = (state, filter) =>
  filter === "arrivals" ? state.event === "arrival" :
  filter === "departures" ? state.event === "departure" : true;

/** Ближайшие поезда: [{train, ...state}] по времени события. */
export function upcoming(trains, now, filter = "all") {
  return trains
    .map(train => ({ train, ...stateOf(train, now) }))
    .filter(item => item.phase && wanted(item, filter))
    .sort((a, b) => a.time - b.time || a.train.number.localeCompare(b.train.number));
}

export const pickCurrent = (trains, now, filter) => upcoming(trains, now, filter)[0] || null;

export function headline(item) {
  if (!item) return "";
  return {
    arriving: "Прибывает", arrived: "Прибыл", boarding: "Отправляется",
    stop: "Отправляется", departing: "Отправился",
  }[item.phase];
}

export const eventWord = item => (item?.event === "arrival" ? "Прибытие" : "Отправление");

export function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} ч ${String(rest).padStart(2, "0")} мин` : `${h} ч`;
}

export function countdown(item, now) {
  if (!item) return "";
  const minutes = (item.time - now) / 60000;
  if (Math.abs(minutes) < 1) return "сейчас";
  if (minutes > 0) return `через ${duration(minutes)}`;
  return `${duration(-minutes)} назад`;
}

/** Стоянка по расписанию (минуты). */
export function stopMinutes(train) {
  const A = train.arrival?.plan, D = train.departure?.plan;
  return A && D ? Math.max(0, Math.round((D - A) / 60)) : null;
}

/** Опоздание события: {text, level: ok|late|early} */
export function delayInfo(item) {
  if (!item) return { text: "", level: "ok" };
  const event = item.event === "arrival" ? item.train.arrival : item.train.departure;
  const diff = event ? Math.round((event.expected - event.plan) / 60) : 0;
  if (diff >= 1) return { text: `${item.event === "arrival" ? "опаздывает" : "задерживается"} на ${duration(diff)}`, level: "late", minutes: diff };
  if (diff <= -1) return { text: `раньше на ${duration(-diff)}`, level: "early", minutes: diff };
  return { text: "по расписанию", level: "ok", minutes: 0 };
}

/** Номер для таблички: «119А/120А», если номер меняется на станции. */
export const numberText = train => (train.numberChange ? `${train.number}/${train.numberChange}` : train.number);
