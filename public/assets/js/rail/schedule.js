// Расписание — компонент Schedule. Строки расписания превращаются в поезда TrainManager точно ко времени
// по часам симуляции (engine.time): поезд появляется заранее (на время подхода) и прибывает к своему времени.
//
//   { "name": "Расписание", "components": [ { "type": "Schedule", "manager": "Движение", "rows": [
//     { "id": "6601", "consist": "emu-fast", "track": "Путь 1", "stop": "Платформа 1", "action": "stop", "arrive": "14:05", "dwell": 40 },
//     { "id": "030А", "consist": "fpk-long", "track": "Путь 1", "action": "pass", "arrive": "14:20", "speed": 33 },
//     { "id": "гр-1", "consist": "freight", "track": "Путь 2", "action": "pass", "arrive": "14:32", "speed": 20, "direction": -1 } ] } ] }
//
// Источники строк: rows прямо в данных, файл src (JSONC: массив строк или { "rows": [...] }, путь — от папки assets/)
// или поставщик из кода: schedule.setSource(() => rows) — тогда schedule.refresh() перечитывает его (так подключено табло РЖД).
// Обновление = сравнение со старым расписанием (rail/schedule-diff.js): новая строка — запланировать появление;
// удалённая, но ещё не появившаяся — отменить; поезд уже на сцене — довести и убрать; изменилось время — пересчитать.
// Поля строки — см. rail/schedule-diff.js; direction — 1 (к росту s пути) или −1, approach — за сколько метров до
// остановки появиться, every — повтор каждые N минут, enter: "now" | "standing", depart: null — стоять до снятия строки.
// @ts-check
import { Component, loadData } from "../../../engine/index.js";
import { diffRows, onlyTimesChanged, rowTimes } from "./schedule-diff.js";

/**
 * @typedef {object} Plan
 * @property {Record<string, any>} row
 * @property {"planned" | "spawned" | "done"} state
 * @property {number | null} spawnAt   когда появится (мс симуляции)
 * @property {number | null} arrive
 * @property {number} end              когда строка этого раза заканчивается (мс)
 * @property {(() => void) | null} cancel
 * @property {any} entry               запись TrainManager
 */

export class Schedule extends Component {
  static type = "Schedule";
  static category = "Железная дорога";
  static doc = "Расписание: строки (прибытие, стоянка, проход) превращаются в поезда TrainManager точно ко времени по часам симуляции.";
  static props = {
    manager: { type: "component", component: "TrainManager", default: null, doc: "Менеджер поездов (по умолчанию — первый в сцене)" },
    rows: { type: "array", default: [], doc: "Строки расписания" },
    src: { type: "string", default: "", doc: "Файл расписания JSONC (путь от папки assets/)" },
    track: { type: "string", default: "", doc: "Путь по умолчанию для строк без track" },
    stop: { type: "string", default: "", doc: "Точка остановки по умолчанию для строк без stop" },
    lead: { type: "number", default: 0, doc: "Появляться раньше расчётного на столько секунд" },
  };

  /** @type {Record<string, any>[]} */
  rows = [];
  /** @type {Map<string, Plan>} */
  plans = new Map();
  /** @type {(() => Record<string, any>[] | Promise<Record<string, any>[]>) | null} */
  source = null;
  /** @type {any} TrainManager */
  manager = null;

  async start() {
    this.manager = this.props.manager ?? this.engine.scene.findComponent("TrainManager") ?? null;
    if (!this.manager) { this.warn("нет TrainManager в сцене — поезда не появятся"); return; }
    // перевели часы — незапущенные строки планируются заново (поезда на сцене доезжают как есть)
    this.on(this.time, "timeChanged", (/** @type {any} */ e) => { if (e.reason === "set") this.#replanAll(); });
    let rows = this.props.rows || [];
    if (this.props.src) {
      try {
        const url = this.engine.assets.url(this.props.src);
        const data = await loadData(url);
        rows = [...rows, ...(Array.isArray(data) ? data : data.rows || [])];
      } catch (error) {
        this.warn(`расписание ${this.props.src} не загрузилось: ${error.message}`);
      }
    }
    if (!this.source) this.setRows(rows);
    else this.refresh();
  }

  onChange(keys) {
    if (keys.includes("rows") && !this.source) this.setRows(this.props.rows);
  }

  onDestroy() {
    for (const p of this.plans.values()) p.cancel?.();
  }

  /** Поставщик строк из кода (например, табло РЖД). @param {() => Record<string, any>[] | Promise<Record<string, any>[]>} fn */
  setSource(fn) {
    this.source = fn;
    if (this.started) this.refresh();
  }

  /** Перечитать поставщика (синхронный поставщик применяется сразу, асинхронный — когда ответит). */
  refresh() {
    if (!this.source) return;
    try {
      const rows = this.source();
      if (rows && typeof (/** @type {any} */ (rows)).then === "function") {
        /** @type {Promise<Record<string, any>[]>} */ (rows).then(r => this.setRows(r), error => this.warn("поставщик расписания:", error));
      } else this.setRows(/** @type {Record<string, any>[]} */ (rows));
    } catch (error) {
      this.warn("поставщик расписания:", error);
    }
  }

  /** Панель инспектора (engine/dev/inspector.js). */
  inspectorPanel() {
    const T = this.time, pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
    const hm = (/** @type {number} */ ms) => { const d = new Date(ms + T.offsetAt(ms) * 60000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
    return {
      title: `Расписание — ${this.gameObject.name}`, empty: "строк нет",
      rows: this.entries().map(x => [`${x.arrive != null ? hm(x.arrive) : "—"} ${x.row.id} ${x.row.action || "stop"}`,
        `${x.state}${x.spawnAt ? ` · появится ${hm(x.spawnAt)}` : ""}`, x.entry?.go ?? null]),
    };
  }

  /** Строки и их состояние (для инспектора и табло). */
  entries() {
    return this.rows.map(row => {
      const p = this.plans.get(String(row.id));
      return { row, state: p?.state ?? "done", spawnAt: p?.spawnAt ?? null, arrive: p?.arrive ?? null, entry: p?.entry ?? null };
    });
  }

  /**
   * Новое расписание: сравнить со старым и применить разницу.
   * @param {Record<string, any>[]} rows
   */
  setRows(rows) {
    if (!this.manager) { this.rows = rows; return; }
    const d = diffRows(this.rows, rows);
    this.rows = rows;
    for (const r of d.removed) this.#drop(String(r.id));
    for (const { from, to } of d.changed) {
      const p = this.plans.get(String(to.id));
      if (p?.state === "spawned" && p.entry) {
        // поезд на сцене: время отправления и табличка — на ходу, остальное — со следующего раза
        if (!onlyTimesChanged(from, to)) this.log(`строка «${to.id}» изменилась, поезд уже в пути — применится со следующего раза`);
        p.row = to;
        const t = rowTimes(to, this.time.ms, (h, f) => this.time.nextAt(h, f));
        this.manager.updateTrain(p.entry.id, { departAt: t.depart, info: this.#info(to) });
      } else {
        this.#drop(String(to.id));
        this.#plan(to);
      }
    }
    for (const r of d.added) this.#plan(r);
  }

  #replanAll() {
    for (const [id, p] of [...this.plans]) {
      if (p.state !== "planned") continue;
      p.cancel?.();
      this.plans.delete(id);
      this.#plan(p.row);
    }
  }

  /** @param {string} id */
  #drop(id) {
    const p = this.plans.get(id);
    if (!p) return;
    p.cancel?.();
    if (p.state === "spawned" && p.entry) this.manager.release(p.entry.id);
    this.plans.delete(id);
  }

  /** @param {Record<string, any>} row */
  #info(row) {
    return row.info ?? { number: row.number ?? row.id, from: row.from ?? "", to: row.to ?? "" };
  }

  /** @param {Record<string, any>} row @param {import("./schedule-diff.js").RowTimes} t */
  #spec(row, t) {
    const now = this.time.ms;
    const standing = row.enter === "standing" || (row.enter !== "now" && row.action !== "pass" && t.arrive != null && now >= t.arrive);
    return {
      id: row.every ? `${row.id}@${t.arrive}` : String(row.id),
      consist: row.consist, number: row.number ?? String(row.id), info: this.#info(row), seed: row.seed ?? hash(String(row.id)),
      track: row.track || this.props.track || undefined, stop: row.stop || this.props.stop || undefined,
      action: /** @type {"stop" | "pass" | "stand"} */ (row.action === "pass" ? "pass" : standing ? "stand" : "stop"),
      dir: row.direction ?? 1, departAt: t.depart, speed: row.speed, from: row.approach,
      motion: row.motion,
      item: row.item,                                     // исходные данные строки (табло РЖД) — для DepartureBoard
    };
  }

  /**
   * Запланировать строку: ближайший незакончившийся раз после after (для повторов — после прошлого раза).
   * @param {Record<string, any>} row @param {number} [after]
   */
  #plan(row, after = -Infinity) {
    const id = String(row.id), now = this.time.ms;
    const t = rowTimes(row, Math.max(now, after), (h, f) => this.time.nextAt(h, f));
    if (t.arrive == null || t.end <= now || t.end <= after) return;
    const spec = this.#spec(row, t);
    /** @type {Plan} */
    const plan = { row, state: "planned", spawnAt: null, arrive: t.arrive, end: t.end, cancel: null, entry: null };
    this.plans.set(id, plan);
    const go = () => {
      if (this.plans.get(id) !== plan) return;
      plan.cancel = null;
      plan.state = "spawned";
      const s = this.#spec(row, t);                       // «уже стоит» — по моменту появления
      plan.entry = this.manager.spawn(s);
      plan.entry.done?.then(() => {
        if (this.plans.get(id) !== plan) return;
        plan.state = "done";
        // следующий раз: повтор every или «ЧЧ:ММ» завтра (абсолютное время второй раз не наступит)
        this.plans.delete(id);
        this.#plan(row, Number.isFinite(plan.end) ? plan.end : this.time.ms);
      });
    };
    if (spec.action === "stand" || row.enter === "now") { go(); return; }
    const lead = this.manager.leadTime(spec) + this.props.lead;
    plan.spawnAt = t.arrive - lead * 1000;
    if (now >= plan.spawnAt) go();
    else plan.cancel = this.at(plan.spawnAt, go);
  }
}

/** Зерно из строки (одинаковый грузовой для одной строки расписания). @param {string} s */
function hash(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647;
  return h || 1;
}
