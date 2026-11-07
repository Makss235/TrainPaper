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

/**
 * view: {
 *   name: "flat" | "platform",
 *   env(env, sky, info)                — освещение поменялось (раз в секунду, только если заметно)
 *   train(current, list, board, info)  — сменился поезд у платформы (или табло обновилось)
 *   tick(now, current, list, info)     — раз в секунду: обратный отсчёт, часы
 * }
 */
export function startApp(view) {
  const ui = createUI(document.getElementById("ui"), { view: view.name });
  const source = new BoardSource();
  const info = { id: null, name: "", rzdName: "", lat: 55.75, lon: 37.62, utcOffset: 180, demo: false, stale: false };
  let board = null, currentKey = undefined, pollTimer = 0, loadId = 0;
  let cycleStart = performance.now(), cycleBase = Date.now(), lastEnvKey = "";

  async function applyStation(id) {
    const known = await stationById(id);
    Object.assign(info, {
      id, name: known?.name || settings().stationName || "", rzdName: "",
      lat: known?.lat ?? info.lat, lon: known?.lon ?? info.lon, utcOffset: known?.utcOffset ?? 180,
    });
    ui.setStation(info.name || "…", id);
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

  function skyMoment(nowMs) {
    const mode = settings().tod;
    if (mode === "auto") return nowMs;
    if (mode === "cycle") return cycleBase + (performance.now() - cycleStart) * 1440;   // сутки за минуту
    const marks = dayMarks(nowMs, info.lat, info.lon, info.utcOffset);
    return { dawn: marks.sunrise + 12 * 60000, day: marks.noon, dusk: marks.sunset - 12 * 60000, night: marks.midnight }[mode];
  }

  function frameSky() {
    const now = Date.now();
    const moment = skyMoment(now);
    const sky = celestial(new Date(moment), info.lat, info.lon);
    const env = environment(sky.sun.altitude, sky.rising);
    const preview = settings().tod !== "auto";
    ui.setClock(localTime(moment, info.utcOffset), env.phase.label, preview);
    const key = `${env.alt.toFixed(2)}|${sky.moon ? sky.moon.altitude.toFixed(1) : ""}|${innerWidth}x${innerHeight}`;
    if (key !== lastEnvKey) {
      lastEnvKey = key;
      view.env(env, sky, info, new Date(moment));
    }
  }

  onChange((s, patch) => {
    ui.syncSettings();
    if ("station" in patch && patch.station !== info.id) return applyStation(s.station);
    if ("suburban" in patch) return refresh();
    if ("filter" in patch) pick(true);
    if ("tod" in patch) {
      cycleStart = performance.now();
      cycleBase = Date.now();
      lastEnvKey = "";
      frameSky();
    }
  });
  addEventListener("resize", () => { lastEnvKey = ""; });

  applyStation(settings().station);
  frameSky();
  setInterval(() => pick(), 1000);
  (function skyLoop() {
    frameSky();
    setTimeout(skyLoop, settings().tod === "cycle" ? 100 : 1000);
  })();
  return { info };
}
