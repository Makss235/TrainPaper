// @ts-check
// Панель с поездом в углу обоев (элемент #info страницы): статус и обратный отсчёт, номер, маршрут,
// время, платформа и путь, опоздание, где поезд сейчас, следующие поезда.
// Общая для вида «Вагон» на движке (platform/) и прежней SVG-иллюстрации (flat/classic.html).
import { localTime } from "./app.js";
import { city, title } from "./names.js";
import { countdown, delayInfo, eventWord, headline, numberText, stopMinutes } from "./trains.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

function formatPlace(/** @type {any} */ train) {
  const parts = [train.platform ? `платф. ${train.platform}` : null, train.track ? `путь ${train.track}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "уточняется";
}

/**
 * Заполнить панель.
 * @param {number} now  момент, мс
 * @param {any} item  элемент табло, поезд которого показан (или null — поездов нет)
 * @param {any[]} list  все поезда табло (для «Дальше»)
 * @param {any} station  станция: { rzdName, utcOffset }
 */
export function updateInfo(now, item, list, station) {
  const info = $("info");
  if (!info) return;
  info.classList.toggle("empty", !item);
  if (!item || !station) return;
  const t = item.train, off = station.utcOffset;
  const arrival = item.event === "arrival";
  $("headline").textContent = headline(item);
  $("headline").classList.toggle("arrival", arrival);
  $("countdown").textContent = countdown(item, now);
  $("number").textContent = `№ ${numberText(t)}`;
  $("from").textContent = city(t.from);
  $("to").textContent = city(t.to);
  const ev = arrival ? t.arrival : t.departure;
  const plan = localTime(ev.plan * 1000, off), expected = localTime(ev.expected * 1000, off);
  $("kTime").textContent = eventWord(item);
  $("vTime").textContent = plan === expected ? plan : `${expected} (по расписанию ${plan})`;
  $("vPlace").textContent = formatPlace(t);
  const delay = delayInfo(item);
  const stop = t.kind === "transit" ? stopMinutes(t) : null;
  $("vDelay").textContent = delay.text + (stop != null && item.event === "departure" ? `, стоянка ${stop} мин` : "");
  $("vDelay").className = `v ${delay.level}`;
  const pos = t.position && t.position !== station.rzdName ? title(t.position) : null;
  $("kPos").textContent = t.status === "UNDEF" ? "Состав" : "Сейчас";
  $("vPos").textContent = pos ? `${pos}${t.positionTime ? `, ${localTime(t.positionTime * 1000, off)}` : ""}` :
    t.status === "UNDEF" ? "ещё не в пути" : "у платформы";
  const rest = (list || []).filter(x => x.train.id !== t.id).slice(0, 2);
  $("next").replaceChildren(...(rest.length ? [Object.assign(document.createElement("div"), { className: "title", textContent: "Дальше" })] : []),
    ...rest.map(x => {
      const row = document.createElement("div");
      row.className = "row";
      const other = x.event === "arrival" ? `из ${city(x.train.from)}` : `в ${city(x.train.to)}`;
      row.innerHTML = `<span class="t"></span><span class="n"></span><span class="d"></span>`;
      row.children[0].textContent = localTime(x.time, off);
      row.children[1].textContent = x.train.number;
      row.children[2].textContent = other;
      return row;
    }));
}

/** Плавно сменить содержимое панели: гаснет, меняется, проявляется (CSS: #info.swap). @param {() => void} change */
export function swapInfo(change) {
  const info = $("info");
  if (!info) { change(); return; }
  info.classList.add("swap");
  change();
  requestAnimationFrame(() => info.classList.remove("swap"));
}
