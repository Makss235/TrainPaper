// Светодиодное табло над платформой: HTML с точечной маской, натянутое на экран табло в 3D
// (CSS matrix3d по четырём углам экрана). Текст остаётся настоящим текстом — чёткий при любом ракурсе.
//
// Бегущая строка движется шагами ровно в один светодиод (7 px), как на настоящем табло: буквы не
// «плывут» по сетке точек (нет мерцания), а браузеру нужно перерисовывать табло ~12 раз в секунду,
// а не каждый кадр, как при CSS-анимации.
import { localTime } from "../lib/app.js";
import { city, expand } from "../lib/names.js";
import { countdown, delayInfo, headline, numberText, stopMinutes } from "../lib/trains.js";

const $ = id => document.getElementById(id);

function fitRow(node, max) {
  node.style.fontSize = "";
  let size = parseFloat(getComputedStyle(node).fontSize);
  while (node.scrollWidth > max && size > 40) {
    size -= 4;
    node.style.fontSize = `${size}px`;
  }
}

const LED = 7;                      // шаг светодиодов на табло (как в маске .led), px
const STEP_MS = 85;                 // ≈ 80 px/с
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let tickerText = "", tickerX = 0, tickerW = 0, tickerTimer = 0;

function setTicker(text) {
  if (text === tickerText) return;
  tickerText = text;
  const node = $("bTicker");
  // две копии подряд: строка бежит без пустого начала и бесшовно повторяется
  node.replaceChildren(...[0, 1].map(() => Object.assign(document.createElement("span"), { textContent: `${text}   ●   ` })));
  tickerX = 0;
  tickerW = 0;
  node.style.transform = "translate3d(0,0,0)";
  if (!tickerTimer) tickerTimer = setInterval(stepTicker, STEP_MS);
}

function stepTicker() {
  if (document.hidden || reduceMotion.matches) return;
  const node = $("bTicker");
  if (!tickerW) tickerW = Math.round((node.firstChild?.offsetWidth || 0) / LED) * LED;
  if (!tickerW) return;
  tickerX -= LED;
  if (-tickerX >= tickerW) tickerX += tickerW;
  node.style.transform = `translate3d(${tickerX}px,0,0)`;
}
document.fonts?.ready.then(() => { tickerW = 0; });

/** Текст табло: что за поезд у платформы, когда, какой путь, опоздание и бегущая строка. */
export function updateBoard(now, item, list, info) {
  const board = $("board");
  if (!info) return;
  const off = info.utcOffset;
  $("bClock").textContent = localTime(now, off);
  board.classList.toggle("empty", !item);
  if (!item) {
    $("bKind").textContent = "ТАБЛО";
    $("bKind").className = "";
    $("bNum").textContent = "";
    $("bRoute").textContent = "ПОЕЗДОВ НЕТ";
    $("bTime").textContent = $("bPlace").textContent = $("bDelay").textContent = "";
    setTicker(`${expand(info.rzdName || info.name)} · ДАННЫЕ ОНЛАЙН-ТАБЛО РЖД`);
    return;
  }
  const t = item.train, arrival = item.event === "arrival";
  $("bKind").textContent = `${headline(item)} · ${countdown(item, now)}`;
  $("bKind").className = arrival ? "arrival" : "";
  $("bNum").textContent = numberText(t);
  $("bRoute").textContent = `${city(t.from)} — ${city(t.to)}`.toUpperCase();
  const ev = arrival ? t.arrival : t.departure;
  $("bTime").textContent = `${arrival ? "ПРИБ." : "ОТПР."} ${localTime(ev.expected * 1000, off)}`;
  $("bPlace").textContent = [t.track ? `ПУТЬ ${t.track}` : null, t.platform ? `ПЛ. ${t.platform}` : null].filter(Boolean).join(" · ") || "ПУТЬ УТОЧНЯЕТСЯ";
  const delay = delayInfo(item);
  $("bDelay").textContent = delay.text.toUpperCase();
  $("bDelay").className = delay.level;
  const stop = t.kind === "transit" && !arrival ? stopMinutes(t) : null;
  const rest = list.filter(x => x.train.id !== t.id).slice(0, 5).map(x =>
    `${localTime(x.time, off)} ${x.train.number} ${x.event === "arrival" ? "ИЗ " + city(x.train.from) : city(x.train.to)}`.toUpperCase());
  setTicker([
    `${expand(t.from)} — ${expand(t.to)}`,
    stop ? `СТОЯНКА ${stop} МИН` : null,
    t.position && t.position !== info.rzdName ? `СЕЙЧАС: ${t.position}` : null,
    rest.length ? `ДАЛЕЕ: ${rest.join(" · ")}` : null,
  ].filter(Boolean).join("   ●   "));
  fitRow($("bRoute"), 1140 - $("bNum").offsetWidth - 28);
  fitRow($("bSub"), 1140);
}

/** CSS matrix3d, который натягивает прямоугольник w×h на четырёхугольник p0…p3 (по часовой от левого верхнего). */
export function homography(w, h, [x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map(v => +v.toFixed(8)).join(",")})`;
}
