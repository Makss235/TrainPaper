// Положение солнца (формулы NOAA, точность ~0,1°) и луны (положение и фаза) по координатам и времени.
// Чистая математика: без three.js и DOM — проверяется `node --test` (celestial.test.js).
//
// Формулы луны перенесены из SunCalc (https://github.com/mourner/suncalc),
// © 2011–2015 Vladimir Agafonkin, лицензия BSD-2-Clause. Точность — около 0,5°, для неба обоев достаточно.
// @ts-check

const RAD = Math.PI / 180;
const DAY_MS = 86400000, J1970 = 2440588, J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

/**
 * Солнце: высота и азимут (°, азимут от севера по часовой).
 * @param {Date} date @param {number} lat @param {number} lon
 */
export function solarPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const century = (jd - 2451545) / 36525;
  const meanLongitude = ((280.46646 + century * (36000.76983 + century * .0003032)) % 360 + 360) % 360;
  const meanAnomaly = (357.52911 + century * (35999.05029 - .0001537 * century)) * RAD;
  const center = Math.sin(meanAnomaly) * (1.914602 - century * (.004817 + .000014 * century)) +
    Math.sin(2 * meanAnomaly) * (.019993 - .000101 * century) + Math.sin(3 * meanAnomaly) * .000289;
  const omega = (125.04 - 1934.136 * century) * RAD;
  const longitude = (meanLongitude + center - .00569 - .00478 * Math.sin(omega)) * RAD;
  const obliquity = (23 + (26 + (21.448 - century * (46.815 + century * (.00059 - century * .001813))) / 60) / 60 +
    .00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(longitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude));
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545) +
    .000387933 * century * century - century * century * century / 38710000) * RAD;
  const hourAngle = ((gmst + lon * RAD - rightAscension + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const latitude = lat * RAD;
  const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = (Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)) / RAD + 180) % 360;
  return { altitude: altitude / RAD, azimuth };
}

// ---------- луна (по SunCalc) ----------

/** @param {Date} date */
const toDays = date => date.valueOf() / DAY_MS - .5 + J1970 - J2000;
/** @param {number} l @param {number} b */
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
/** @param {number} l @param {number} b */
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
/** @param {number} d @param {number} lw */
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;
/** Поправка на рефракцию у горизонта. @param {number} h */
const refraction = h => .0002967 / Math.tan(Math.max(0, h) + .00312536 / (Math.max(0, h) + .08901179));

/** @param {number} d */
function sunCoords(d) {
  const M = RAD * (357.5291 + .98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + .02 * Math.sin(2 * M) + .0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

/** @param {number} d */
function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);      // средняя долгота
  const M = RAD * (134.963 + 13.064993 * d);      // средняя аномалия
  const F = RAD * (93.272 + 13.22935 * d);        // средний аргумент широты
  const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/**
 * Луна: высота и азимут (°, азимут от севера по часовой), расстояние (км).
 * @param {Date} date @param {number} lat @param {number} lon
 */
export function moonPosition(date, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  h += refraction(h);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
  return { altitude: h / RAD, azimuth: ((az / RAD + 180) % 360 + 360) % 360, distance: c.dist };
}

/**
 * Фаза луны: fraction — освещённая доля диска 0…1; phase — 0 новолуние, 0,25 первая четверть,
 * 0,5 полнолуние, 0,75 последняя четверть.
 * @param {Date} date
 */
export function moonIllumination(date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: .5 + .5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
}

/**
 * @typedef {object} Celestial
 * @property {{altitude: number, azimuth: number}} sun
 * @property {{altitude: number, azimuth: number, fraction: number, phase: number}} moon
 * @property {boolean} rising  солнце поднимается (утро)
 */

/**
 * Солнце, луна и «восходит ли солнце» в момент date для точки lat, lon.
 * @param {Date} date @param {number} lat @param {number} lon
 * @returns {Celestial}
 */
export function celestial(date, lat, lon) {
  const sun = solarPosition(date, lat, lon);
  const later = solarPosition(new Date(date.getTime() + 600000), lat, lon);
  const p = moonPosition(date, lat, lon), ill = moonIllumination(date);
  const moon = { altitude: p.altitude, azimuth: p.azimuth, fraction: ill.fraction, phase: ill.phase };
  return { sun, moon, rising: later.altitude > sun.altitude };
}
