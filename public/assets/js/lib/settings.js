// Настройки обоев: станция, какие поезда показывать, время суток. Хранятся в браузере,
// параметры адреса (?station=1146&tod=night) важнее сохранённых.

const KEY = "trainpaper:settings";
const DEFAULTS = { station: 428, filter: "all", suburban: false, tod: "auto" };
const TOD = ["auto", "dawn", "day", "dusk", "night", "cycle"];
const FILTERS = ["all", "arrivals", "departures"];

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function sanitize(s) {
  const station = Number.parseInt(s.station, 10);
  return {
    station: Number.isFinite(station) && station > 0 ? station : DEFAULTS.station,
    stationName: typeof s.stationName === "string" ? s.stationName : null,
    filter: FILTERS.includes(s.filter) ? s.filter : DEFAULTS.filter,
    suburban: s.suburban === true || s.suburban === "1" || s.suburban === "true",
    tod: TOD.includes(s.tod) ? s.tod : DEFAULTS.tod,
  };
}

const params = new URLSearchParams(location.search);
const fromUrl = Object.fromEntries(["station", "filter", "suburban", "tod"].filter(k => params.has(k)).map(k => [k, params.get(k)]));
let current = sanitize({ ...DEFAULTS, ...read(), ...fromUrl });
const listeners = new Set();

export const settings = () => current;
export const noAnimation = params.get("anim") === "0";

export function update(patch) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* приватный режим — ничего страшного */ }
  if (params.has("station") && "station" in patch) {         // чтобы обновление страницы не вернуло старую станцию
    params.set("station", current.station);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  listeners.forEach(fn => fn(current, patch));
}

export const onChange = fn => listeners.add(fn);
