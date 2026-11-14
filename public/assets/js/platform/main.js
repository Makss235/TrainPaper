// Обои на движке public/engine/ и данные онлайн-табло РЖД. Два вида (кнопка «Вид», настройка view):
//   «Платформа» (3D) — сцена станции: стоим на платформе, поезд рядом, путь уходит к горизонту;
//   «Вагон» (2D)     — плоская сцена из спрайтов (scenes/flat.jsonc): хвост поезда в правом нижнем углу,
//                      панель с поездом — в левом верхнем, остальное — небо. Одна для всех станций.
// Вид меняется на месте: загружается другая сцена, прежний кадр растворяется в новом.
//
// Этот файл только связывает части:
//   движок (public/engine/)            — объекты, компоненты, рендер, окружение, погода, часы симуляции;
//   содержимое (public/assets/)         — модели (models/), префабы (prefabs/), сцены (scenes/), скрипты (scripts/),
//                                         составы (data/trains.jsonc);
//   железная дорога (rail/)             — пути, поезда, движение, менеджер, расписание, табло РЖД как источник;
//   компоненты приложения (components/) — табло на платформе;
//   данные и панель (lib/app.js)        — общие с видом «Вагон».
// @ts-check
import { Engine, loadData } from "../../../engine/index.js";
import { startApp } from "../lib/app.js";
import { swapInfo, updateInfo } from "../lib/info.js";
import { noAnimation, onChange, settings } from "../lib/settings.js";
import { Train, TrainCatalog } from "../rail/index.js";
import "./components/index.js";
import { realWeather } from "../lib/weather.js";
import { Plate } from "./plate.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);
const ASSETS = new URL("../../", import.meta.url).href;          // public/assets/

/* ---------- движок и содержимое ---------- */

const engine = new Engine({
  container: $("poster"),
  paths: { assets: ASSETS, models: `${ASSETS}models/`, prefabs: `${ASSETS}prefabs/`, scripts: `${ASSETS}scripts/` },
  animate: !noAnimation,
});
engine.canvas.id = "gl";                                            // platform.css: плавное проявление
const [catalog, sceneIndex] = await Promise.all([
  TrainCatalog.load(`${ASSETS}data/trains.jsonc`),
  loadData(`${ASSETS}scenes/index.jsonc`),
]);
Train.catalog = catalog;
Train.Plate = Plate;

/* ---------- состояние ---------- */

// настоящая погода станции (вариант «Авто»): сервер /api/weather → пресет и сила
const weather = realWeather((key, intensity) => engine.weather.set(key, { intensity, instant: !engine.weather.userSet }));

/** @type {{sceneId: string | null, info: any, list: any[], current: any, loading: Promise<void> | null}} */
const state = { sceneId: null, info: null, list: [], current: undefined, loading: null };
/** @type {any} */
let app = null;
/** @type {any} */ (window).trainpaper = { engine, state, catalog };

/** Сцена для станции: выбранная вручную или назначенная станции в scenes/index.jsonc, иначе по умолчанию. */
function sceneFor(/** @type {string | number} */ stationId, choice = "auto") {
  const id = choice && choice !== "auto" ? choice : sceneIndex.stations?.[stationId] || sceneIndex.default;
  return sceneIndex.scenes.find((/** @type {any} */ s) => s.id === id) || sceneIndex.scenes.find((/** @type {any} */ s) => s.id === sceneIndex.default);
}

const boards = () => /** @type {any[]} */ (engine.scene.components("DepartureBoard"));
const sources = () => /** @type {any[]} */ (engine.scene.components("RzdBoard"));
const flatTrains = () => /** @type {any[]} */ (engine.scene.components("FlatTrain"));
const instant = () => noAnimation || document.hidden;

/* ---------- вид: «Платформа» (3D-сцена станции) или «Вагон» (плоская сцена из спрайтов) ---------- */

/** Плоская сцена — одна для всех станций (scenes/index.jsonc, поле flat). */
const FLAT = { id: "flat", name: "Вагон", file: sceneIndex.flat || "flat.jsonc" };
const flat = () => settings().view === "2d";
/** Что показывать: при виде «Вагон» — плоскую сцену, иначе сцену станции. */
const wanted = (/** @type {string | number} */ stationId) => (flat() ? FLAT : sceneFor(stationId, settings().scene));

/** Типы платформы плоской сцены: [имя, подпись] (scenes/index.jsonc, flatPlatformKinds). */
const PLATFORMS = /** @type {string[][]} */ (sceneIndex.flatPlatformKinds || [["open", "Открытая"]]);
/**
 * Тип платформы плоской сцены: выбранный в панели, а при «По станции» — по 3D-сцене станции
 * (scenes/index.jsonc, flatPlatforms); по умолчанию — первый тип.
 */
function platformKind(/** @type {string | number} */ stationId) {
  const chosen = settings().platform;
  if (PLATFORMS.some(([id]) => id === chosen)) return chosen;
  return sceneIndex.flatPlatforms?.[sceneFor(stationId, settings().scene)?.id] || PLATFORMS[0][0];
}
let shownPlatform = "";

/** Показать платформу нужного типа: объекты с меткой "platform:<тип>" включаются, остальные "platform:…" — выключаются. */
function applyPlatform(/** @type {string | number} */ stationId, smooth = false) {
  if (state.sceneId !== FLAT.id) return;
  const kind = platformKind(stationId);
  const change = () => {
    for (const go of engine.scene.findAll((/** @type {any} */ o) => o.tags.some((/** @type {string} */ t) => t.startsWith("platform:")))) {
      go.setActive(go.tags.includes(`platform:${kind}`));
    }
    shownPlatform = kind;
  };
  // другая станция с другой платформой — растворением, а не рывком
  if (smooth && shownPlatform && shownPlatform !== kind && !noAnimation) engine.dissolve(change, 800);
  else change();
}

/** Данные табло → сцена: источники расписания 3D-сцены (поезд подходит, стоит, уходит) или поезд плоской сцены. */
function feed(/** @type {any} */ current, first = false) {
  const quick = first || instant();
  for (const s of sources()) s.setBoard(current, { instant: quick });
  for (const t of flatTrains()) t.show(current, { instant: quick });
}

/** Панель с поездом (вид «Вагон»): показывает поезд, который сейчас на экране. */
function refreshInfo(now = Date.now()) {
  if (state.sceneId !== FLAT.id) return;
  updateInfo(now, flatTrains()[0]?.shown ?? null, state.list, state.info);
}

/** Загрузить сцену. Если на экране уже есть другая — прежний кадр растворяется в новом (engine.dissolve). */
function loadScene(/** @type {any} */ entry) {
  if (state.sceneId === entry.id) return state.loading;
  const first = state.sceneId === null;
  state.sceneId = entry.id;
  const load = async () => {
    await engine.load(`${ASSETS}scenes/${entry.file}`);
    if (state.sceneId !== entry.id) return;                          // пока грузилась, выбрали другую сцену
    if (params.get("cam")) engine.cameras.use(/** @type {string} */ (params.get("cam")));
    // ?train=fpk-double — показать у платформы этот состав, какой бы поезд ни был в табло
    if (params.get("train")) for (const s of sources()) s.set({ force: params.get("train") });
    $("poster").classList.toggle("view-2d", entry.id === FLAT.id);
    shownPlatform = "";
    applyPlatform(state.info?.id ?? settings().station);
    $("board").style.display = boards().length ? "" : "none";
    // новая сцена: поезд с табло уже стоит у платформы
    if (state.current !== undefined) feed(state.current, true);
    refreshInfo();
    app?.ui.refreshExtras();
  };
  state.loading = first || noAnimation ? load() : engine.dissolve(load, 900);
  return state.loading;
}

engine.on("trainShown", () => {
  for (const b of boards()) b.refresh(Date.now(), state.list, state.info);
});
// плоская сцена: поезд на экране сменился (прежний уже уехал) — панель гаснет и проявляется с новыми данными
engine.on("flatTrain", () => swapInfo(() => refreshInfo()));
// днём панель читается на светлом небе благодаря тёмной подложке (CSS: --day)
engine.on("environment", (/** @type {any} */ e) => $("poster").style.setProperty("--day", e.env.day.toFixed(2)));

/* ---------- данные табло и время суток (общие с видом «Вагон») ---------- */

app = startApp({
  name: "platform",
  uiExtras: [
    { title: "Погода", key: "weather", options: () => [["auto", "Авто"], ...engine.weather.presets] },
    // тип платформы — у вида «Вагон»: по станции или выбранный вручную
    { title: "Платформа", key: "platform", visible: () => flat(), options: () => [["auto", "По станции"], ...PLATFORMS] },
    // сцена станции и ракурсы — у вида «Платформа»; у «Вагона» сцена одна и ракурс один
    { title: "Сцена", key: "scene", visible: () => !flat(), options: () => [["auto", "По станции"], ...sceneIndex.scenes.map((/** @type {any} */ s) => [s.id, s.name])] },
    {
      title: "Ракурс", key: "camera", visible: () => !flat(),
      options: () => engine.cameras.list().map(c => [c.name, c.label]),
      value: () => engine.cameras.active?.gameObject.name,
      select: (/** @type {string} */ name) => engine.cameras.use(name, noAnimation ? 0 : 2400),
    },
  ],
  // «Вид» переключает «Вагон» и «Платформу» на месте, без перехода на другую страницу
  views: { key: "view", options: [["2d", "Вагон"], ["3d", "Платформа"]] },
  // время суток: режимы предпросмотра двигают только небо движка (lib/app.js), часы сцены и поезда идут как шли
  clock: { time: engine.time, sky: engine.environment, tween: (/** @type {any} */ o) => engine.tween(o) },
  sky(/** @type {any} */ env, /** @type {any} */ sky, /** @type {any} */ info) {
    engine.environment.setLocation(info.lat, info.lon);
    if (settings().weather === "auto") weather.start(info.lat, info.lon);
  },
  env() {},
  train(/** @type {any} */ current, /** @type {any[]} */ list, /** @type {any} */ board, /** @type {any} */ info, /** @type {any} */ { stationChanged }) {
    state.info = info;
    state.list = list;
    if (stationChanged) { loadScene(wanted(info.id)); applyPlatform(info.id, true); }
    // первый настоящий поезд уже стоит у платформы — это помнит сам RzdBoard
    state.current = current;
    feed(current);
    for (const b of boards()) b.refresh(Date.now(), list, info);
    refreshInfo();
  },
  tick(/** @type {number} */ now) {
    for (const b of boards()) b.refresh(now, state.list, state.info);
    refreshInfo(now);
  },
});

/** Погода: выбранный пресет или настоящая погода станции («Авто»). @param {string} key */
function applyWeather(key, instant = false) {
  if (key === "auto") { if (state.info) weather.start(state.info.lat, state.info.lon); return; }
  weather.stop();
  engine.weather.set(key, { instant });
}

onChange((/** @type {any} */ s, /** @type {any} */ patch) => {
  if ("weather" in patch) applyWeather(s.weather);
  if (("scene" in patch || "view" in patch) && state.info) loadScene(wanted(state.info.id));
  if ("view" in patch) app?.ui.refreshExtras();
  if ("platform" in patch) applyPlatform(state.info?.id ?? s.station, true);
});

// сцена до прихода табло — по станции из настроек; поезд появится, когда придут данные
applyWeather(settings().weather, true);
await loadScene(wanted(settings().station));
requestAnimationFrame(() => $("poster").classList.add("ready"));
engine.on("contextRestored", () => location.reload());

// консоль разработчика: trainpaper.engine.cameras.use("Общий"), trainpaper.engine.weather.set("snow"),
// trainpaper.engine.time.scale = 60
if (params.has("dev")) {
  import("../../../engine/dev/inspector.js").then(m => m.startInspector(engine, {
    actions: {
      "Смена поезда": () => sources().forEach(s => s.replay()),
      "Транзит": () => {
        const manager = /** @type {any} */ (engine.scene.findComponent("TrainManager"));
        const tracks = engine.scene.components("Track").map(r => r.gameObject.name);
        const busy = sources()[0]?.props.track;
        manager?.spawn({ id: `транзит-${Date.now()}`, consist: "freight", seed: Date.now() % 1000, action: "pass", speed: 20,
          track: tracks.find(n => n !== busy) || tracks[0], dir: 1 });
      },
    },
  }));
}
