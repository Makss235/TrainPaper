// Каталог составов: читает assets/data/trains.jsonc — какие бывают составы и какой показать
// для поезда с табло РЖД. Сам код не знает ни одного вагона — только данные.
// @ts-check
import { loadData, rng } from "../../../engine/index.js";

export class TrainCatalog {
  /** @param {string} url */
  static async load(url) {
    const c = new TrainCatalog();
    try {
      Object.assign(c, await loadData(url));
    } catch (error) {
      console.error("Каталог составов не загрузился:", error);
    }
    return c;
  }

  constructor() {
    /** @type {Record<string, {name?: string, consist: any[]}>} */
    this.types = {};
    /** @type {Record<string, string>[]} */
    this.rules = [];
    this.default = "fpk-long";
  }

  /**
   * Какой состав показать для поезда табло. extraRules — правила сцены (проверяются первыми).
   * @param {Record<string, any> | null | undefined} train
   * @param {Record<string, string>[]} [extraRules]
   */
  typeFor(train, extraRules = []) {
    if (!train) return this.default;
    for (const rule of [...extraRules, ...this.rules]) {
      const keys = Object.keys(rule).filter(k => k !== "use" && k !== "note");
      try {
        if (keys.every(k => new RegExp(rule[k], "i").test(String(train[k] ?? "")))) return rule.use;
      } catch (error) {
        console.warn("Правило состава с ошибкой:", rule, error);
      }
    }
    return this.default;
  }

  /**
   * Список вагонов состава от ХВОСТА к голове: [{ model, flip }].
   * @param {string} typeId
   * @param {number} [seed]  для случайной смеси (грузовой)
   */
  consist(typeId, seed = 1) {
    const type = this.types[typeId] || this.types[this.default];
    if (!type) return [];
    const random = rng(seed);
    /** @type {{model: string, flip: boolean}[]} */
    const list = [];
    const push = (/** @type {string} */ entry) => {
      const [model, ...flags] = entry.split(":");
      list.push({ model, flip: flags.includes("flip") });
    };
    for (const e of type.consist) {
      if (typeof e === "string") push(e);
      else if (e.repeat) for (let i = 0; i < e.repeat; i++) push(e.model);
      else if (e.random) {
        const [a, b] = e.count || [10, 20], n = a + Math.floor(random() * (b - a + 1));
        let kind = e.random[Math.floor(random() * e.random.length)];
        for (let i = 0; i < n; i++) {
          if (random() < (e.groups ?? .25)) kind = e.random[Math.floor(random() * e.random.length)];
          push(kind);
        }
      }
    }
    return list.reverse();
  }
}
