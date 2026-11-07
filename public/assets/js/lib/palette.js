// Дневные цвета материалов. Сцена красится через CSS-переменные --m-*, а классы
// .f-* (заливка) и .s-* (обводка) генерируются отсюда же — один источник правды.
import { clamp, hex, lit, mix, rgb } from "./color.js";

export const RZD_RED = "#e21a1a";

export const MATERIALS = {
  // вагон
  body: "#d4d5d8", band2: "#c3c5c9", band: "#5f6368", rib: "#4b4f54", ribhi: "#7b7f84", gutter: "#8e9297",
  red: RZD_RED, doorline: "#5a1f22", roof: "#b8bbc0", roofhi: "#cdd0d3", roofbox: "#a6aaaf",
  grille: "#5b5f65", slat: "#8b8f94", pillar: "#55595e", handle: "#dcdddf", slot: "#41454a",
  lampbox: "#2e3135", green: "#2f9e57", redlamp: "#b8161c", taillens: "#ff3524",
  bellows: "#6b7076", fold: "#4c5156", under: "#26282b", step: "#5a5e63", box: "#35383c",
  frame: "#2a2d31", text: "#ffffff",
  // платформа
  platform: "#bdbdb8", tile: "#a8a9a3", coping: "#dddcd5", yellow: "#efc12d", tactile: "#cbc6b3", gap: "#1b1c1e",
  post: "#383c41", sign: "#5b6067", signtext: "#ffffff", fence: "#26292d", lamp: "#4a4e53",
  // путь и окрестности
  ballast: "#867f75", sleeper: "#9a978f", rail: "#6f7479", railhi: "#c3c7cb", ground: "#7f8a6c",
  mast: "#8d9196", wire: "#3d4247", trees: "#4f6b58", trees2: "#6d8a75", city: "#8f9cab", city2: "#a9b4c0",
  farplat: "#a9aaa5", farroof: "#7c8590",
};

// уровни дымки для дальних планов: группа с классом hzN красит те же материалы «дальше»
export const HAZE = [0, .2, .38, .58, .8];
const HAZED = ["ballast", "sleeper", "rail", "railhi", "mast", "wire", "farplat", "farroof", "tile", "fence", "lamp",
  "trees", "trees2", "city", "city2", "ground", "platform", "coping", "post", "body", "band", "red", "roof", "under"];

let styleInjected = false;
export function injectMaterialStyles() {
  if (styleInjected) return;
  styleInjected = true;
  let css = Object.keys(MATERIALS).map(k =>
    `.f-${k}{fill:var(--m-${k})}.s-${k}{stroke:var(--m-${k})}`).join("");
  for (let level = 1; level < HAZE.length; level++) {
    css += `.hz${level}{${HAZED.map(k => `--m-${k}:var(--h${level}-${k})`).join(";")}}`;
  }
  const style = document.createElement("style");
  style.textContent = css + ".s-slat{stroke:var(--m-slat)}.s-fold{stroke:var(--m-fold)}.s-fold-v{stroke:var(--m-fold)}";
  document.head.append(style);
}

/**
 * Красит материалы под освещение и выставляет CSS-переменные на target.
 * Возвращает объект с готовыми цветами (пригодится для градиентов).
 */
export function applyPalette(target, env) {
  const out = {};
  for (const [name, color] of Object.entries(MATERIALS)) {
    const c = lit(color, env);
    out[name] = c;
    target.style.setProperty(`--m-${name}`, rgb(c));
  }
  for (let level = 1; level < HAZE.length; level++) {
    for (const name of HAZED) target.style.setProperty(`--h${level}-${name}`, rgb(lit(MATERIALS[name], env, HAZE[level])));
  }
  // свет изнутри вагона и стекло: днём окна отражают небо, ночью светятся тёплым
  const lamps = env.lamps;
  const interior = mix(lit("#56606b", env), hex("#ffd98e"), lamps);
  const interiorLow = mix(lit("#3e464f", env), hex("#f2b35c"), lamps);
  const curtain = mix(lit("#6c8596", env), mix(hex("#8c7c5e"), hex("#a8916a"), .5), lamps * .85);
  const reflectTop = mix(hex("#dff1fb"), env.top, .35), reflectBottom = mix(hex("#7fb5dc"), env.horizon, .4);
  const set = (k, c) => { out[k] = c; target.style.setProperty(`--${k}`, typeof c === "string" ? c : rgb(c)); };
  set("interior", interior);
  set("interior-low", interiorLow);
  set("curtain", curtain);
  set("rod", mix(lit("#b9a35a", env), hex("#f3d27a"), lamps));
  set("reflect-top", mul(reflectTop, env));
  set("reflect-bottom", mul(reflectBottom, env));
  // табличка и надписи станции подсвечены фонарями — ночью не проваливаются в темноту
  const glowLit = (color, k) => mix(lit(color, env), mul(hex(color), { ambient: [.82, .8, .78] }), lamps * k);
  set("plate-red", glowLit("#c8141c", .75));
  set("plate-blue", glowLit("#134c73", .75));
  set("plate-ink", glowLit("#f7ecec", .8));
  set("plate-num", glowLit("#cdeee3", .8));
  set("m-signtext", glowLit("#ffffff", .7));
  target.style.setProperty("--reflect", (.12 + .72 * clamp(env.day)).toFixed(3));
  target.style.setProperty("--lamps", lamps.toFixed(3));
  target.style.setProperty("--night", clamp(1 - env.day).toFixed(3));
  return out;
}

const mul = (c, env) => c.map((v, i) => v * (.35 + .65 * env.ambient[i]));
