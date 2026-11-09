// Модуль «Железная дорога» (слой приложения, не движка): пути, точки остановки, поезд, движение, менеджер
// поездов, расписание, табло РЖД как источник расписания. Подключение регистрирует компоненты — после этого
// их можно указывать в сценах по имени type. Модуль можно переносить в другие проекты вместе с движком.
// Подробно — docs/rail.md.
// @ts-check
import { registerComponent } from "../../../engine/index.js";
import { TrainCatalog } from "./catalog.js";
import { Schedule } from "./schedule.js";
import { RzdBoard } from "./sources/rzd-board.js";
import { StopPoint } from "./stop-point.js";
import { Track } from "./track.js";
import { Train } from "./train.js";
import { TrainLights } from "./train-lights.js";
import { TrainManager } from "./train-manager.js";
import { TrainMotion } from "./train-motion.js";

export const RAIL_COMPONENTS = [Track, StopPoint, Train, TrainLights, TrainMotion, TrainManager, Schedule, RzdBoard];
for (const C of RAIL_COMPONENTS) registerComponent(/** @type {any} */ (C));

export { RzdBoard, Schedule, StopPoint, Track, Train, TrainCatalog, TrainLights, TrainManager, TrainMotion };
export { buildPath } from "./track-math.js";
export { advance, approachSpeed, brakingDistance, travelTime } from "./kinematics.js";
export { diffRows, rowTimes } from "./schedule-diff.js";
