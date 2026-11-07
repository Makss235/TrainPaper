// «Типовая платформа» — сцена по умолчанию для любой станции, у которой нет своей.
// Стоим на платформе и смотрим вдоль пути. Справа — хвост поезда, путь уходит к горизонту,
// контактная сеть, ограда, фонари, деревья, город у горизонта; над платформой — светодиодное табло.
//
// Это и пример блокаута: каждая строка objects — объект сцены, параметры описаны у префаба
// в prefabs/*.js. Координаты — метры: x — поперёк пути (вправо), y — вверх от головки рельса,
// z — вдоль пути (камера у z = 0 смотрит в сторону −z). Пол платформы — на высоте 1,1 м.
import { defineScene } from "../scene/define.js";

const TOP = 1.1;             // пол платформы над головкой рельса
const EDGE = 2.5;            // край платформы
const FENCE = -4.2;          // ограда

export default defineScene({
  id: "typical",
  name: "Типовая платформа",
  viewAzimuth: 250,           // камера смотрит вдоль пути на запад-юго-запад (влияет на солнце и тени)

  cameras: {
    // глаза — 1,65 м над платформой; точка схода левее и выше центра, как на эскизе
    main: { position: [0, TOP + 1.65, 0], yaw: 0, pitch: 0, focal: [.6, 1.02], center: [.41, .44] },
    // шире и чуть выше: видно табло, поезд и вторую линию
    wide: { position: [-1.6, TOP + 2.4, 6], target: [3.2, 2.2, -60], focal: [.5, .85], center: [.45, .46] },
    // от края платформы вдоль поезда
    edge: { position: [.9, TOP + 1.6, 2], target: [2.9, 2.3, -50], focal: [.56, .98], center: [.45, .45] },
  },

  // тени считаются в этой области: ближние 110 м платформы и путей
  shadows: { x: [-18, 18], y: [-1, 14], z: [14, -110] },

  tracks: {
    main: { x: 4.42, platform: { side: -1, top: TOP, edge: EDGE } },   // путь у платформы
    second: { x: 9.7 },                                                // соседний путь
  },

  objects: [
    // дальний план
    { type: "ground" },
    { type: "skyline", seed: 7, count: 170, x: [-1300, 1300], z: [-900, -1800] },
    { type: "trees", seed: 17, rows: [{ x: -15, from: -30, to: -700, step: 9 }, { x: 18, from: -25, to: -700, step: 11 }] },
    { type: "footbridge", z: -165, x: [-40, 40], piers: [-9, 15] },

    // пути и контактная сеть
    { type: "track", track: "main" },
    { type: "track", track: "second" },
    { type: "catenary", x: 7.06, tracks: ["main", "second"], first: -30, span: 60, count: 18 },
    { type: "gantry", z: -62, x: [-5.4, 13] },

    // платформа
    { type: "platform", x: [FENCE, EDGE], top: TOP, from: 6, to: -1500 },
    { type: "fence", x: FENCE, base: TOP, from: 4, to: -700 },
    { type: "lamps", x: -3.56, base: TOP, from: -14, to: -330, step: 24, extra: [6] },
    { type: "board", x: [-3.2, -.4], y: [3.37, 4.35], z: -6.3, base: TOP, screen: true },
    { type: "stationSign", x: -3.0, z: -44, base: TOP, width: 2.8, rotation: 0 },

    // своя модель (glTF): скамейки вдоль ограды — пример, как ставить объекты из Blender
    { type: "model", url: "../assets/models/bench.gltf", position: [-3.55, TOP, -20], rotation: [0, 90, 0], repeat: { count: 5, step: [0, 0, -24] } },
  ],

  traffic: [
    {
      role: "board", track: "main",
      // приходит электровозом вперёд из-за горизонта, проходит мимо и встаёт хвостом в 7,2 м от камеры
      arrival: { heading: 1, stop: { far: -7.2 }, from: 260, ms: 21000 },
      // уходит хвостом мимо нас
      departure: { heading: 1, stop: { far: -7.2 }, ms: 9000 },
      pause: 1800,
    },
    // транзитный грузовой по второму пути раз в 4–12 минут — раскомментируйте, чтобы включить:
    // { role: "passing", track: "second", type: "freight", heading: -1, speed: 20, every: [240, 720], first: 30 },
  ],
});
