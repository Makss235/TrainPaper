// @ts-check
// Общий модуль (assets/shared/): дневные цвета материалов РЖД — для детальных моделей (ливреи)
// и вида «Вагон» (CSS-переменные --m-*). Один источник правды.

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
