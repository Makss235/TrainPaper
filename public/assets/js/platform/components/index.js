// Компоненты приложения TrainPaper (логика): регистрируются в движке, после чего их можно
// указывать в сценах по имени type, как встроенные. Железная дорога (пути, поезда, расписание) —
// отдельный модуль assets/js/rail/.
// @ts-check
import { registerComponent } from "../../../../engine/index.js";
import { DepartureBoard } from "./departure-board.js";
import { FlatTrain } from "./flat-train.js";

registerComponent(/** @type {any} */ (DepartureBoard));
registerComponent(/** @type {any} */ (FlatTrain));

export { DepartureBoard, FlatTrain };
