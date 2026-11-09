// Вид «Платформа»: 3D-сцена станции на движке public/engine/ и данные онлайн-табло РЖД.
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
const instant = () => noAnimation || document.hidden;

/** Данные табло → источники расписания сцены (поезд подходит, стоит, уходит). */
function feed(/** @type {any} */ current, first = false) {
  for (const s of sources()) s.setBoard(current, { instant: first || instant() });
}

function loadScene(/** @type {any} */ entry) {
  if (state.sceneId === entry.id) return state.loading;
  state.sceneId = entry.id;
  state.loading = (async () => {
    await engine.load(`${ASSETS}scenes/${entry.file}`);
    if (params.get("cam")) engine.cameras.use(/** @type {string} */ (params.get("cam")));
    // ?train=fpk-double — показать у платформы этот состав, какой бы поезд ни был в табло
    if (params.get("train")) for (const s of sources()) s.set({ force: params.get("train") });
    $("board").style.display = boards().length ? "" : "none";
    // новая сцена: поезд с табло уже стоит у платформы
    if (state.current !== undefined) feed(state.current, true);
    app?.ui.refreshExtras();
  })();
  return state.loading;
}

engine.on("trainShown", () => {
  for (const b of boards()) b.refresh(Date.now(), state.list, state.info);
});

/* ---------- данные табло и время суток (общие с видом «Вагон») ---------- */

app = startApp({
  name: "platform",
  uiExtras: [
    { title: "Погода", key: "weather", options: () => [["auto", "Авто"], ...engine.weather.presets] },
    { title: "Сцена", key: "scene", options: () => [["auto", "По станции"], ...sceneIndex.scenes.map((/** @type {any} */ s) => [s.id, s.name])] },
    {
      title: "Ракурс", key: "camera",
      options: () => engine.cameras.list().map(c => [c.name, c.label]),
      value: () => engine.cameras.active?.gameObject.name,
      select: (/** @type {string} */ name) => engine.cameras.use(name, noAnimation ? 0 : 2400),
    },
  ],
  // время суток — часы движка: режимы предпросмотра переводят их (lib/app.js), солнце и луну движок считает сам
  clock: { time: engine.time, tween: (/** @type {any} */ o) => engine.tween(o) },
  sky(/** @type {any} */ env, /** @type {any} */ sky, /** @type {any} */ info) {
    engine.environment.setLocation(info.lat, info.lon);
    if (settings().weather === "auto") weather.start(info.lat, info.lon);
  },
  env() {},
  train(/** @type {any} */ current, /** @type {any[]} */ list, /** @type {any} */ board, /** @type {any} */ info, /** @type {any} */ { stationChanged }) {
    state.info = info;
    state.list = list;
    if (stationChanged) loadScene(sceneFor(info.id, settings().scene));
    // первый настоящий поезд уже стоит у платформы — это помнит сам RzdBoard
    state.current = current;
    feed(current);
    for (const b of boards()) b.refresh(Date.now(), list, info);
  },
  tick(/** @type {number} */ now) {
    for (const b of boards()) b.refresh(now, state.list, state.info);
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
  if ("scene" in patch && state.info) loadScene(sceneFor(state.info.id, s.scene));
});

// сцена до прихода табло — по станции из настроек; поезд появится, когда придут данные
applyWeather(settings().weather, true);
await loadScene(sceneFor(settings().station, settings().scene));
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
