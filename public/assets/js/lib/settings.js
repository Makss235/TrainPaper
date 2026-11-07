// Настройки обоев: станция, какие поезда показывать, время суток, погода и сцена «Платформы».
// Хранятся в браузере, параметры адреса (?station=1146&tod=night&weather=rain) важнее сохранённых.
// Вид «Вагон» погоду и сцену не использует — они просто хранятся.

const KEY = "trainpaper:settings";
const DEFAULTS = { station: 428, filter: "all", suburban: false, tod: "auto", weather: "partly", scene: "auto" };
const TOD = ["auto", "dawn", "day", "dusk", "night", "cycle"];
const FILTERS = ["all", "arrivals", "departures"];
const WEATHER = ["clear", "partly", "cloudy", "overcast", "rain", "snow", "fog"];

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
    weather: WEATHER.includes(s.weather) ? s.weather : DEFAULTS.weather,
    scene: typeof s.scene === "string" && /^[a-z0-9-]{1,40}$/.test(s.scene) ? s.scene : DEFAULTS.scene,
  };
}

const params = new URLSearchParams(location.search);
const fromUrl = Object.fromEntries(["station", "filter", "suburban", "tod", "weather", "scene"].filter(k => params.has(k)).map(k => [k, params.get(k)]));
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
