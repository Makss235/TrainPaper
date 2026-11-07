// ШАБЛОН НОВОЙ СЦЕНЫ СТАНЦИИ. Скопируйте файл (например, в stations/tver.js), поменяйте id и name,
// расставьте объекты и подключите сцену в stations/index.js:
//   import tver from "./tver.js";
//   export const SCENES = [typical, spbGlavny, murmansk, tver];
//   export const STATION_SCENES = { 1146: "tver" };      // ID станции РЖД → id сцены
//
// Проверить сцену без смены станции: /platform/?scene=tver
// Подобрать ракурс: /platform/?scene=tver&dev=1 — свободная камера (WASD, мышь с зажатой кнопкой),
// кнопка «Копировать ракурс» кладёт в буфер готовый пресет для cameras.
//
// Координаты — метры: x — поперёк пути (вправо), y — вверх от головки рельса, z — вдоль пути;
// камера стоит около z = 0 и смотрит в сторону −z. Пол платформы обычно на y = 1,1.
import { defineScene } from "../scene/define.js";

const TOP = 1.1;

export default defineScene({
  id: "template",
  name: "Новая станция",
  viewAzimuth: 250,                         // куда смотрит камера по компасу, ° — от этого зависят солнце и тени

  cameras: {
    main: { position: [0, TOP + 1.65, 0], yaw: 0, pitch: 0 },             // глаза на платформе
    // high: { position: [-2, TOP + 6, 12], target: [4, 2, -60], focal: [.5, .85] },
  },

  shadows: { x: [-18, 18], y: [-1, 14], z: [14, -110] },   // где нужны тени (меньше область — чётче тени)

  tracks: {
    main: { x: 4.42, platform: { side: -1, top: TOP, edge: 2.5 } },
    // second: { x: 9.7 },
  },

  objects: [
    { type: "ground" },
    { type: "skyline", seed: 3 },                           // или { type: "hills", ... } — сопки
    { type: "track", track: "main" },
    { type: "catenary", x: 7.06, tracks: ["main"], first: -30, span: 60, count: 14 },
    { type: "platform", x: [-4.2, 2.5], top: TOP },
    { type: "lamps", x: -3.56, base: TOP, from: -14, to: -300, step: 24 },
    { type: "board", x: [-3.2, -.4], y: [3.37, 4.35], z: -6.3, base: TOP, screen: true },

    // заготовка здания: потом заменить моделью
    // { type: "building", x: [-40, -10], y: [-.3, 12], z: [20, -30], color: "wall", facade: "+x", windows: { rows: 2 } },
    // своя модель из Blender (glTF/GLB, метры, Y вверх):
    // { type: "model", url: "../assets/models/my-station.glb", position: [-25, -.3, -5], rotation: [0, 90, 0] },
    // простая коробка-заготовка:
    // { type: "box", x: [-6, -4.5], y: [TOP, 3.2], z: [-30, -34], color: "wall" },
  ],

  traffic: [
    { role: "board", track: "main", arrival: { heading: 1, stop: { far: -7.2 } }, departure: { heading: 1, stop: { far: -7.2 } } },
  ],

  // trains: { default: "fpk-long", rules: [{ when: t => t.to.includes("МУРМАНСК"), use: "fpk-double" }] },
});
