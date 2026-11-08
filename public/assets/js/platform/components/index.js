// Компоненты приложения TrainPaper (логика): регистрируются в движке, после чего их можно
// указывать в сценах по имени type, как встроенные.
// @ts-check
import { registerComponent } from "../../../../engine/index.js";
import { DepartureBoard } from "./departure-board.js";
import { RailTrack } from "./rail-track.js";
import { TrainTraffic } from "./train-traffic.js";

for (const C of [RailTrack, TrainTraffic, DepartureBoard]) registerComponent(/** @type {any} */ (C));

export { DepartureBoard, RailTrack, TrainTraffic };
