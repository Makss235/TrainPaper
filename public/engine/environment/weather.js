// Погода: пресеты и плавная смена. Все числа перетекают к новым значениям за ~4 с: облака
// густеют, свет гаснет, капли появляются постепенно на своих местах (см. precipitation.js).
//
// Настоящая погода: fromWmo(code) переводит код погоды WMO (его отдают, например, open-meteo.com)
// в ключ пресета — достаточно получить код для координат и вызвать engine.weather.set(fromWmo(code)).
// @ts-check

// Погода — набор чисел, которые меняют небо, свет и осадки.
// Свой пресет: engine.weather.define("drizzle", { rain: .3, cover: .9, ... }) — что не указано, берётся из BASE.
//
// Поля:
//   cover        покрытие неба кучевыми облаками, 0…1
//   cloudOpacity непрозрачность облаков, 0…1
//   cloudDark    темнота основания облаков (тяжёлые дождевые), 0…1
//   cloudGray    облака серые, без яркой освещённой стороны, 0…1
//   cirrus       перистые облака высоко, 0…1
//   overcast     сплошная облачность: прячет солнце, луну и звёзды, 0…1
//   sun          сила прямого солнца (и теней), 0…1
//   dark         общее затемнение рассеянного света, 0…1
//   skyGray      небо уходит в серый, 0…1
//   skyDark      небо темнеет, 0…1
//   fogNear, fogFar  множители дальности дымки (меньше — гуще)
//   fogMax       добавка к предельной плотности дымки
//   rain, snow   сила осадков, 0…1
//   wet          платформа мокрая (темнее, отражает небо), 0…1
//   snowCover    снег на горизонтальных поверхностях, 0…1
//   lamps        фонари включаются днём (в сумрачную погоду), 0…1
//   wind         ветер [x, z], м/с — облака плывут; осадки сносит слегка (см. precipitation.js)

export const BASE = {
  cover: .35, cloudOpacity: .9, cloudDark: .1, cloudGray: 0, cirrus: .35, overcast: 0,
  sun: 1, dark: 0, skyGray: 0, skyDark: 0, fogNear: 1, fogFar: 1, fogMax: 0,
  rain: 0, snow: 0, wet: 0, snowCover: 0, lamps: 0, wind: [6, 2.5],
};

export const WEATHER = {
  clear:    { cover: .12, cloudOpacity: .75, cirrus: .5, wind: [4, 1.5] },
  partly:   {},
  cloudy:   { cover: .62, cloudOpacity: .95, cloudDark: .3, cloudGray: .25, cirrus: .1, sun: .55, dark: .05, skyGray: .2, wind: [7, 3] },
  overcast: { cover: .97, cloudOpacity: 1, cloudDark: .55, cloudGray: .9, cirrus: 0, overcast: 1, sun: .06, dark: .18,
              skyGray: .8, skyDark: .12, fogNear: .7, fogFar: .65, fogMax: .03, lamps: .15, wind: [8, 3] },
  rain:     { cover: 1, cloudOpacity: 1, cloudDark: .8, cloudGray: 1, cirrus: 0, overcast: 1, sun: 0, dark: .3,
              skyGray: .9, skyDark: .25, fogNear: .45, fogFar: .42, fogMax: .05, rain: 1, wet: 1, lamps: .45, wind: [11, 4] },
  snow:     { cover: 1, cloudOpacity: 1, cloudDark: .35, cloudGray: 1, cirrus: 0, overcast: 1, sun: .02, dark: .08,
              skyGray: .95, skyDark: .05, fogNear: .4, fogFar: .38, fogMax: .05, snow: 1, snowCover: .85, lamps: .3, wind: [3, 1] },
  fog:      { cover: .9, cloudOpacity: .7, cloudGray: 1, cirrus: 0, overcast: .9, sun: .12, dark: .1,
              skyGray: 1, skyDark: 0, fogNear: .08, fogFar: .14, fogMax: .07, wet: .3, lamps: .35, wind: [1, .5] },
};

/** Подписи пресетов (для панели настроек) */
export const WEATHER_LABELS = [
  ["clear", "Ясно"], ["partly", "Переменно"], ["cloudy", "Облачно"], ["overcast", "Пасмурно"],
  ["rain", "Дождь"], ["snow", "Снег"], ["fog", "Туман"],
];

export const NUMERIC = Object.keys(BASE).filter(k => typeof BASE[/** @type {keyof typeof BASE} */ (k)] === "number");
/** Поля осадков: при силе погоды масштабируются отдельно от неба (см. mixWeather). */
const PRECIP = ["rain", "snow", "wet", "snowCover"];
/** Погода, к которой стремится пресет при силе 0: «переменно». */
const CALM = "partly";

/** @typedef {typeof BASE & Record<string, any>} WeatherParams */

/**
 * Параметры пресета из таблицы (что не указано — из BASE).
 * @param {Record<string, Record<string, any>>} table @param {string} key
 * @returns {WeatherParams}
 */
export const weatherParams = (table, key) => ({ ...BASE, ...(table[key] || {}) });

/**
 * Пресет с силой: 1 — как задан; меньше — плавно к «переменно» (морось), больше — сильнее (ливень, метель).
 * Небо и свет смешиваются быстрее (слабый дождь — уже пасмурно), осадки и мокрота — пропорционально силе.
 * @param {Record<string, Record<string, any>>} table
 * @param {string} key
 * @param {number} [intensity]  0…1,5
 * @returns {WeatherParams}
 */
export function mixWeather(table, key, intensity = 1) {
  const full = weatherParams(table, key);
  if (intensity === 1) return full;
  const calm = weatherParams(table, CALM);
  const k = Math.max(0, Math.min(1.5, intensity));
  const sky = Math.min(1, k * 1.7);                  // небо: морось 0,4 → почти пасмурно
  /** @type {Record<string, any>} */
  const out = { ...full };
  for (const name of NUMERIC) {
    const a = /** @type {number} */ (calm[name]), b = /** @type {number} */ (full[name]);
    out[name] = PRECIP.includes(name) ? b * (name === "rain" || name === "snow" ? k : Math.min(1, k * 1.4)) : a + (b - a) * sky;
  }
  if (k > 1) {                                        // ливень: темнее и гуще дымка
    out.dark = Math.min(1, full.dark * (1 + (k - 1) * .8));
    out.fogNear = full.fogNear / (1 + (k - 1) * .8);
    out.fogFar = full.fogFar / (1 + (k - 1) * .8);
  }
  out.wind = calm.wind.map((/** @type {number} */ v, /** @type {number} */ i) => v + (full.wind[i] - v) * Math.min(1.4, k));
  return /** @type {WeatherParams} */ (out);
}

export class WeatherState {
  /** @param {WeatherParams} params */
  constructor(params) {
    this.key = "partly";
    this.intensity = 1;
    /** @type {WeatherParams} */
    this.current = params;
    this.from = this.current;
    this.target = this.current;
  }

  /** Новая цель; instant — сразу (при загрузке), иначе переход ведёт вызывающий через blend(). */
  set(key, params, { instant = false, intensity = 1 } = {}) {
    this.key = key;
    this.intensity = intensity;
    this.target = params;
    this.from = instant ? params : this.current;
    if (instant) this.current = params;
  }

  get moving() {
    return this.current !== this.target;
  }

  /** Промежуточное состояние перехода: e — 0…1 (уже со сглаживанием). */
  blend(e) {
    if (e >= 1) { this.current = this.target; return; }
    /** @type {Record<string, any>} */
    const out = {};
    for (const name of NUMERIC) out[name] = this.from[name] + (this.target[name] - this.from[name]) * e;
    out.wind = this.from.wind.map((v, i) => v + (this.target.wind[i] - v) * e);
    this.current = /** @type {WeatherParams} */ (out);
  }

  /**
   * Окружение (lib/sky.js environment()) с поправкой на погоду: небо сереет и темнеет,
   * фонари при сумрачной погоде загораются раньше. Возвращает новый объект, исходный не трогает.
   */
  applyTo(env) {
    const w = this.current;
    const gray = c => {
      const l = (c[0] * .3 + c[1] * .55 + c[2] * .15);
      const g = [l * .96, l * .99, l * 1.04];               // серый с лёгким холодком
      return c.map((v, i) => (v + (g[i] - v) * w.skyGray) * (1 - w.skyDark));
    };
    // у сплошной облачности горизонт светлее зенита: светлое «молоко» к краю неба
    let horizon = gray(env.horizon).map(v => v + (Math.min(255, v * 1.08 + 8) - v) * w.overcast * .6);
    // ночью дымка и туман подсвечены огнями города — не чёрные
    const haze = Math.min(1, w.fogMax * 12) * env.lamps;
    horizon = horizon.map((v, i) => v + ([62, 60, 60][i] - v) * Math.max(0, haze) * (v < 62 ? .8 : 0));
    const top = gray(env.top);
    return {
      ...env, top, horizon,
      glow: env.glow * (1 - w.overcast * .85),
      stars: env.stars * (1 - w.overcast),
      sunColor: env.sunColor.map((v, i) => v + ([236, 238, 240][i] - v) * w.overcast * .5),
    };
  }
}

/**
 * Код погоды WMO → ключ пресета (для подключения настоящей погоды).
 * @param {number} code @param {number | null} [cloudCover]  облачность, %
 */
export function fromWmo(code, cloudCover = null) {
  if (code === 0) return "clear";
  if (code <= 2) return cloudCover != null && cloudCover < 30 ? "clear" : "partly";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return "rain";
  return "cloudy";
}

/**
 * Сила погоды по коду WMO: морось и слабый дождь — меньше 1, ливень и сильный снег — больше.
 * Если известна интенсивность осадков (мм/ч), она точнее кода.
 * @param {number} code @param {number | null} [mmPerHour]
 */
export function wmoIntensity(code, mmPerHour = null) {
  if (mmPerHour != null && mmPerHour > 0) return Math.max(.25, Math.min(1.5, .25 + Math.sqrt(mmPerHour) * .45));
  /** @type {Record<number, number>} */
  const table = { 51: .3, 53: .4, 55: .5, 56: .35, 57: .5, 61: .55, 63: 1, 65: 1.4, 66: .6, 67: 1.2,
    71: .5, 73: 1, 75: 1.4, 77: .4, 80: .7, 81: 1.1, 82: 1.5, 85: .8, 86: 1.3, 95: 1.3, 96: 1.4, 99: 1.5 };
  return table[code] ?? 1;
}
