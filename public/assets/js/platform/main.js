// Вид «Платформа» в 3D: стоим на платформе и смотрим вдоль пути. Справа — хвост поезда, путь уходит
// к горизонту, над платформой — светодиодное табло с поездом, который сейчас прибывает или отправляется.
//
// Этот файл только собирает части вместе:
//   engine/   — движок: рендер по требованию, камера, свет, тени, небо, фильтры кадра;
//   stations/ — сцены станций (блокаут: объекты, ракурсы, пути, движение поездов);
//   prefabs/  — объекты сцены (платформа, путь, контактная сеть, фонари, здания, свои модели);
//   trains/   — вагоны, составы, движение поездов;
//   weather/  — погода;
//   board.js  — текст светодиодного табло.
// Данные табло, время суток и панель настроек — общие с видом «Вагон» (lib/app.js).
import { startApp } from "../lib/app.js";
import { noAnimation, onChange, settings } from "../lib/settings.js";
import { homography, updateBoard } from "./board.js";
import { Engine } from "./engine/engine.js";
import { buildScene } from "./scene/build.js";
import { STYLE } from "./style.js";
import { SCENES, sceneFor } from "./stations/index.js";
import { BoardTraffic, createTraffic } from "./trains/traffic.js";
import { WEATHER_LABELS } from "./weather/presets.js";
import { WeatherState } from "./weather/weather.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* ---------- движок ---------- */

const canvas = document.createElement("canvas");
canvas.id = "gl";
$("poster").prepend(canvas);
const engine = new Engine(canvas);
const loop = engine.loop;
const weather = new WeatherState(settings().weather);

/* ---------- состояние ---------- */

let app = null;                    // lib/app.js: табло, время суток, панель (создаётся ниже)
const state = {
  sceneDef: null, world: null, traffic: [], board: null,
  info: null, list: [], shown: null, current: undefined,
  env: null, celestial: null, lightKey: "",
};

/* ---------- табло: HTML натягивается на экран табло в сцене ---------- */

const boardEl = $("board");
function placeBoard() {
  const corners = state.world?.boardScreen;
  if (!corners) { boardEl.style.display = "none"; return; }
  const pts = corners.map(p => engine.project(p));
  const [a, b, , d] = corners;
  // экран смотрит от камеры (видим табло сзади) — прячем, иначе текст был бы зеркальным
  const n = [0, 0, 0], u = b.map((v, i) => v - a[i]), w = a.map((v, i) => v - d[i]);
  n[0] = u[1] * w[2] - u[2] * w[1]; n[1] = u[2] * w[0] - u[0] * w[2]; n[2] = u[0] * w[1] - u[1] * w[0];
  const cam = engine.camera.position, facing = (cam.x - a[0]) * n[0] + (cam.y - a[1]) * n[1] + (cam.z - a[2]) * n[2] > 0;
  if (!pts.every(Boolean) || !facing) { boardEl.style.display = "none"; return; }
  const h = Math.round(1200 * Math.hypot(a[1] - d[1], a[2] - d[2]) / Math.hypot(b[0] - a[0], b[2] - a[2]));
  if (boardEl.style.height !== `${h}px`) boardEl.style.height = `${h}px`;
  boardEl.style.display = "";
  boardEl.style.transform = homography(1200, h, ...pts);
}
engine.afterRender.push(layers => { if (layers.has("scene")) placeBoard(); });

/* ---------- сцена станции ---------- */

function loadScene(def) {
  if (state.sceneDef === def) return;
  for (const t of state.traffic) t.dispose();
  state.world?.dispose();
  state.sceneDef = def;
  const world = buildScene(def, { invalidate: (...l) => loop.invalidate(...l) });
  state.world = world;
  engine.scene.add(world.group);
  engine.rig.setPresets(def.cameras);
  engine.rig.use(params.get("cam") || "main");
  engine.rig.update(0);
  world.activate(engine);
  if (state.info) world.setStation(state.info);
  // ?train=fpk-double — показать у платформы этот состав, какой бы поезд ни был в табло (предпросмотр)
  const forced = params.get("train");
  const sceneDef = forced ? { ...def, trains: { ...def.trains, rules: [{ when: () => true, use: forced }] } } : def;
  state.traffic = createTraffic({
    engine, world, sceneDef,
    instant: () => noAnimation || document.hidden,
    onShow(item) {
      state.shown = item;
      updateBoard(Date.now(), item, state.list, state.info);
    },
  });
  state.board = state.traffic.find(t => t instanceof BoardTraffic) || null;
  for (const t of state.traffic) t.start?.();
  if (state.current !== undefined) state.board?.show(state.current);
  state.lightKey = "";
  applyEnvironment();
  app?.ui.refreshExtras();
  loop.invalidate("scene", "sky", "shadow");
}

/* ---------- свет, небо, погода ---------- */

function applyEnvironment() {
  if (!state.env || !state.celestial || !state.sceneDef) return;
  const env = weather.applyTo(state.env);
  engine.setEnvironment(env, state.celestial, weather.current, state.sceneDef.viewAzimuth);
  document.documentElement.style.setProperty("--lamps", engine.light.lamps.toFixed(3));
  syncSkyAnimations();
}

/** Облака плывут, пока они есть; дождь и снег идут, пока идут. Иначе — ни одного лишнего кадра. */
function syncSkyAnimations() {
  const w = weather.current;
  const clouds = STYLE.quality.skyFps > 0 && (w.cover > .02 || w.cirrus > .02) && w.cloudOpacity > .01 && !noAnimation;
  if (clouds && !loop.has("clouds")) {
    loop.animate("clouds", (now, dt) => {
      engine.sky.advance(dt, now / 1000, weather.current.wind);
      loop.invalidate("sky");
    }, STYLE.quality.skyFps);
  } else if (!clouds) loop.stop("clouds");
  const precip = (w.rain > .01 || w.snow > .01) && !noAnimation;
  if (precip && !loop.has("precip")) {
    loop.animate("precip", now => {
      engine.composite.uniforms.uTime.value = now / 1000;
      loop.invalidate("composite");
    }, STYLE.quality.precipFps);
  } else if (!precip) loop.stop("precip");
}

function setWeather(key, instant = false) {
  weather.set(key, { instant: instant || noAnimation });
  if (instant || noAnimation) return applyEnvironment();
  loop.animate("weather", () => {
    const moving = weather.step();
    applyEnvironment();
    return moving;
  }, 30);
}

/* ---------- камера за курсором ---------- */

function animateCamera() {
  if (loop.has("camera")) return;
  loop.animate("camera", (now, dt) => {
    const moving = engine.rig.update(dt);
    loop.invalidate("scene", "sky");
    return moving;
  });
}
addEventListener("pointermove", e => {
  if (noAnimation) return;
  engine.rig.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1);
  animateCamera();
});
addEventListener("resize", () => {
  engine.resize();
  engine.rig.update(0);
  loop.invalidate("scene", "sky");
});
// что-то загрузилось в фоне (модель вагона, текстура) — перерисовать сцену и тени
addEventListener("trainpaper:invalidate", () => loop.invalidate("scene", "shadow"));
// шрифт табличек и ливрей загрузился — перерисовать с ним
document.fonts?.ready.then(() => setTimeout(() => loop.invalidate("scene"), 50));

/* ---------- данные табло и время суток (общие с видом «Вагон») ---------- */

app = startApp({
  name: "platform",
  uiExtras: [
    { title: "Погода", key: "weather", options: WEATHER_LABELS },
    { title: "Сцена", key: "scene", options: () => [["auto", "По станции"], ...SCENES.map(s => [s.id, s.name])] },
    {
      title: "Ракурс", key: "camera",
      options: () => Object.keys(engine.rig.presets).map(k => [k, { main: "Основной", wide: "Общий", edge: "У края" }[k] || k]),
      value: () => engine.rig.name,
      select: name => { engine.rig.go(name, noAnimation ? 1 : 2400); animateCamera(); },
    },
  ],
  sky(env, celestial) {
    state.env = env;
    state.celestial = celestial;
    // свет и тени пересчитываем при заметном сдвиге солнца: в реальном времени — раз в ~20 с,
    // при предпросмотре и «сутках за минуту» — каждый кадр
    const s = celestial.sun, m = celestial.moon;
    const key = `${s.altitude.toFixed(1)}|${s.azimuth.toFixed(1)}|${env.lamps.toFixed(2)}|${m ? m.altitude.toFixed(0) : ""}`;
    if (key === state.lightKey) return;
    state.lightKey = key;
    applyEnvironment();
  },
  env() {},
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    if (stationChanged || !state.sceneDef) loadScene(sceneFor(info.id, settings().scene));
    if (info.name) state.world?.setStation(info);
    const first = state.current === undefined;
    state.current = current;
    if (changed || stationChanged || first) state.board?.show(current);
    else state.board?.update(current);
    updateBoard(Date.now(), state.shown ?? current, list, info);
  },
  tick(now) {
    updateBoard(now, state.shown, state.list, state.info);
  },
});

onChange((s, patch) => {
  if ("weather" in patch) setWeather(s.weather);
  if ("scene" in patch && state.info) loadScene(sceneFor(state.info.id, s.scene));
});

// сцена до прихода табло — по станции из настроек; поезд появится, когда придут данные
loadScene(sceneFor(settings().station, settings().scene));
setWeather(settings().weather, true);
requestAnimationFrame(() => $("poster").classList.add("ready"));

// для консоли разработчика: window.trainpaper.engine.rig.go("wide")
window.trainpaper = { engine, state, weather, loadScene, SCENES };
if (params.has("dev")) import("./dev.js").then(m => m.startDev({ engine, state, weather, loadScene }));
