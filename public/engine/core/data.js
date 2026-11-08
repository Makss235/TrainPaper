// Данные сцен и префабов: JSONC (JSON с комментариями), загрузка, слияние, разбор значений.
// @ts-check

/**
 * JSON с комментариями (// и /* *\/) и висячими запятыми → объект.
 * Комментарии внутри строк не трогаются.
 * @param {string} text
 * @returns {any}
 */
export function parseJsonc(text) {
  let out = "", i = 0, inString = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === "\"") inString = false;
      i++;
      continue;
    }
    if (c === "\"") { inString = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  // висячие запятые перед } и ]
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out);
}

/** @type {Map<string, Promise<any>>} */
const cache = new Map();

/**
 * Загрузить JSON/JSONC по адресу (один раз — дальше из кэша).
 * @param {string} url
 * @returns {Promise<any>}
 */
export function loadData(url) {
  if (!cache.has(url)) {
    // сетевой сбой (не 404) — ещё одна попытка через полсекунды; ошибка не запоминается в кэше
    const get = () => fetch(url).catch(() => new Promise(res => setTimeout(res, 500)).then(() => fetch(url)));
    cache.set(url, get().then(async r => {
      if (!r.ok) throw new Error(`Не загрузился ${url}: HTTP ${r.status}`);
      const text = await r.text();
      try {
        return parseJsonc(text);
      } catch (error) {
        throw new Error(`${url}: ошибка в JSON — ${/** @type {Error} */ (error).message}`);
      }
    }).catch(error => { cache.delete(url); throw error; }));
  }
  return cache.get(url);
}

/** @param {any} v @returns {v is Record<string, any>} */
export const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Глубокое слияние: объекты сливаются, массивы и значения заменяются. Исходники не меняются.
 * @param {any} base
 * @param {any} patch
 * @returns {any}
 */
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? clone(base) : clone(patch);
  const out = clone(base);
  for (const [k, v] of Object.entries(patch)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : clone(v);
  return out;
}

/** @param {any} v @returns {any} */
export const clone = v => (v === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * Цвет: "#rrggbb", "#rgb" или [r, g, b] в долях 0…1 → [r, g, b] (0…1).
 * Именованные цвета берутся из палитры (engine.palette), если передана.
 * @param {string | number[]} c
 * @param {Record<string, string>} [palette]
 * @returns {[number, number, number]}
 */
export function parseColor(c, palette) {
  if (Array.isArray(c)) return /** @type {[number, number, number]} */ ([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]);
  let h = typeof c === "string" ? c : "#ff00ff";
  if (palette && palette[h]) h = palette[h];
  if (!h.startsWith("#")) {
    console.warn(`Неизвестный цвет «${c}»: нужен "#rrggbb", [r, g, b] или имя из палитры`);
    return [1, 0, 1];
  }
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  const n = (/** @type {number} */ i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5)];
}

/**
 * Вектор из числа или массива: 2 → [2, 2, 2], [1, 2] → [1, 2, fill].
 * @param {number | number[] | undefined} v
 * @param {number[]} fallback
 * @returns {number[]}
 */
export function vec(v, fallback) {
  if (v === undefined || v === null) return [...fallback];
  if (typeof v === "number") return fallback.map(() => v);
  return fallback.map((f, i) => v[i] ?? f);
}

/** Генератор псевдослучайных чисел с зерном: одна и та же сцена каждый раз. @param {number} seed */
export function rng(seed = 1) {
  let s = Math.floor(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}
