// Демо-расписание, когда сервера нет: правдоподобные поезда вокруг текущего момента.

const ROUTES = [
  ["САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "МОСКВА ОКТЯБРЬСКАЯ", "А"], ["МОСКВА ОКТЯБРЬСКАЯ", "МУРМАНСК", "А"],
  ["САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "АДЛЕР", "А"], ["КИСЛОВОДСК", "САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "С"],
  ["МОСКВА КАЗАНСКАЯ", "КАЗАНЬ ПАСС", "Г"], ["НОВОСИБИРСК-ГЛАВНЫЙ", "МОСКВА ЯРОСЛАВСКАЯ", "Н"],
  ["МОСКВА КИЕВСКАЯ", "СИМФЕРОПОЛЬ ПАСС", "С"], ["ЕКАТЕРИНБУРГ-ПАССАЖИРС", "САНКТ-ПЕТЕРБУРГ ЛАДОЖ.", "Е"],
  ["МОСКВА КУРСКАЯ", "НИЖНИЙ НОВГОРОД МОСКОВ", "Г"], ["САМАРА", "МОСКВА КАЗАНСКАЯ", "Й"],
  ["ПСКОВ-ПАСС", "МОСКВА ОКТЯБРЬСКАЯ", "А"], ["МОСКВА ЯРОСЛАВСКАЯ", "ВЛАДИВОСТОК", "Э"],
];
const SLOT = 11 * 60000;

function seeded(n) {
  let x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function demoBoard(station, now = Date.now()) {
  const name = (station.rzdName || station.name || "СТАНЦИЯ").toUpperCase();
  const base = Math.floor(now / SLOT);
  const trains = [];
  for (let k = -2; k <= 14; k++) {
    const slot = base + k, r = seeded(slot);
    const [from, to, letter] = ROUTES[Math.floor(r * ROUTES.length)];
    const kind = ["departure", "arrival", "transit"][slot % 3 < 0 ? 0 : slot % 3];
    const time = Math.round((slot * SLOT + seeded(slot + .5) * 5 * 60000) / 60000) * 60;
    const delay = seeded(slot + .3) < .25 ? Math.round(seeded(slot + .7) * 15) + 2 : 0;
    const number = String(1 + Math.floor(seeded(slot + .2) * 180)).padStart(3, "0") + letter;
    const event = (t, late) => ({ plan: t, actual: null, expected: t + late * 60 });
    trains.push({
      id: `demo:${slot}`, kind, number, numberChange: null, numberLat: null, start: null,
      from: kind === "departure" ? name : from, to: kind === "arrival" ? name : to,
      arrival: kind === "departure" ? null : event(time, delay),
      departure: kind === "arrival" ? null : event(time + (kind === "transit" ? 300 : 0), delay),
      platform: String(1 + Math.floor(r * 6)), track: String(2 + Math.floor(seeded(slot + .9) * 9)),
      status: k <= 0 ? "IN" : "WAITING", delay, position: null, positionTime: null, type: "long", extraCars: null,
    });
  }
  return {
    station: { id: station.id, name, utcOffset: station.utcOffset ?? 180, lat: station.lat ?? 55.75, lon: station.lon ?? 37.62 },
    updated: Math.floor(now / 1000), stale: false, trains, demo: true,
  };
}
