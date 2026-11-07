// Контактная сеть — по типовому чертежу КС-160.4.1.050 («Промежуточная опора на прямой,
// зигзаг к опоре») и фото реальной подвески: железобетонная коническая опора между путями,
// на ней для каждого пути изолированная консоль:
//   1 — консоль (швеллер) от нижнего узла крепления (6) вверх за ось пути,
//   13 — тяга от верхнего узла (5) к концу консоли, подкос от узла 5 к середине консоли,
//   3 — подвесной изолятор под концом консоли, 7 — седло несущего троса (на 1,8 м выше КП),
//   4 — фиксаторный изолятор на консоли (Hф = 0,45 м над КП), 2 — прямой фиксатор
//       с изогнутым концом к контактному проводу (КП), 8 — поддерживающая струна к фиксатору.
// Несущий трос провисает в пролёте, контактный провод идёт зигзагом ±0,3 м от оси пути,
// струны в середине пролёта короче. Поверху опор — кронштейн со штыревыми изоляторами и
// усиливающие провода с большим провисом. У портала — жёсткая поперечина (ферма).
import { COLORS as C, TRACK, TRACK2 } from "./scene2d.js";

const MAST_X = 7.06, MAST_H = 10.4, R_BASE = .24, R_TOP = .14, SPAN = 60;
export const MASTS = [];
for (let i = -1; i < 17; i++) MASTS.push({ i, z: -30 - SPAN * i });
const CONTACT_Y = 6.0, SYSTEM_H = 1.8, CARRIER_Y = CONTACT_Y + SYSTEM_H, SAG = 1.1;
const FEEDER_Y = MAST_H + .2, FEEDER_SAG = 1.4;
const GANTRY_Z = -62;
const RED_BAND = [176, 74, 62], FOUNDATION = [158, 158, 152];

const mastR = y => R_BASE + (R_TOP - R_BASE) * Math.max(0, y) / MAST_H;
/** Зигзаг контактного провода в опоре i: к опоре и от опоры по очереди (dir — сторона опоры). */
const zigAt = (i, dir) => (i % 2 ? .3 : -.3) * dir;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Отрезки копим в «вёдра» по толщине и тону, чтобы рисовать немногими штрихами. */
class Wires {
  constructor(v) { this.v = v; this.buckets = new Map(); }
  add(a, b, widthM, base) {
    const v = this.v, mid = lerp3(a, b, .5);
    const d = v.dist(mid);
    const w = Math.max(.7, Math.round(widthM * v.f / d * 2) / 2);
    const fogBand = Math.min(6, Math.floor(d / 140));
    const key = `${w}|${fogBand}|${base.join()}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, bucket = { w, at: [mid[0], mid[1], -fogBand * 140 - 70], base, segs: [] });
    bucket.segs.push(a, b);
  }
  line(pts, widthM, base) { for (let i = 1; i < pts.length; i++) this.add(pts[i - 1], pts[i], widthM, base); }
  /** Изолятор: стержень и тарелки-рёбра поперёк него. */
  insulator(a, b, sheds = 4) {
    this.add(a, b, .045, C.insulator);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * .085, ny = dx / l * .085;
    for (let k = 1; k <= sheds; k++) {
      const p = lerp3(a, b, k / (sheds + 1));
      this.add([p[0] - nx, p[1] - ny, p[2]], [p[0] + nx, p[1] + ny, p[2]], .028, C.insulator);
    }
  }
  draw(ctx) {
    const v = this.v;
    ctx.lineCap = "round";
    for (const b of this.buckets.values()) {
      ctx.beginPath();
      for (let i = 0; i < b.segs.length; i += 2) v.seg(ctx, b.segs[i], b.segs[i + 1]);
      ctx.lineWidth = b.w;
      ctx.strokeStyle = v.shade(b.base, [0, 0, 1], [v.pos[0], b.at[1], b.at[2]]);
      ctx.stroke();
    }
  }
}

/** Опора: конус из двух граней (освещённая и теневая половины), красный поясок, фундамент. */
function drawMast(v, ctx, z) {
  const at = [MAST_X, 4, z];
  if (v.dist(at) > 1200) return;
  const lit = v.light.L[0] < 0;                       // какая половина повёрнута к солнцу
  const half = (side, y0, y1, base, extraLit) => {
    const pts = side < 0
      ? [[MAST_X - mastR(y0), y0, z], [MAST_X, y0, z], [MAST_X, y1, z], [MAST_X - mastR(y1), y1, z]]
      : [[MAST_X, y0, z], [MAST_X + mastR(y0), y0, z], [MAST_X + mastR(y1), y1, z], [MAST_X, y1, z]];
    const toSun = (side < 0) === lit;
    v.fill(ctx, pts, v.shade(base, [side * .8, 0, .6], at, { extra: toSun ? extraLit : -.05 }));
  };
  for (const side of [-1, 1]) {
    half(side, -.3, MAST_H, C.concrete, .03);
    half(side, 1.25, 1.55, RED_BAND, .02);
  }
  v.box(ctx, FOUNDATION, [MAST_X - .42, MAST_X + .42], [-.32, .08], [z - .42, z + .42]);
  // пояски бетона
  ctx.beginPath();
  for (let y = 2.4; y < MAST_H; y += 1.7) v.seg(ctx, [MAST_X - mastR(y), y, z], [MAST_X + mastR(y), y, z]);
  ctx.lineWidth = Math.max(.6, .025 * v.f / v.dist(at));
  ctx.strokeStyle = v.shade(C.concreteDark, [0, 0, 1], at);
  ctx.stroke();
}

/** Консоль с тягой, подкосом, изоляторами и фиксатором для пути с осью xc — по чертежу. */
function consoleParts(w, xc, z, i) {
  const s = Math.sign(xc - MAST_X);
  const face = y => MAST_X + s * mastR(y);
  const kp = xc + zigAt(i, -s);                        // точка контактного провода
  const saddle = [xc, CARRIER_Y, z];                   // седло несущего троса над осью пути
  const insTop = [xc, CARRIER_Y + .62, z];             // верх подвесного изолятора — на консоли
  const n6 = [face(CONTACT_Y - .3), CONTACT_Y - .3, z]; // нижний узел крепления консоли
  const dir = [insTop[0] - n6[0], insTop[1] - n6[1], 0];
  const len = Math.hypot(dir[0], dir[1]);
  const tip = [insTop[0] + dir[0] / len * .45, insTop[1] + dir[1] / len * .45, z];
  const n5 = [face(insTop[1] + .32), insTop[1] + .32, z]; // верхний узел (тяга)
  w.add(n6, tip, .075, C.steel);                                   // 1 — консоль
  w.add(n5, lerp3(n6, insTop, .9), .045, C.steel);                 // 13 — тяга
  w.add(n5, lerp3(n6, insTop, .42), .04, C.steel);                 // подкос
  w.insulator([n5[0] + s * .05, n5[1], z], [n5[0] + s * .5, n5[1] - .01, z], 3);   // изоляция тяги у опоры
  w.insulator([n6[0] + s * .04, n6[1] + .02, z], lerp3(n6, insTop, .12), 3);       // изоляция консоли у опоры
  w.insulator(insTop, [xc, CARRIER_Y + .08, z], 4);                // 3 — подвесной изолятор
  w.add([xc - .12, CARRIER_Y + .04, z], [xc + .12, CARRIER_Y + .04, z], .05, C.steel);   // 7 — седло
  // 4 — фиксаторный изолятор на консоли и 2 — прямой фиксатор с изогнутым концом
  const hf = CONTACT_Y + .45;
  const f0 = lerp3(n6, insTop, (hf - n6[1]) / (insTop[1] - n6[1]));
  const f1 = [f0[0] + s * .6, hf, z];
  const f2 = [kp - s * .5, hf, z];
  w.insulator(f0, f1, 4);
  w.add(f1, f2, .035, C.steel);
  w.add(f2, [kp - s * .16, CONTACT_Y + .15, z], .03, C.steel);
  w.add([kp - s * .16, CONTACT_Y + .15, z], [kp, CONTACT_Y + .02, z], .03, C.steel);
  w.add(saddle, f2, .01, C.wire);                                  // 8 — поддерживающая струна
}

const carrierY = t => CARRIER_Y - SAG * 4 * t * (1 - t);
const contactY = t => CONTACT_Y - .05 * 4 * t * (1 - t);

export function drawCatenary(v, ctx) {
  for (let k = MASTS.length - 1; k >= 0; k--) if (MASTS[k].z < -1) drawMast(v, ctx, MASTS[k].z);
  const w = new Wires(v);
  for (const m of MASTS) {
    if (v.dist([MAST_X, 7, m.z]) > 1300) continue;
    for (const xc of [TRACK, TRACK2]) consoleParts(w, xc, m.z, m.i);
    // кронштейн поверху опоры и штыревые изоляторы усиливающих проводов
    w.add([MAST_X - .95, MAST_H - .25, m.z], [MAST_X + .95, MAST_H - .25, m.z], .06, C.steel);
    for (const dx of [-.8, .8]) w.insulator([MAST_X + dx, MAST_H - .22, m.z], [MAST_X + dx, FEEDER_Y, m.z], 3);
    w.add([MAST_X - .1, MAST_H, m.z], [MAST_X + .1, MAST_H, m.z], .12, C.steel);
  }
  for (const xc of [TRACK, TRACK2]) {
    const s = Math.sign(xc - MAST_X);
    const carrier = [], contact = [];
    for (let k = 0; k < MASTS.length - 1; k++) {
      const a = MASTS[k], b = MASTS[k + 1];
      for (let st = 0; st < SPAN; st += 5) {
        const t = st / SPAN;
        carrier.push([xc, carrierY(t), a.z - st]);
        contact.push([xc + zigAt(a.i, -s) + (zigAt(b.i, -s) - zigAt(a.i, -s)) * t, contactY(t), a.z - st]);
      }
      // струны: длинные у опор, короткие в середине пролёта
      for (let st = 5; st < SPAN - 4; st += 6.5) {
        const t = st / SPAN;
        const xk = xc + zigAt(a.i, -s) + (zigAt(b.i, -s) - zigAt(a.i, -s)) * t;
        w.add([xc + (xk - xc) * .15, carrierY(t), a.z - st], [xk, contactY(t) + .01, a.z - st], .006, C.wire);
      }
    }
    w.line(carrier, .015, C.wire);
    w.line(contact, .014, C.wire);
  }
  for (const dx of [-.8, .8]) {
    const pts = [];
    for (let k = 0; k < MASTS.length - 1; k++) {
      for (let st = 0; st < SPAN; st += 5) {
        const t = st / SPAN;
        pts.push([MAST_X + dx, FEEDER_Y - FEEDER_SAG * 4 * t * (1 - t), MASTS[k].z - st]);
      }
    }
    w.line(pts, .018, C.wire);
  }
  w.draw(ctx);
}

/** Жёсткая поперечина (портал из двух решётчатых опор и фермы) над путями. */
export function drawGantry(v, ctx) {
  const z = GANTRY_Z, steel = C.steel;
  for (const x of [-5.4, 13]) v.box(ctx, steel, [x - .22, x + .22], [-.3, 9.2], [z - .22, z + .22]);
  v.box(ctx, steel, [-5.6, 13.2], [8.75, 9.2], [z - .2, z + .2]);
  v.box(ctx, steel, [-5.6, 13.2], [7.75, 7.98], [z - .15, z + .15]);
  ctx.beginPath();
  for (let x = -5.4; x < 13; x += 1.2) {
    v.seg(ctx, [x, 7.98, z + .15], [x + .6, 8.75, z + .15]);
    v.seg(ctx, [x + .6, 8.75, z + .15], [x + 1.2, 7.98, z + .15]);
  }
  for (const x of [-5.4, 13]) for (let y = .4; y < 9; y += .9) v.seg(ctx, [x - .22, y, z + .22], [x + .22, y + .45, z + .22]);
  ctx.lineWidth = Math.max(.8, .05 * v.f / 62);
  ctx.strokeStyle = v.shade(steel, [0, 0, 1], [4, 8, z], { extra: -.15 });
  ctx.stroke();
}

/** Опоры и портал как тела, отбрасывающие тени. */
export function catenaryCasters(corners) {
  const list = MASTS.filter(m => m.z < 0).map(m => corners(MAST_X - .2, MAST_X + .2, -.3, MAST_H, m.z - .2, m.z + .2));
  for (const x of [-5.4, 13]) list.push(corners(x - .22, x + .22, -.3, 9.2, GANTRY_Z - .22, GANTRY_Z + .22));
  list.push(corners(-5.6, 13.2, 7.75, 9.2, GANTRY_Z - .2, GANTRY_Z + .2));
  return list;
}
