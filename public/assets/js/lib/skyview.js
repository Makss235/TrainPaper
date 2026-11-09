// @ts-check
// Небо: градиент по высоте солнца, звёзды, солнце и луна — общее для обоих видов.
import { clamp, mix, rgba } from "./color.js";
import { initGrain } from "./grain.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

export function initStars(count = 110) {
  initGrain();
  let seed = 7;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  $("stars").innerHTML = Array.from({ length: count }, () =>
    `<i style="left:${rnd() * 100}%;top:${rnd() * 62}%;opacity:${.25 + rnd() * .75};transform:scale(${.6 + rnd() * .9})"></i>`).join("");
}

/**
 * opts.horizon — высота горизонта в px; opts.view — куда смотрит камера (азимут, °);
 * opts.fov — сколько градусов неба помещается по ширине; opts.span — высота солнца (°) у верха кадра.
 */
export function renderSky(env, sky, { horizon, view = 230, fov = 140, span = 55 }) {
  const W = innerWidth;
  const toXY = (az, alt) => {
    const dx = ((az - view + 540) % 360) - 180;
    return [W * (.5 + dx / fov), horizon * (1 - alt / span)];
  };
  const [sx, sy] = toXY(sky.sun.azimuth, sky.sun.altitude);
  const glow = env.glow;
  $("sky").style.background =
    `radial-gradient(ellipse ${W * .7}px ${horizon * .9}px at ${clamp(sx, -W * .2, W * 1.2)}px ${sy}px,${rgba([255, 150, 70], glow * .6)},transparent 70%),` +
    `linear-gradient(${rgba(env.top)} 0px,${rgba(env.horizon)} ${horizon}px,${rgba(env.horizon)} 100%)`;
  const sunVisible = sky.sun.altitude > -1.5 && sx > -60 && sx < W + 60;
  $("sun").style.cssText = `transform:translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%);background:${rgba(env.sunColor)};` +
    `box-shadow:0 0 ${50 + glow * 70}px ${12 + glow * 22}px ${rgba(env.sunColor, .5)};display:${sunVisible ? "block" : "none"}`;
  const moon = sky.moon;
  if (moon) {
    const [mx, my] = toXY(moon.azimuth, moon.altitude);
    const visible = moon.altitude > -1 && mx > -40 && mx < W + 40;
    // освещённая доля: тень сбоку через inset box-shadow
    const k = 1 - moon.fraction, side = moon.phase < .5 ? -1 : 1;
    $("moon").style.cssText = `transform:translate(${mx.toFixed(1)}px,${my.toFixed(1)}px) translate(-50%,-50%);display:${visible ? "block" : "none"};` +
      `opacity:${((.35 + .65 * moon.fraction) * clamp((6 - sky.sun.altitude) / 10)).toFixed(3)};` +
      `box-shadow:inset ${side * k * 3.4}vmin 0 0 ${rgba(env.top, .92)},0 0 24px rgba(220,230,255,${.35 * moon.fraction})`;
  } else {
    $("moon").style.display = "none";
  }
  $("stars").style.opacity = env.stars.toFixed(3);

  // облака: днём белые с голубовато-серой тенью, на закате персиковые с лиловой, ночью — тёмные силуэты
  const night = clamp((-env.alt - 3) / 6);                 // облака темнеют только после заката
  let lit = mix([255, 255, 255], [255, 198, 158], env.glow * .85);
  lit = mix(lit, mix(env.top, [160, 170, 205], .3), night);
  let shade = mix(mix(env.top, env.horizon, .45), [255, 255, 255], .36);
  shade = mix(shade, mix([122, 98, 150], env.horizon, .35), env.glow * .7);
  shade = mix(shade, mix(env.top, [14, 18, 36], .3), night);
  const poster = $("poster").style;
  poster.setProperty("--cloud-lit", rgba(lit));
  poster.setProperty("--cloud-shade", rgba(shade));
  $("clouds").style.opacity = (1 - .35 * night).toFixed(3);          // ночью облака тоньше, сквозь них видно небо
  return { sx, sy };
}
