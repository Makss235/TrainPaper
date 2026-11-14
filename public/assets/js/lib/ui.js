// @ts-check
// Кнопка станции в углу и панель настроек — общая для обоих видов.
import { searchStations } from "./api.js";
import { settings, update } from "./settings.js";
import { title } from "./names.js";

const TOD = [["auto", "Авто"], ["dawn", "Рассвет"], ["day", "День"], ["dusk", "Закат"], ["night", "Ночь"], ["cycle", "Сутки за минуту"]];
const FILTER = [["all", "Все"], ["arrivals", "Прибытие"], ["departures", "Отправление"]];
// «Вид» ссылками (страница без движка): оба вида — страница «Платформа», 2D и 3D одной сцены
const VIEWS = [["2d", "Вагон"], ["3d", "Платформа"]];
/** Адрес вида: страница «Платформа» с теми же параметрами и нужным view. @param {string} view */
function viewHref(view) {
  const params = new URLSearchParams(location.search);
  params.set("view", view);
  return `../platform/?${params}`;
}

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter(c => c != null));
  return el;
};

/**
 * Группа кнопок-переключателей. По умолчанию переключает настройку key;
 * value() и select(v) — свой источник значения (например, ракурс камеры, который не сохраняется).
 * options — [[значение, подпись], ...] или функция, возвращающая такой список (перечитывается в rebuild).
 */
function segmented(key, options, { value = () => settings()[key], select = v => update({ [key]: v }) } = {}) {
  const box = h("div", { class: "seg", role: "radiogroup" });
  const rebuild = () => {
    const list = typeof options === "function" ? options() : options;
    box.replaceChildren(...list.map(([v, label]) => h("button", {
      type: "button", role: "radio", "data-value": v,
      onclick: () => { select(v); sync(); },
    }, label)));
    sync();
  };
  const sync = () => box.querySelectorAll("button").forEach(b => {
    const on = b.dataset.value === String(value());
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  rebuild();
  return { box, sync, rebuild };
}

/**
 * extras — дополнительные группы панели (их добавляет вид, например «Платформа»: погода, сцена, ракурс):
 *   [{ title, key, options, value?, select?, visible? }] — см. segmented(); visible() — показывать ли группу сейчас.
 * views — группа «Вид» переключает настройку на месте: { key, options } (см. segmented()); без неё «Вид» —
 *   ссылки на страницы видов.
 */
export function createUI(root, { view, extras = [], views = /** @type {any} */ (null) }) {
  const name = h("span", { class: "st-name" }, "…");
  const clock = h("span", { class: "st-clock" }, "--:--");
  const phase = h("span", { class: "st-phase" });
  const flag = h("span", { class: "st-flag" });
  const button = h("button", { class: "station-btn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
    name, h("span", { class: "st-meta" }, clock, phase, flag));

  const input = h("input", { type: "search", placeholder: "Найти станцию…", autocomplete: "off", spellcheck: "false", "aria-label": "Станция" });
  const results = h("ul", { class: "results", role: "listbox" });
  const filter = segmented("filter", FILTER);
  const tod = segmented("tod", TOD);
  // ползунок: точное время суток (по часам станции). Пока его двигают, небо идёт за ним; кнопки режимов — выше
  const pad = n => String(n).padStart(2, "0"), hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  let dragging = false;
  const timeLabel = h("output", { class: "time-value" }, "12:00");
  const timeSlider = h("input", { type: "range", class: "time-slider", min: "0", max: "1439", step: "5", "aria-label": "Время суток",
    oninput: e => { timeLabel.textContent = hhmm(+e.target.value); update({ tod: "manual", time: +e.target.value }); },
    onpointerdown: () => { dragging = true; }, onpointerup: () => { dragging = false; }, onchange: () => { dragging = false; } });
  const timeRow = h("div", { class: "time-row" }, timeSlider, timeLabel);
  const more = extras.map(x => ({ title: x.title, seg: segmented(x.key, x.options, x), visible: x.visible || (() => true), group: /** @type {any} */ (null) }));
  const showGroups = () => more.forEach(x => { x.group.hidden = !x.visible(); });
  const viewSeg = views ? segmented(views.key, views.options, views) : null;
  const suburban = h("input", { type: "checkbox", onchange: e => update({ suburban: e.target.checked }) });
  const status = h("div", { class: "status" });
  const panel = h("div", { class: "panel", role: "dialog", "aria-label": "Настройки обоев", hidden: true },
    h("div", { class: "search" }, input), results,
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Поезда"), filter.box,
      h("label", { class: "check" }, suburban, " пригородные поезда")),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Время суток"), tod.box, timeRow),
    more.map(x => (x.group = h("div", { class: "group" }, h("div", { class: "group-title" }, x.title), x.seg.box))),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Вид"),
      viewSeg ? viewSeg.box : h("div", { class: "seg" }, VIEWS.map(([key, label]) =>
        h("a", { href: viewHref(key), class: (key === "2d") === (view === "flat") ? "on" : null }, label)))),
    status,
    h("div", { class: "note" }, "Данные: онлайн-табло ", h("a", { href: "https://www.rzd.ru/ru/11497", target: "_blank", rel: "noopener" }, "rzd.ru")));

  root.append(button, panel);

  let searchAbort = null, searchTimer = 0, currentId = settings().station;
  async function runSearch() {
    searchAbort?.abort();
    searchAbort = new AbortController();
    let list;
    try {
      list = await searchStations(input.value, searchAbort.signal);
    } catch {
      return;
    }
    results.replaceChildren(...list.map(s => h("li", {
      role: "option", class: s.id === currentId ? "on" : null, tabindex: "0",
      onclick: () => choose(s), onkeydown: e => e.key === "Enter" && choose(s),
    }, h("span", { class: "r-name" }, s.popular ? s.name : title(s.name)),
    s.region ? h("span", { class: "r-region" }, s.region) : null)));
    if (!list.length) results.append(h("li", { class: "empty" }, input.value.trim().length < 2 ? "Введите название" : "Ничего не нашлось"));
  }
  function choose(s) {
    update({ station: s.id, stationName: s.popular ? s.name : title(s.name) });
    close();
  }
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 220);
  });

  function open() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    root.classList.add("open");
    suburban.checked = settings().suburban;
    filter.sync(); tod.sync(); viewSeg?.rebuild();
    more.forEach(x => x.seg.rebuild());
    showGroups();
    input.value = "";
    runSearch();
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  }
  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    root.classList.remove("open");
  }
  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  addEventListener("keydown", e => e.key === "Escape" && close());
  addEventListener("pointerdown", e => !root.contains(e.target) && close());

  return {
    syncSettings() { filter.sync(); tod.sync(); viewSeg?.sync(); more.forEach(x => x.seg.sync()); suburban.checked = settings().suburban; },
    refreshExtras() { viewSeg?.rebuild(); more.forEach(x => x.seg.rebuild()); showGroups(); },
    setStation(text, id) { name.textContent = text; currentId = id; },
    setClock(text, phaseLabel, preview) {
      clock.textContent = text;
      phase.textContent = phaseLabel;
      root.classList.toggle("preview", !!preview);
    },
    /** Время на небе, минуты от полуночи: ползунок следует за ним (кроме момента, когда его двигают). */
    setTime(minutes) {
      timeRow.classList.toggle("on", settings().tod === "manual");
      if (dragging) return;
      const m = Math.round(minutes / 5) * 5 % 1440;
      if (+timeSlider.value !== m) timeSlider.value = String(m);
      timeLabel.textContent = hhmm(Math.round(minutes) % 1440);
    },
    setFlag(text) { flag.textContent = text || ""; flag.hidden = !text; },
    setStatus(text) { status.textContent = text || ""; status.hidden = !text; },
  };
}
