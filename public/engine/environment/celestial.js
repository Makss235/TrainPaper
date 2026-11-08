// Положение солнца (формулы NOAA, точность ~0,1°) и луны по координатам и времени.
// Луну считает библиотека SunCalc, если она подключена на странице (window.SunCalc), иначе луны нет.
// @ts-nocheck

const RAD = Math.PI / 180;

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

/** Солнце, луна и «восходит ли солнце» в момент date. */
/**
 * Солнце, луна и «восходит ли солнце» в момент date для точки lat, lon.
 * @param {Date} date @param {number} lat @param {number} lon
 */
export function celestial(date, lat, lon) {
  const sun = solarPosition(date, lat, lon);
  const later = solarPosition(new Date(date.getTime() + 600000), lat, lon);
  let moon = null;
  if (typeof window !== "undefined" && window.SunCalc) {
    const p = SunCalc.getMoonPosition(date, lat, lon);
    const ill = SunCalc.getMoonIllumination(date);
    moon = { altitude: p.altitude / RAD, azimuth: (p.azimuth / RAD + 180) % 360, fraction: ill.fraction, phase: ill.phase };
  }
  return { sun, moon, rising: later.altitude > sun.altitude };
}

