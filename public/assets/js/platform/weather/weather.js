// Текущая погода и плавная смена: при выборе другой погоды все параметры (presets.js) за несколько
// секунд перетекают к новым значениям — облака густеют, свет гаснет, начинается дождь.
//
// Настоящая погода (на будущее): достаточно получать код погоды для координат станции и вызывать
// weather.set(fromWmo(code)). fromWmo переводит коды WMO (их отдают, например, open-meteo.com
// в поле weather_code) в ключи пресетов. Сам запрос сюда не встроен: сцена не ходит в сеть сама.
import { BASE, weatherParams } from "./presets.js";

const NUMERIC = Object.keys(BASE).filter(k => typeof BASE[k] === "number");

export class WeatherState {
  constructor(key = "partly") {
    this.key = key;
    this.current = weatherParams(key);
    this.from = this.current;
    this.target = this.current;
    this.t0 = 0;
    this.ms = 1;
  }

  /** Сменить погоду: instant — сразу (при загрузке), иначе плавно за ms. */
  set(key, { instant = false, ms = 6000 } = {}) {
    this.key = key;
    this.target = weatherParams(key);
    if (instant) {
      this.current = this.from = this.target;
      return;
    }
    this.from = this.current;
    this.t0 = performance.now();
    this.ms = ms;
  }

  get moving() {
    return this.current !== this.target;
  }

  /** Шаг перехода; возвращает true, пока погода ещё меняется. */
  step(now = performance.now()) {
    if (!this.moving) return false;
    const k = Math.min(1, (now - this.t0) / this.ms), e = k * k * (3 - 2 * k);
    if (k >= 1) {
      this.current = this.target;
      return false;
    }
    const out = {};
    for (const name of NUMERIC) out[name] = this.from[name] + (this.target[name] - this.from[name]) * e;
    out.wind = this.from.wind.map((v, i) => v + (this.target.wind[i] - v) * e);
    this.current = out;
    return true;
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

/** Код погоды WMO → ключ пресета (для подключения настоящей погоды). */
export function fromWmo(code, cloudCover = null) {
  if (code === 0) return "clear";
  if (code <= 2) return cloudCover != null && cloudCover < 30 ? "clear" : "partly";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return "rain";
  return "cloudy";
}
