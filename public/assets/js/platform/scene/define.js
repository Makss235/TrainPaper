// Описание сцены станции — «блокаут»: какие объекты где стоят, откуда смотрит камера, какие пути
// и как по ним ходят поезда. Файл сцены — обычный JS-модуль в stations/, данные и комментарии.
//
// export default defineScene({
//   id: "typical",                  // ключ сцены (для ?scene=typical и панели настроек)
//   name: "Типовая платформа",      // подпись в панели
//   viewAzimuth: 250,               // куда смотрит камера по сторонам света, ° (0 — север, 90 — восток):
//                                   //   от этого зависит, где на небе солнце и откуда падают тени
//
//   // Координаты — метры. x — поперёк пути (вправо), y — вверх от головки рельса, z — вдоль пути:
//   // камера стоит около z = 0 и смотрит в сторону −z (к горизонту). Пол платформы обычно на y = 1,1.
//
//   cameras: { main: {...}, wide: {...} },   // ракурсы — см. engine/camera.js; "main" — по умолчанию
//   shadows: { x: [-20, 20], y: [-1, 14], z: [14, -110] },   // где считать тени (ближе — чётче)
//   tracks: { main: { x: 4.42, platform: {...} }, second: { x: 9.7 } },   // пути — scene/tracks.js
//
//   objects: [                      // объекты — префабы из prefabs/ (у каждого параметры описаны там)
//     { type: "ground" },
//     { type: "platform", x: [-4.2, 2.5], top: 1.1 },
//     { type: "model", url: "../assets/models/station.glb", position: [30, 0, -80] },
//   ],
//
//   traffic: [                      // поезда — trains/traffic.js
//     { role: "board", track: "main", ... },     // поезд с табло: прибывает и отправляется по расписанию
//     { role: "passing", track: "second", ... }, // транзитный, грузовой — проходит мимо без остановки
//   ],
//
//   trains: { default: "fpk-long", rules: [...] },   // какие составы ставить — trains/index.js
// });

const DEFAULTS = {
  viewAzimuth: 250,
  cameras: {},
  shadows: { x: [-20, 20], y: [-1, 14], z: [14, -110] },
  tracks: {},
  objects: [],
  traffic: [],
  trains: {},
};

export function defineScene(def) {
  const out = { ...DEFAULTS, ...def };
  if (!out.id) throw new Error("У сцены нужен id");
  out.name ||= out.id;
  for (const o of out.objects) if (!o.type) console.warn(`Сцена «${out.name}»: у объекта нет type`, o);
  return out;
}
