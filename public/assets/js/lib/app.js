// @ts-check
// Общий «движок» обоих видов: табло, выбор поезда, время суток станции, панель настроек.
import { BoardSource, stationById } from "./api.js";
import { celestial, dayMarks } from "./sun.js";
import { environment } from "./sky.js";
import { title } from "./names.js";
import { onChange, settings } from "./settings.js";
import { pickCurrent, upcoming } from "./trains.js";
import { createUI } from "./ui.js";

const POLL_MS = 30000;
const pad = n => String(n).padStart(2, "0");

/** Местное время станции «ЧЧ:ММ». */
export function localTime(msUtc, offsetMin) {
  const d = new Date(msUtc + offsetMin * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const DAY_MS = 86400000;
const CYCLE_SPEED = 1440;                 // «сутки за минуту»
const easeInOut = k => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

// опорные моменты суток считаются перебором — кэшируем на сутки станции
const marksCache = new Map();
function cachedMarks(nowMs, lat, lon, offset) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${offset},${Math.floor((nowMs + offset * 60000) / DAY_MS)}`;
  if (!marksCache.has(key)) {
    if (marksCache.size > 20) marksCache.clear();
    marksCache.set(key, dayMarks(nowMs, lat, lon, offset));
  }
  return marksCache.get(key);
}

/**
 * view: {
 *   name: "flat" | "platform",
 *   clock                              — необязательно: часы и небо движка { time: engine.time, sky: engine.environment,
 *                                        tween: o => engine.tween(o) }. Тогда режимы времени суток двигают только небо:
 *                                        «сутки за минуту» — sky.skyScale = 1440, «рассвет», «день»… — плавный сдвиг неба
 *                                        (sky.skyShift) к нужному моменту. Часы сцены идут как шли: поезда, расписание
 *                                        и таймеры скриптов не ускоряются и не сдвигаются.
 *                                        Без clock (вид «Вагон») — своё «показанное» время, как раньше.
 *   sky(env, sky, info, moment)        — каждый кадр, пока небо меняется: солнце, луна, градиент, облака;
 *                                        moment — показанный момент (мс), с учётом предпросмотра
 *   env(env, sky, info)                — освещение сцены (перекраска материалов, тени), не чаще ~15 раз в секунду
 *   train(current, list, board, info)  — сменился поезд у платформы (или табло обновилось)
 *   tick(now, current, list, info)     — раз в секунду: обратный отсчёт, часы
 *   uiExtras                           — необязательно: дополнительные группы панели настроек (см. ui.js)
 *   views                              — необязательно: группа «Вид» переключает вид на месте { key, options } (см. ui.js)
 * }
 */
export function startApp(view) {
  const ui = createUI(document.getElementById("ui"), { view: view.name, extras: view.uiExtras || [], views: view.views || null });
  const source = new BoardSource();
  const info = { id: null, name: "", rzdName: "", lat: 55.75, lon: 37.62, utcOffset: 180, demo: false, stale: false };
  let board = null, currentKey = undefined, pollTimer = 0, loadId = 0;
  let cycleStart = performance.now(), cycleBase = Date.now();
  // на сколько целых суток небо ушло от настоящего («сутки за минуту» прокручивает дни вперёд):
  // рассвет/день/закат/ночь берутся в тех сутках, что сейчас на небе, а не отматываются к сегодняшним
  let dayShift = 0;
  let shown = null, transition = null, lastLight = null, lastSkyKey = "", lastClock = "";
  const clock = view.clock || null;
  /** @type {AbortController | null} */
  let clockTween = null;
  let lastPlace = "";

  async function applyStation(id) {
    const known = await stationById(id);
    Object.assign(info, {
      id, name: known?.name || settings().stationName || "", rzdName: "",
      lat: known?.lat ?? info.lat, lon: known?.lon ?? info.lon, utcOffset: known?.utcOffset ?? 180,
    });
    ui.setStation(info.name || "…", id);
    if (clock) clock.time.utcOffset = info.utcOffset;
    board = null;
    currentKey = undefined;
    refresh(true);
  }

  async function refresh(stationChanged = false) {
    clearTimeout(pollTimer);
    const id = ++loadId;
    try {
      const data = await source.load(info.id, { suburban: settings().suburban });
      if (id !== loadId) return;
      board = data;
      const st = data.station || {};
      info.rzdName = st.name || "";
      if (!info.name && st.name) info.name = title(st.name);
      if (Number.isFinite(st.lat) && Number.isFinite(st.lon)) Object.assign(info, { lat: st.lat, lon: st.lon });
      if (Number.isFinite(st.utcOffset)) info.utcOffset = st.utcOffset;
      if (clock) clock.time.utcOffset = info.utcOffset;
      info.demo = !!data.demo;
      info.stale = !!data.stale;
      ui.setStation(info.name || "Станция", info.id);
      ui.setFlag(info.demo ? "демо" : info.stale ? "нет связи" : "");
      ui.setStatus(info.demo
        ? "Сервер не запущен — показано демо-расписание. Запустите python server/run.py и откройте http://localhost:8000."
        : info.stale ? "РЖД не отвечает, показаны последние полученные данные." : "");
      if (!data.trains?.length) ui.setStatus("На ближайшие сутки поездов дальнего следования нет.");
      pick(true, stationChanged);
    } catch (error) {
      if (id !== loadId) return;
      ui.setFlag("нет связи");
      ui.setStatus(`Не удалось получить табло: ${error.message}`);
      if (!board) pick(true, stationChanged);
    } finally {
      if (id === loadId) pollTimer = setTimeout(refresh, POLL_MS);
    }
  }

  function pick(boardUpdated = false, stationChanged = false) {
    const now = Date.now();
    const trains = board?.trains || [];
    const filter = settings().filter;
    const current = pickCurrent(trains, now, filter);
    const list = upcoming(trains, now, filter);
    const key = current ? current.train.id : null;
    if (key !== currentKey || boardUpdated) {
      const changed = key !== currentKey;
      currentKey = key;
      view.train(current, list, board, info, { changed, stationChanged });
    }
    view.tick(now, current, list, info);
  }

  /** Момент с выбранным ползунком временем суток (минуты от полуночи по времени станции) — ближайший к near. */
  function manualMoment(near) {
    const offset = info.utcOffset * 60000, dayStart = Math.floor((near + offset) / DAY_MS) * DAY_MS - offset;
    const t = dayStart + settings().time * 60000;
    return [t - DAY_MS, t, t + DAY_MS].reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
  }
  /** Сколько минут от полуночи по времени станции в момент ms. */
  const minutesOf = ms => Math.floor(((ms + info.utcOffset * 60000) % DAY_MS + DAY_MS) % DAY_MS / 60000);

  /** Момент, который должен быть на небе в выбранном режиме. */
  function goal(nowMs) {
    const mode = settings().tod;
    if (mode === "auto") return nowMs;
    if (mode === "cycle") return cycleBase + (performance.now() - cycleStart) * CYCLE_SPEED;
    if (mode === "manual") return manualMoment(shown ?? nowMs);
    const m = cachedMarks(nowMs + dayShift, info.lat, info.lon, info.utcOffset);
    const t = { dawn: m.sunrise + 12 * 60000, day: m.noon, dusk: m.sunset - 12 * 60000, night: m.midnight }[mode];
    if (shown == null) return t;
    // из t−сутки, t, t+сутки берём ближайший к тому, что сейчас на небе: переход идёт коротким путём
    return [t - DAY_MS, t, t + DAY_MS].reduce((a, b) => (Math.abs(b - shown) < Math.abs(a - shown) ? b : a));
  }

  /** Плавный переход: время на небе «прокручивается» от показанного момента к новому. */
  function startTransition() {
    if (shown == null) return;
    const from = shown, distance = Math.abs(goal(Date.now()) - from);
    transition = { from, start: performance.now(), dur: Math.min(4500, Math.max(1400, distance / (12 * 3600000) * 4200)) };
  }

  function moment(nowMs) {
    const target = goal(nowMs);
    if (!transition) return target;
    const k = (performance.now() - transition.start) / transition.dur;
    if (k >= 1) {
      transition = null;
      return target;
    }
    return transition.from + (target - transition.from) * easeInOut(k);
  }

  function frameSky(force = false) {
    const now = Date.now();
    shown = moment(now);
    const sky = celestial(new Date(shown), info.lat, info.lon);
    const env = environment(sky.sun.altitude, sky.rising);
    const clock = `${localTime(shown, info.utcOffset)}|${env.phase.label}|${settings().tod}`;
    if (clock !== lastClock) {
      lastClock = clock;
      ui.setClock(localTime(shown, info.utcOffset), env.phase.label, settings().tod !== "auto");
      ui.setTime(minutesOf(shown));
    }
    const skyKey = `${sky.sun.altitude.toFixed(3)}|${sky.sun.azimuth.toFixed(3)}|${sky.moon ? sky.moon.azimuth.toFixed(2) : ""}`;
    if (force || skyKey !== lastSkyKey) {
      lastSkyKey = skyKey;
      view.sky(env, sky, info, shown);
    }
    // перекраска сцены тяжелее неба: только при заметном сдвиге солнца и не чаще ~15 раз в секунду
    const t = performance.now(), l = lastLight;
    if (force || !l || (t - l.t > 66 && (Math.abs(env.alt - l.alt) > .04 || Math.abs(sky.sun.azimuth - l.az) > .25 ||
        Math.abs((sky.moon?.altitude ?? 0) - l.moon) > .5))) {
      lastLight = { t, alt: env.alt, az: sky.sun.azimuth, moon: sky.moon?.altitude ?? 0 };
      view.env(env, sky, info);
    }
  }

  // ---------- небо движка (вид «Платформа») ----------
  // Режимы времени суток двигают только небо (сдвиг и скорость неба относительно часов сцены): солнце, луна, свет
  // и тени меняются, а поезда, расписание и таймеры живут по часам сцены — те идут как шли.

  /** Перевести небо к моменту target плавно (tween по реальному времени), дальше оно идёт вместе с часами. */
  function clockTo(target, instant = false) {
    const S = clock.sky, T = clock.time;
    clockTween?.abort();
    clockTween = null;
    S.skyScale = 1;
    // «Сутки за минуту» могли увести небо на много дней вперёд. Целые сутки сбрасываются сразу (солнце в то же
    // время суток стоит там же), а плавно идёт только остаток — не больше полусуток, коротким путём.
    // Иначе возврат в «Авто» отматывал бы назад все накрученные дни.
    const days = Math.round((S.time - target) / DAY_MS) * DAY_MS;
    if (days) S.skyShift -= days;
    const from = S.skyShift, to = target - T.ms, distance = Math.abs(to - from);
    if (instant || distance < 1000) { S.skyShift = to; return; }
    const ac = (clockTween = new AbortController());
    const dur = Math.min(4500, Math.max(1400, distance / (12 * 3600000) * 4200));
    clock.tween({ from, to, duration: dur / 1000, ease: "inOutCubic", signal: ac.signal, onUpdate: v => { S.skyShift = v; } })
      .then(() => { if (clockTween === ac) clockTween = null; }, () => {});
  }

  /** Момент для режима tod относительно того, что сейчас на небе. */
  function clockGoal(mode) {
    const now = Date.now();
    if (mode === "auto") return now;
    const cur = clock.sky.time;
    if (mode === "manual") return manualMoment(cur);
    const m = cachedMarks(cur, info.lat, info.lon, info.utcOffset);
    const t = { dawn: m.sunrise + 12 * 60000, day: m.noon, dusk: m.sunset - 12 * 60000, night: m.midnight }[mode] ?? now;
    // из t−сутки, t, t+сутки — ближайший к показанному: переход идёт коротким путём
    return [t - DAY_MS, t, t + DAY_MS].reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
  }

  /** Режим времени суток → небо. */
  function applyClockMode(first = false) {
    const mode = settings().tod;
    if (mode === "cycle") { clockTween?.abort(); clockTween = null; clock.sky.skyScale = CYCLE_SPEED; return; }
    clockTo(clockGoal(mode), first || noMotion());
  }

  const noMotion = () => /[?&]anim=0/.test(location.search);

  /** Подпись часов (момент, который сейчас на небе) и место на Земле. */
  function frameClock(force = false) {
    const ms = clock.sky.time;
    const sky = celestial(new Date(ms), info.lat, info.lon);
    const env = environment(sky.sun.altitude, sky.rising);
    const label = `${localTime(ms, info.utcOffset)}|${env.phase.label}|${settings().tod}`;
    if (force || label !== lastClock) {
      lastClock = label;
      ui.setClock(localTime(ms, info.utcOffset), env.phase.label, settings().tod !== "auto");
    }
    ui.setTime(minutesOf(ms));
    const place = `${info.lat},${info.lon}`;
    if (force || place !== lastPlace) {
      const moved = lastPlace !== "";
      lastPlace = place;
      view.sky(env, sky, info, ms);
      // другая станция — свои рассвет и полдень: режим предпросмотра переводит часы заново
      if (moved && !["auto", "cycle"].includes(settings().tod)) applyClockMode();
    }
  }

  onChange((s, patch) => {
    ui.syncSettings();
    if ("station" in patch && patch.station !== info.id) return applyStation(s.station);
    if ("suburban" in patch) return refresh();
    if ("filter" in patch) pick(true);
    if (("tod" in patch || "time" in patch) && clock) {
      // ползунок — без плавного перехода: небо идёт за ним сразу
      applyClockMode("time" in patch);
      frameClock(true);
    } else if ("tod" in patch || "time" in patch) {
      cycleStart = performance.now();
      cycleBase = shown ?? Date.now();               // «сутки за минуту» продолжают с того, что уже на небе
      dayShift = shown == null ? 0 : Math.round((shown - Date.now()) / DAY_MS) * DAY_MS;
      // «Авто» — это настоящее «сейчас»: прокрученные сутки сбрасываются целиком (солнце стоит там же),
      // а переход идёт только по времени суток, не назад через все дни
      if (s.tod === "auto" && shown != null) { shown -= dayShift; dayShift = 0; }
      if (s.tod !== "cycle") startTransition();
    }
  });
  applyStation(settings().station);
  setInterval(() => pick(), 1000);
  if (clock) {
    // небо, свет и солнце движок считает сам — здесь только режим и подпись часов
    applyClockMode(true);
    frameClock(true);
    setInterval(() => frameClock(), 250);
    return { info, ui, refreshSky: () => frameClock(true) };
  }
  addEventListener("resize", () => frameSky(true));
  frameSky(true);
  // пока небо движется (сутки за минуту, переход) — каждый кадр; иначе солнце почти стоит — 4 раза в секунду
  (function skyLoop() {
    frameSky();
    if (transition || settings().tod === "cycle") requestAnimationFrame(skyLoop);
    else setTimeout(skyLoop, 250);
  })();
  return { info, ui, refreshSky: () => frameSky(true) };
}
