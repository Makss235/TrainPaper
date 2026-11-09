// @ts-check
import { demoBoard } from "./demo.js";

const API = new URL("../../../api/", import.meta.url);
const STATIONS = new URL("../../data/stations.json", import.meta.url);

let stationsPromise = null;
export function loadStations() {
  return stationsPromise ||= fetch(STATIONS).then(r => (r.ok ? r.json() : { stations: [] }))
    .then(d => d.stations || []).catch(() => []);
}

const norm = s => String(s || "").toUpperCase().replace(/Ё/g, "Е").replace(/[^0-9A-ZА-Я]+/g, " ").trim();

export async function stationById(id) {
  return (await loadStations()).find(s => s.id === id) || null;
}

/** Поиск станций: сначала популярные вокзалы из списка, затем подсказки РЖД. */
export async function searchStations(query, signal) {
  const q = norm(query);
  const list = await loadStations();
  const local = (q ? list.filter(s => norm(`${s.name} ${s.alias || ""}`).includes(q)) : list)
    .map(s => ({ id: s.id, name: s.name, region: s.alias || null, popular: true }));
  if (q.length < 2) return local;
  let remote = [];
  try {
    const response = await fetch(new URL(`stations?q=${encodeURIComponent(query)}`, API), { signal, cache: "no-store" });
    if (response.ok) remote = (await response.json()).stations || [];
  } catch (error) {
    if (error.name === "AbortError") throw error;
  }
  const seen = new Set(local.map(s => s.id));
  return [...local, ...remote.filter(s => !seen.has(s.id) && seen.add(s.id))].slice(0, 30);
}

export class BoardSource {
  constructor() {
    this.serverSeen = false;
    this.demo = false;
  }

  async load(stationId, { suburban = false } = {}) {
    if (!this.demo) {
      try {
        const url = new URL(`board?station=${stationId}${suburban ? "&suburban=1" : ""}`, API);
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) {
          this.serverSeen = true;
          return { ...(await response.json()), demo: false };
        }
        // сервер есть, но РЖД не ответила: это временный сбой, а не демо-режим
        if (response.status === 502 || response.status === 400) {
          this.serverSeen = true;
          const text = await response.json().catch(() => ({}));
          throw Object.assign(new Error(text.error || `Ошибка ${response.status}`), { temporary: true });
        }
        throw new Error(`api: ${response.status}`);
      } catch (error) {
        if (error.temporary || this.serverSeen) throw error;
        this.demo = true;                      // сервера нет — открыто как статический сайт
      }
    }
    const station = (await stationById(stationId)) || { id: stationId, name: "Станция" };
    return demoBoard(station);
  }
}
