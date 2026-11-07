// Сцены станций и какая сцена у какой станции.
//
// SCENES — все сцены (их можно выбрать в панели настроек или адресом ?scene=id).
// STATION_SCENES — ID станции РЖД (внутренний ID табло, см. assets/data/stations.json) → id сцены.
// Станция без своей сцены показывается в «Типовой платформе».
// Новая сцена: скопируйте stations/_template.js и добавьте её сюда.
import murmansk from "./murmansk.js";
import spbGlavny from "./spb-glavny.js";
import typical from "./typical.js";

export const SCENES = [typical, spbGlavny, murmansk];

export const STATION_SCENES = {
  428: "spb-glavny",            // Санкт-Петербург-Главный
  197: "murmansk",              // Мурманск
};

export const DEFAULT_SCENE = "typical";

/** Сцена для станции: выбранная вручную (не "auto") или назначенная станции, иначе типовая. */
export function sceneFor(stationId, choice = "auto") {
  const id = choice && choice !== "auto" ? choice : STATION_SCENES[stationId] || DEFAULT_SCENE;
  return SCENES.find(s => s.id === id) || SCENES.find(s => s.id === DEFAULT_SCENE);
}
