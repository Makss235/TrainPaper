// Санкт-Петербург-Главный (Московский вокзал) — тупиковый вокзал. Блокаут: длинные навесы над
// платформами, несколько путей, порталы контактной сети, плотная городская застройка у горизонта.
// Камера стоит у начала платформы (здание вокзала и упоры — за спиной) и смотрит наружу, на юго-восток.
//
// На тупиковом вокзале поезда приходят локомотивом вперёд — к упорам за нашей спиной — и стоят
// хвостом к выходу со станции; отправляющиеся стоят локомотивом к горизонту и уходят туда же.
// Это задаётся в traffic: arrival.heading = 1, departure.heading = −1.
//
// Чтобы заменить блокаут настоящей моделью вокзала, добавьте в objects
//   { type: "model", url: "../assets/models/spb-glavny.glb", position: [0, 0, 0] }
// и уберите заготовки, которые модель заменяет.
import { defineScene } from "../scene/define.js";

const TOP = 1.1;

export default defineScene({
  id: "spb-glavny",
  name: "Санкт-Петербург-Главный",
  viewAzimuth: 135,

  cameras: {
    main: { position: [0, TOP + 1.65, 0], yaw: 0, pitch: 1, focal: [.58, 1.0], center: [.42, .45] },
    wide: { position: [-1.2, TOP + 2.2, 10], target: [3.4, 3.2, -60], focal: [.48, .82], center: [.46, .47] },
  },

  shadows: { x: [-16, 22], y: [-1, 12], z: [16, -120] },

  tracks: {
    main: { x: 4.42, platform: { side: -1, top: TOP, edge: 2.5 } },
    p2: { x: 9.8, platform: { side: 1, top: TOP, edge: 11.72 } },
    p3: { x: 21.92, platform: { side: -1, top: TOP, edge: 20.0 } },
    p4: { x: 27.2 },
    west: { x: -9.2, platform: { side: 1, top: TOP, edge: -6.9 } },
  },

  objects: [
    { type: "ground", color: "ground2" },
    { type: "skyline", seed: 21, count: 260, x: [-1400, 1400], z: [-600, -1500], height: [16, 70], width: [24, 90], gap: 40 },
    { type: "trees", seed: 5, rows: [{ x: -28, from: -120, to: -600, step: 14 }, { x: 40, from: -150, to: -600, step: 16 }] },

    // пути
    ...["west", "main", "p2", "p3", "p4"].map(track => ({ type: "track", track, from: 30 })),

    // наша платформа — островная, между путями west и main, с навесом на одном ряду колонн
    { type: "platform", x: [-6.9, 2.5], top: TOP, from: 30, to: -900, edges: [-1, 1] },
    { type: "canopy", x: [-6.4, 2.0], from: 28, to: -175, height: 4.4, columns: { x: [-2.2], step: 10.5 }, lamps: { step: 10.5, x: -2.2 } },
    { type: "board", x: [-.9, 1.9], y: [3.15, 4.1], z: -9.5, base: TOP, screen: true },
    { type: "stationSign", x: -2.2, z: -31, base: TOP, width: 3.4, height: 2.1, rotation: 0 },

    // соседняя платформа за путями p2–p3 со своим навесом
    { type: "platform", x: [11.72, 20.0], top: TOP, from: 30, to: -500, edges: [-1, 1] },
    { type: "canopy", x: [12.2, 19.5], from: 28, to: -190, height: 4.4, columns: { x: [15.9], step: 10.5 }, lamps: { step: 10.5, x: 15.9 } },

    // контактная сеть на порталах: жёсткие поперечины над всеми путями, провода подвешены к ним
    ...[-24, -84, -144, -204, -264, -324, -384, -444].map(z => ({ type: "gantry", z, x: [-12, 30.6], height: 9.4 })),
    { type: "catenary", masts: false, tracks: ["west", "main", "p2", "p3", "p4"], first: -24, span: 60, count: 14, hangFrom: 7.95 },

    // дальний план: путепровод и корпуса депо
    { type: "footbridge", z: -230, x: [-70, 70], piers: [-14, 11, 31], height: 7.6 },
    { type: "building", x: [-60, -22], y: [-.3, 16], z: [-260, -330], color: "wallDark", facade: "+x", gable: 4,
      windows: { rows: 3, step: 4.4, bottom: 2.4, width: 2.2, height: 2.6, gap: 3.2 } },
    { type: "building", x: [34, 80], y: [-.3, 22], z: [-300, -380], color: "wall", facade: "-x",
      windows: { rows: 4, step: 4.6, bottom: 2.8, width: 1.8, height: 2.4, gap: 3.6 } },
  ],

  traffic: [
    {
      role: "board", track: "main",
      arrival: { heading: 1, stop: { far: -7.2 }, from: 300, ms: 22000 },
      departure: { heading: -1, stop: { near: 26 }, to: 700, ms: 11000 },
      pause: 2400,
    },
    // { role: "passing", track: "p4", type: "emu-fast", heading: -1, speed: 9, every: [300, 900], first: 60 },
  ],
});
