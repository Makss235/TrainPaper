// Кнопка станции в углу и панель настроек — общая для обоих видов.
import { searchStations } from "./api.js";
import { settings, update } from "./settings.js";
import { title } from "./names.js";

const TOD = [["auto", "Авто"], ["dawn", "Рассвет"], ["day", "День"], ["dusk", "Закат"], ["night", "Ночь"], ["cycle", "Сутки за минуту"]];
const FILTER = [["all", "Все"], ["arrivals", "Прибытие"], ["departures", "Отправление"]];
const VIEWS = [["flat", "Вагон"], ["platform", "Платформа"]];

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

function segmented(key, options) {
  const box = h("div", { class: "seg", role: "radiogroup" });
  for (const [value, label] of options) {
    box.append(h("button", {
      type: "button", role: "radio", "data-value": value,
      onclick: () => update({ [key]: value }),
    }, label));
  }
  const sync = () => box.querySelectorAll("button").forEach(b => {
    const on = b.dataset.value === settings()[key];
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  sync();
  return { box, sync };
}

export function createUI(root, { view }) {
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
  const suburban = h("input", { type: "checkbox", onchange: e => update({ suburban: e.target.checked }) });
  const status = h("div", { class: "status" });
  const panel = h("div", { class: "panel", role: "dialog", "aria-label": "Настройки обоев", hidden: true },
    h("div", { class: "search" }, input), results,
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Поезда"), filter.box,
      h("label", { class: "check" }, suburban, " пригородные поезда")),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Время суток"), tod.box),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Вид"),
      h("div", { class: "seg" }, VIEWS.map(([key, label]) =>
        h("a", { href: `../${key}/${location.search}`, class: key === view ? "on" : null }, label)))),
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
    filter.sync(); tod.sync();
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
    syncSettings() { filter.sync(); tod.sync(); suburban.checked = settings().suburban; },
    setStation(text, id) { name.textContent = text; currentId = id; },
    setClock(text, phaseLabel, preview) {
      clock.textContent = text;
      phase.textContent = phaseLabel;
      root.classList.toggle("preview", !!preview);
    },
    setFlag(text) { flag.textContent = text || ""; flag.hidden = !text; },
    setStatus(text) { status.textContent = text || ""; status.hidden = !text; },
  };
}
