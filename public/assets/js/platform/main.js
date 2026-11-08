// Вид «Платформа»: 3D-сцена станции на движке public/engine/ и данные онлайн-табло РЖД.
//
// Этот файл только связывает части:
//   движок (public/engine/)            — объекты, компоненты, рендер, окружение, погода;
//   содержимое (public/assets/)         — модели (models/), префабы (prefabs/), сцены (scenes/), составы (data/trains.jsonc);
//   компоненты приложения (components/) — путь, движение поездов, табло РЖД;
//   данные и панель (lib/app.js)        — общие с видом «Вагон».
import { Engine, loadData } from "../../../engine/index.js";
import { startApp } from "../lib/app.js";
import { noAnimation, onChange, settings } from "../lib/settings.js";
import { TrainCatalog } from "./catalog.js";
import { TrainTraffic } from "./components/index.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ASSETS = new URL("../../", import.meta.url).href;          // public/assets/

/* ---------- движок и содержимое ---------- */

const engine = new Engine({
  container: $("poster"),
  paths: { models: `${ASSETS}models/`, prefabs: `${ASSETS}prefabs/` },
  animate: !noAnimation,
});
engine.canvas.id = "gl";                                            // platform.css: плавное проявление
const [catalog, sceneIndex] = await Promise.all([
  TrainCatalog.load(`${ASSETS}data/trains.jsonc`),
  loadData(`${ASSETS}scenes/index.jsonc`),
]);
TrainTraffic.catalog = catalog;
TrainTraffic.instant = () => noAnimation || document.hidden;

/* ---------- состояние ---------- */

const state = { sceneId: null, info: null, list: [], shown: null, current: undefined, loading: null };
let app = null;

/** Сцена для станции: выбранная вручную или назначенная станции в scenes/index.jsonc, иначе по умолчанию. */
function sceneFor(stationId, choice = "auto") {
  const id = choice && choice !== "auto" ? choice : sceneIndex.stations?.[stationId] || sceneIndex.default;
  return sceneIndex.scenes.find(s => s.id === id) || sceneIndex.scenes.find(s => s.id === sceneIndex.default);
}

const boards = () => engine.scene.components("DepartureBoard");
const traffic = () => engine.scene.components("TrainTraffic").filter(t => t.props.role === "board");

function loadScene(entry) {
  if (state.sceneId === entry.id) return state.loading;
  state.sceneId = entry.id;
  state.loading = (async () => {
    await engine.load(`${ASSETS}scenes/${entry.file}`);
    if (params.get("cam")) engine.cameras.use(params.get("cam"));
    // ?train=fpk-double — показать у платформы этот состав, какой бы поезд ни был в табло
    if (params.get("train")) for (const t of traffic()) t.set({ force: params.get("train") });
    $("board").style.display = boards().length ? "" : "none";
    if (state.current !== undefined) for (const t of traffic()) t.show(state.current);
    app?.ui.refreshExtras();
  })();
  return state.loading;
}

engine.on("trainShown", ({ item }) => {
  state.shown = item;
  for (const b of boards()) b.update(Date.now(), item, state.list, state.info);
});

/* ---------- данные табло и время суток (общие с видом «Вагон») ---------- */

app = startApp({
  name: "platform",
  uiExtras: [
    { title: "Погода", key: "weather", options: () => engine.weather.presets },
    { title: "Сцена", key: "scene", options: () => [["auto", "По станции"], ...sceneIndex.scenes.map(s => [s.id, s.name])] },
    {
      title: "Ракурс", key: "camera",
      options: () => engine.cameras.list().map(c => [c.name, c.label]),
      value: () => engine.cameras.active?.gameObject.name,
      select: name => engine.cameras.use(name, noAnimation ? 0 : 2400),
    },
  ],
  // время на небе: сайт «прокручивает» его для предпросмотра — движок сам считает солнце и луну
  sky(env, sky, info, moment) {
    engine.environment.location = { lat: info.lat, lon: info.lon };
    engine.environment.setTime(moment ?? Date.now());
  },
  env() {},
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    if (stationChanged) loadScene(sceneFor(info.id, settings().scene));
    const first = state.current === undefined;
    state.current = current;
    for (const t of traffic()) (changed || stationChanged || first ? t.show(current) : t.update(current));
    for (const b of boards()) b.update(Date.now(), state.shown ?? current, list, info);
  },
  tick(now) {
    for (const b of boards()) b.update(now, state.shown, state.list, state.info);
  },
});

onChange((s, patch) => {
  if ("weather" in patch) engine.weather.set(s.weather);
  if ("scene" in patch && state.info) loadScene(sceneFor(state.info.id, s.scene));
});

// сцена до прихода табло — по станции из настроек; поезд появится, когда придут данные
engine.weather.set(settings().weather, { instant: true });
await loadScene(sceneFor(settings().station, settings().scene));
requestAnimationFrame(() => $("poster").classList.add("ready"));
engine.on("contextRestored", () => location.reload());

// консоль разработчика: trainpaper.engine.cameras.use("Общий"), trainpaper.engine.weather.set("snow")
window.trainpaper = { engine, state, catalog };
if (params.has("dev")) {
  import("../../../engine/dev/inspector.js").then(m => m.startInspector(engine, {
    actions: {
      "Смена поезда": () => traffic().forEach(t => { TrainTraffic.instant = () => false; t.replay(); }),
      "Транзит": () => {
        const tracks = engine.scene.components("RailTrack").map(r => r.gameObject.name);
        const board = traffic()[0]?.props.track;
        const host = engine.scene.find("Движение") || engine.scene.root;
        const t = host.addComponent("TrainTraffic", { role: "passing", track: tracks.find(n => n !== board) || tracks[0], first: 1e6 });
        t.pass();
      },
    },
  }));
}
