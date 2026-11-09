// @ts-check
// Настоящая погода (вариант «Авто» в настройке «Погода»): раз в 30 минут — код погоды WMO и осадки
// для координат станции через свой сервер (/api/weather, кэш на сервере), затем пресет fromWmo и сила погоды.
// Без сервера (демо-режим) — «переменно».
import { fromWmo, wmoIntensity } from "../../../engine/index.js";

const API = new URL("../../../api/", import.meta.url);
const PERIOD_MS = 30 * 60000;

/**
 * @param {(key: string, intensity: number, raw: any) => void} apply  применить погоду (engine.weather.set)
 */
export function realWeather(apply) {
  let timer = 0, place = "", running = false, lat = 0, lon = 0;
  /** @type {AbortController | null} */
  let pending = null;

  async function load() {
    clearTimeout(timer);
    pending?.abort();
    const ac = (pending = new AbortController());
    try {
      const r = await fetch(new URL(`weather?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, API), { signal: ac.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const w = await r.json();
      if (running && ac === pending) apply(fromWmo(w.code, w.cloudCover), wmoIntensity(w.code, w.precipitation), w);
    } catch (error) {
      if (ac.signal.aborted) return;
      console.info("Настоящая погода недоступна — показываю «переменно»:", error.message);
      if (running) apply("partly", 1, null);
    } finally {
      if (running && ac === pending) timer = setTimeout(load, PERIOD_MS);
    }
  }

  return {
    /** Включить (или сменить станцию). @param {number} la @param {number} lo */
    start(la, lo) {
      const key = `${la.toFixed(2)},${lo.toFixed(2)}`;
      if (running && key === place) return;
      running = true; place = key; lat = la; lon = lo;
      load();
    },
    stop() {
      running = false; place = "";
      clearTimeout(timer);
      pending?.abort();
    },
    get running() { return running; },
  };
}
