// Мурманск — северный тупиковый вокзал. Блокаут: сопки на горизонте вместо города, редкий
// низкорослый лес, невысокая платформа с коротким навесом у здания вокзала, три пути.
// Камера чуть выше обычного: видно, как пути уходят вдоль залива к сопкам.
//
// Здание вокзала здесь — заготовка (building). Свою модель вокзала поставьте так:
//   { type: "model", url: "../assets/models/murmansk.glb", position: [-30, -0.3, -10], rotation: [0, 90, 0] }
import { defineScene } from "../scene/define.js";

const TOP = 1.1;

export default defineScene({
  id: "murmansk",
  name: "Мурманск",
  viewAzimuth: 170,               // пути уходят на юг вдоль Кольского залива

  cameras: {
    main: { position: [-.4, TOP + 1.9, 2], yaw: -1.5, pitch: -.4, focal: [.56, .98], center: [.42, .46] },
    wide: { position: [-3.5, TOP + 3.2, 12], target: [4, 2.5, -70], focal: [.46, .8], center: [.45, .48] },
  },

  shadows: { x: [-22, 20], y: [-1, 12], z: [16, -110] },

  tracks: {
    main: { x: 4.42, platform: { side: -1, top: TOP, edge: 2.5 } },
    second: { x: 9.6 },
    third: { x: 14.8 },
  },

  objects: [
    { type: "ground", color: "#7f8a74" },
    // сопки: три гряды, дальние светлее и тонут в дымке
    { type: "hills", seed: 11, width: 11000, ridges: [
      { z: -1400, height: [40, 140], color: "#6f7d72", haze: .55 },
      { z: -2600, height: [110, 300], color: "hills", haze: .6 },
      { z: -4200, height: [220, 480], color: "hills2", haze: .55 },
    ] },
    { type: "trees", seed: 29, size: [1.6, 2.8], trunk: [1.8, 3.4], colors: ["#4b6650", "#56705a", "#465f4c"],
      rows: [{ x: -16, from: -40, to: -500, step: 7, spread: 8 }, { x: 24, from: -30, to: -520, step: 8, spread: 10 }] },

    ...["main", "second", "third"].map(track => ({ type: "track", track, from: 20 })),
    { type: "catenary", x: 12.2, tracks: ["second", "third"], first: -26, span: 55, count: 14, height: 9.8, feeders: false },
    { type: "catenary", x: 7.0, tracks: ["main"], first: -26, span: 55, count: 14, height: 9.8 },

    // платформа с коротким навесом у вокзала
    { type: "platform", x: [-5.2, 2.5], top: TOP, from: 20, to: -600 },
    { type: "canopy", x: [-4.9, 1.8], from: 18, to: -46, height: 3.9, thickness: .26, columns: { x: [-3.9], step: 8, offset: 4 },
      lamps: { step: 8, x: -1.2, offset: 6 } },
    { type: "lamps", x: -4.6, base: TOP, from: -52, to: -280, step: 22, height: 4.8 },
    { type: "board", x: [-2.9, -.2], y: [3.1, 4.0], z: -8.5, base: TOP, screen: true },
    { type: "stationSign", x: -1.6, z: -26, base: TOP, width: 3.0, height: 1.85, rotation: 0 },
    { type: "fence", x: -5.2, base: TOP, from: -46, to: -600, height: 1.0 },

    // здание вокзала (заготовка) — слева, за платформой
    { type: "building", x: [-40, -8.5], y: [-.32, 13.5], z: [24, -40], color: "#9fc3b4", cornice: "trim", facade: "+x", gable: 0, roof: "roofDark",
      windows: { rows: 2, step: 5.2, bottom: 3.2, width: 1.9, height: 3.0, gap: 2.6, color: "#3f4c55" } },
    { type: "building", x: [-24, -14], y: [13.5, 21], z: [2, -10], color: "#9fc3b4", cornice: "trim", roof: "roofDark" },
    // склады у дальнего пути
    { type: "building", x: [26, 60], y: [-.3, 9], z: [-120, -190], color: "wallDark", facade: "-x", gable: 3,
      windows: { rows: 1, bottom: 3, width: 3.2, height: 2.4, gap: 6 } },
  ],

  traffic: [
    {
      role: "board", track: "main",
      arrival: { heading: 1, stop: { far: -8 }, from: 280, ms: 22000 },
      departure: { heading: -1, stop: { near: 22 }, to: 700, ms: 11000 },
      pause: 2400,
    },
    // { role: "passing", track: "third", type: "freight", heading: 1, speed: 14, every: [420, 1200], first: 90 },
  ],
});
