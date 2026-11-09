// @ts-check
// Положение солнца и луны (формулы — engine/environment/celestial.js) и опорные моменты суток.

// Формулы — общие с движком: чистый модуль без three.js и DOM (engine/environment/celestial.js).
import { celestial, solarPosition } from "../../../engine/environment/celestial.js";

export { celestial, solarPosition };

/**
 * Опорные моменты суток для предпросмотра: восход, полдень, закат, полночь.
 * Ищем перебором по местным суткам станции (шаг 2 минуты) — работает и в полярную ночь,
 * тогда «восходом» станет момент, когда солнце ближе всего к горизонту.
 */
/** @param {number} nowMs @param {number} lat @param {number} lon @param {number} utcOffsetMin */
export function dayMarks(nowMs, lat, lon, utcOffsetMin) {
  const offset = utcOffsetMin * 60000;
  const localMidnight = Math.floor((nowMs + offset) / 86400000) * 86400000 - offset;
  const step = 120000;
  let noon = localMidnight, midnight = localMidnight, maxAlt = -99, minAlt = 99;
  let sunrise = null, sunset = null, prev = null;
  for (let t = localMidnight; t <= localMidnight + 86400000; t += step) {
    const alt = solarPosition(new Date(t), lat, lon).altitude;
    if (alt > maxAlt) { maxAlt = alt; noon = t; }
    if (alt < minAlt) { minAlt = alt; midnight = t; }
    if (prev !== null) {
      if (prev < -.83 && alt >= -.83 && sunrise === null) sunrise = t;
      if (prev >= -.83 && alt < -.83 && sunset === null) sunset = t;
    }
    prev = alt;
  }
  // без восхода (полярная ночь/день) берём середину между экстремумами
  const fallbackRise = noon - (noon - midnight + 86400000) % 86400000 / 2;
  return {
    sunrise: sunrise ?? fallbackRise,
    noon,
    sunset: sunset ?? noon + 3 * 3600000,
    midnight: midnight < noon ? midnight + 86400000 : midnight,
  };
}
