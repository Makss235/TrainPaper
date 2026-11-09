// Тесты астрономии: node --test. Эталоны луны посчитаны библиотекой SunCalc 1.9.0.
// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { celestial, moonIllumination, moonPosition, solarPosition } from "./celestial.js";

const MOON = [
  { date: "2023-12-07T20:57:51.785Z", lat: -27.161, lon: 159.307, alt: 67.7979, az: 8.946, fraction: .2593, phase: .82994 },
  { date: "2027-08-28T01:47:31.078Z", lat: -12.052, lon: 36.85, alt: 14.7501, az: 60.3347, fraction: .172, phase: .86388 },
  { date: "2020-03-11T01:39:25.826Z", lat: 16.781, lon: -42.101, alt: 48.7829, az: 108.1925, fraction: .97281, phase: .55273 },
  { date: "2025-07-24T10:20:45.977Z", lat: -57.379, lon: 119.997, alt: -23.3313, az: 279.2949, fraction: .00226, phase: .98485 },
];

test("луна: положение совпадает с SunCalc ±0,5°", () => {
  for (const c of MOON) {
    const p = moonPosition(new Date(c.date), c.lat, c.lon);
    assert.ok(Math.abs(p.altitude - c.alt) < .5, `высота ${p.altitude} ≠ ${c.alt}`);
    assert.ok(Math.abs(((p.azimuth - c.az + 540) % 360) - 180) < .5, `азимут ${p.azimuth} ≠ ${c.az}`);
  }
});

test("луна: фаза и освещённость совпадают с SunCalc", () => {
  for (const c of MOON) {
    const m = moonIllumination(new Date(c.date));
    assert.ok(Math.abs(m.fraction - c.fraction) < .005);
    assert.ok(Math.abs(m.phase - c.phase) < .005);
  }
});

test("солнце: в полдень летом в Москве высоко на юге, ночью под горизонтом", () => {
  const noon = solarPosition(new Date("2026-06-21T09:30:00Z"), 55.75, 37.62);
  assert.ok(noon.altitude > 55 && noon.altitude < 59, `высота ${noon.altitude}`);
  assert.ok(noon.azimuth > 170 && noon.azimuth < 190, `азимут ${noon.azimuth}`);
  const night = solarPosition(new Date("2026-12-21T21:00:00Z"), 55.75, 37.62);
  assert.ok(night.altitude < -40);
});

test("celestial: утром солнце восходит, вечером садится; луна есть всегда", () => {
  assert.equal(celestial(new Date("2026-06-21T03:00:00Z"), 55.75, 37.62).rising, true);
  assert.equal(celestial(new Date("2026-06-21T16:00:00Z"), 55.75, 37.62).rising, false);
  assert.ok(celestial(new Date(), 0, 0).moon);
});
