// @ts-check
// Настройки обоев: станция, какие поезда показывать, время суток, погода, сцена и вид (3D или 2D) «Платформы».
// Хранятся в браузере, параметры адреса (?station=1146&tod=night&weather=rain) важнее сохранённых.
// Вид «Вагон» погоду и сцену не использует — они просто хранятся.

const KEY = "trainpaper:settings";
const DEFAULTS = { station: 428, filter: "all", suburban: false, tod: "auto", time: 720, weather: "partly", scene: "auto", view: "3d", platform: "auto" };
const VIEWS = ["3d", "2d"];                 // 3d — с платформы в перспективе, 2d — плоский вид сбоку на хвост поезда
// manual — время суток выбрано ползунком: time — минуты от полуночи по времени станции
const TOD = ["auto", "dawn", "day", "dusk", "night", "cycle", "manual"];
const FILTERS = ["all", "arrivals", "departures"];
const WEATHER = ["auto", "clear", "partly", "cloudy", "overcast", "rain", "snow", "fog"];   // auto — настоящая погода станции

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") || {};
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
    time: Number.isFinite(+s.time) ? Math.min(1439, Math.max(0, Math.round(+s.time))) : DEFAULTS.time,
    weather: WEATHER.includes(s.weather) ? s.weather : DEFAULTS.weather,
    scene: typeof s.scene === "string" && /^[a-z0-9-]{1,40}$/.test(s.scene) ? s.scene : DEFAULTS.scene,
    view: VIEWS.includes(s.view) ? s.view : DEFAULTS.view,
    // тип платформы вида «Вагон»: auto — по станции, иначе имя типа из scenes/index.jsonc (flatPlatformKinds)
    platform: typeof s.platform === "string" && /^[a-z0-9-]{1,30}$/.test(s.platform) ? s.platform : DEFAULTS.platform,
  };
}

const params = new URLSearchParams(location.search);
const fromUrl = Object.fromEntries(["station", "filter", "suburban", "tod", "time", "weather", "scene", "view", "platform"].filter(k => params.has(k)).map(k => [k, params.get(k)]));
let current = sanitize({ ...DEFAULTS, ...read(), ...fromUrl });
const listeners = new Set();

export const settings = () => current;
export const noAnimation = params.get("anim") === "0";

export function update(patch) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* приватный режим — ничего страшного */ }
  // чтобы обновление страницы не вернуло старую станцию или прежний вид (параметры адреса важнее сохранённых)
  let urlChanged = false;
  for (const key of ["station", "view"]) {
    if (!params.has(key) || !(key in patch)) continue;
    params.set(key, String(current[key]));
    urlChanged = true;
  }
  if (urlChanged) history.replaceState(null, "", `${location.pathname}?${params}`);
  listeners.forEach(fn => fn(current, patch));
}

export const onChange = fn => listeners.add(fn);
