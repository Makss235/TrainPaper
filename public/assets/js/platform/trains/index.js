// Реестр подвижного состава: вагоны (CARS), составы (TRAIN_TYPES) и правила, какой состав
// показывать для поезда с табло (TRAIN_RULES).
//
// Вагон — объект { name, length, gap, build(opts) → THREE.Object3D, ... } (примеры — в cars/).
// Локальные оси вагона: z от торца 0 до length, x — поперёк (0 — ось), y — вверх от головки рельса.
// Необязательные поля вагона:
//   gangway     { half, y: [низ, верх] } — переход-гармошка к соседнему вагону с таким же полем
//   tailLights  [[x, y], ...] — хвостовые огни у торца z = 0 (если вагон последний)
//   headLights  true — у вагона свои фары у торца z = length (локомотив, голова электропоезда)
//   windowSpill [[z0, z1], ...] — окна, свет из которых ночью падает на платформу
//   sameSides   true — окна борта +x на тех же z, что и у борта −x (иначе — зеркально по длине)
//
// Состав: consist — список вагонов от головы к хвосту; ":flip" — вагон развёрнут.
// consist может быть функцией (random) => [...] — для грузовых составов разной длины и порядка.
//
// Свой вагон из модели (glTF из Blender) — trains/cars/model.js:
//   registerCar("my-coach", modelCar({ name: "…", url: "../assets/models/my-coach.glb", length: 24.5, gap: .6 }));
//   registerTrainType("my-train", { name: "…", consist: ["loco-ep", "my-coach", "my-coach"] });
//   и правило в TRAIN_RULES или в сцене: trains: { rules: [{ when: t => t.number === "001А", use: "my-train" }] }.
import { emuHead, emuMiddle } from "./cars/emu.js";
import { fpkCoach, fpkDouble } from "./cars/fpk.js";
import { boxcar, gondola, tank } from "./cars/freight.js";
import { locoEp, locoFreight } from "./cars/loco.js";

export const CARS = {
  "fpk-coach": fpkCoach,
  "fpk-double": fpkDouble,
  "loco-ep": locoEp,
  "loco-freight": locoFreight,
  "emu-head": emuHead,
  "emu-middle": emuMiddle,
  boxcar, tank, gondola,
};

const times = (id, n) => Array.from({ length: n }, () => id);

export const TRAIN_TYPES = {
  "fpk-long": { name: "Пассажирский дальнего следования", consist: ["loco-ep", ...times("fpk-coach", 6)] },
  "fpk-double": { name: "Двухэтажный", consist: ["loco-ep", ...times("fpk-double", 6)] },
  "emu-fast": { name: "Скоростной электропоезд", consist: ["emu-head", ...times("emu-middle", 3), "emu-head:flip"] },
  freight: {
    name: "Грузовой",
    consist: random => {
      const kinds = ["boxcar", "tank", "gondola"];
      const list = ["loco-freight", "loco-freight:flip"];
      let kind = kinds[Math.floor(random() * 3)];
      const n = 18 + Math.floor(random() * 14);
      for (let i = 0; i < n; i++) {
        if (random() < .22) kind = kinds[Math.floor(random() * 3)];      // вагоны идут группами
        list.push(kind);
      }
      return list;
    },
  },
};

/**
 * Правила выбора состава для поезда с табло: первое подошедшее. t — поезд из табло
 * (number "119А", from, to, type: long | suburban | other, kind: arrival | departure | transit).
 * Номера: 001–598 — пассажирские дальнего следования, 7xx — скоростные дневные, 8xx — скоростные
 * пригородные. Список двухэтажных — пример: проверьте по актуальному расписанию.
 */
export const TRAIN_RULES = [
  { when: t => /^(00[56]|02[34]|10[34])\D/.test(t.number), use: "fpk-double" },
  { when: t => /^[78]\d\d/.test(t.number), use: "emu-fast" },
  { when: t => t.type === "suburban", use: "emu-fast" },
];

/** Какой состав показать для элемента табло; sceneTrains — настройки сцены { default, rules }. */
export function trainTypeFor(item, sceneTrains = {}) {
  const t = item?.train;
  if (!t) return sceneTrains.default || "fpk-long";
  for (const rule of [...(sceneTrains.rules || []), ...TRAIN_RULES]) {
    try {
      if (rule.when(t)) return rule.use;
    } catch { /* правило с ошибкой просто пропускаем */ }
  }
  return sceneTrains.default || "fpk-long";
}

export function registerCar(id, car) {
  CARS[id] = car;
}

export function registerTrainType(id, type) {
  TRAIN_TYPES[id] = type;
}
