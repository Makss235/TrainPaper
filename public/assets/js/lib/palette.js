// Дневные цвета материалов. Сцена красится через CSS-переменные --m-*, а классы
// .f-* (заливка) и .s-* (обводка) генерируются отсюда же — один источник правды.
import { clamp, hex, lit, mix, rgb } from "./color.js";

export const RZD_RED = "#e21a1a";

export const MATERIALS = {
  // вагон (цвета схемы окраски ФПК)
  body: "#d0d1d1", band2: "#c3c5c9", band: "#696b6d", rib: "#58595c", ribhi: "#7d7f81", gutter: "#8e9297",
  corr: "#b9bbbd", pin: "#9b2b31", darkend: "#61666a", darkdoor: "#575b5f", white: "#f4f4f4", print: "#55585c",
  red: RZD_RED, doorline: "#3a2a2b", roof: "#4c4f53", roofhi: "#cdd0d3", roofbox: "#5f6266",
  grille: "#5b5f65", slat: "#8b8f94", pillar: "#74777a", handle: "#dcdddf", slot: "#41454a",
  lampbox: "#2e3135", green: "#2f9e57", redlamp: "#b8161c", taillens: "#ff3524",
  bellows: "#5d6166", fold: "#45494e", under: "#2b2d30", step: "#5a5e63", box: "#3a3d41",
  frame: "#33363a", text: "#ffffff", glass: "#7d8286", glasstop: "#55595d",
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

// Материалы по ориентации поверхности: каждая группа по-своему повёрнута к солнцу.
const GROUPS = {
  side: ["body", "band2", "band", "rib", "ribhi", "gutter", "corr", "pin", "darkend", "darkdoor", "white", "print",
    "red", "doorline", "pillar", "handle", "slot", "lampbox",
    "green", "redlamp", "bellows", "fold", "under", "step", "box", "frame", "text"],
  roof: ["roof", "roofhi", "roofbox", "grille", "slat"],
  floor: ["platform", "tile", "coping", "yellow", "tactile", "gap", "ballast", "sleeper", "rail", "railhi", "ground", "farplat"],
  front: ["post", "sign", "fence", "lamp", "mast", "wire", "trees", "trees2", "city", "city2", "farroof"],
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, names]) => names.map(n => [n, g])));
const COOL = [.86, .92, 1.08], WARM = [1.04, 1, .93];

/**
 * Яркость поверхности от солнца: d — косинус угла между нормалью и направлением на солнце (0…1),
 * sunlight — сила прямого света (0 ночью). Тень холоднее, освещённая сторона — теплее.
 */
export function shadeFactor(d, sunlight) {
  const raw = Math.min(1.08, .79 + .31 * Math.max(0, d) ** .6);
  const k = 1 + sunlight * (raw - 1);
  const tint = k < 1 ? mix([1, 1, 1], COOL, clamp((1 - k) / .21)) : mix([1, 1, 1], WARM, clamp((k - 1) / .08));
  return tint.map(t => t * k);
}

/**
 * Красит материалы под освещение и выставляет CSS-переменные на target.
 * light — множители яркости групп {side, roof, floor, front} из shadeFactor (по умолчанию ровный свет).
 */
const lastVars = new WeakMap();

export function applyPalette(target, env, light = {}) {
  const out = {};
  // меняем только те переменные, значение которых действительно изменилось: каждая смена
  // пересчитывает стили всей сцены, а таких переменных почти две сотни
  const cache = lastVars.get(target) || new Map();
  lastVars.set(target, cache);
  const node = target;
  target = { style: { setProperty(name, value) { if (cache.get(name) !== value) { cache.set(name, value); node.style.setProperty(name, value); } } } };
  const factor = name => light[GROUP_OF[name]] || [1, 1, 1];
  const shaded = (name, haze = 0) => {
    const k = factor(name);
    return lit(hex(MATERIALS[name]).map((v, i) => v * k[i]), env, haze);
  };
  for (const name of Object.keys(MATERIALS)) {
    const c = shaded(name);
    out[name] = c;
    target.style.setProperty(`--m-${name}`, rgb(c));
  }
  for (let level = 1; level < HAZE.length; level++) {
    for (const name of HAZED) target.style.setProperty(`--h${level}-${name}`, rgb(shaded(name, HAZE[level])));
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
  // тени от солнца: синеватые, сильнее в ясный день, исчезают к закату
  const sun = sunStrength(env.alt);
  target.style.setProperty("--sun", sun.toFixed(3));
  target.style.setProperty("--shadow", `rgba(${mix([30, 40, 78], [70, 40, 70], env.glow).map(Math.round)},${(.36 * sun).toFixed(3)})`);
  target.style.setProperty("--vol", (.55 + .45 * clamp(env.day)).toFixed(3));
  return out;
}

/** Сила прямого солнечного света: 0 под горизонтом, 1 — когда солнце выше ~6°. */
export const sunStrength = alt => clamp((alt + .5) / 6.5);

const mul = (c, env) => c.map((v, i) => v * (.35 + .65 * env.ambient[i]));
