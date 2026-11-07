// Путь, контактная сеть, жёсткая поперечина и пешеходный мост.
import * as THREE from "three";
import { extrude, flat } from "../engine/geometry.js";

export const railway = {
  /**
   * Путь: балластная призма (шпалы — узором на её верхе, без ряби вдали) и два рельса.
   * { type: "track", track: "main", from: 6, to: -1500, gauge: 1.52 }
   */
  track(p, ctx) {
    const t = ctx.track(p.track), c = t.x, from = p.from ?? t.from ?? 6, to = p.to ?? t.to ?? -1500;
    const half = (p.gauge ?? 1.52) / 2;
    // призма: верх −0,2 м шириной 4,8 м, откосы до земли
    const prism = [[c - 3.1, -.33], [c - 2.4, -.2], [c + 2.4, -.2], [c + 3.1, -.33]];
    const g = extrude(prism, from, to, { center: [c, -2] });
    const mat = ctx.material({ color: "ballast", wet: true, snow: true, patternShadows: true,
      pattern: { type: "sleepers", x: c, half: 1.35, step: .55, width: .26, color: "sleeper" } });
    ctx.add(new THREE.Mesh(g, mat), { cast: false });
    for (const r of [c - half, c + half]) {
      ctx.wires.along(r + .03, -.1, from, to, .06, "rail");          // шейка рельса — в тени
      ctx.wires.along(r, -.035, from, to, .075, "railTop");          // головка — светлая полоса
    }
  },

  /**
   * Контактная сеть по типовому чертежу КС-160.4.1.050 («Промежуточная опора на прямой»):
   * железобетонная опора между путями, на ней для каждого пути изолированная консоль —
   * консоль (швеллер), тяга, подкос, подвесной изолятор, седло несущего троса, фиксаторный
   * изолятор и прямой фиксатор с изогнутым концом к контактному проводу. Несущий трос провисает
   * в пролёте, контактный провод идёт зигзагом ±0,3 м, струны в середине пролёта короче.
   * Поверху опор — кронштейн со штыревыми изоляторами и усиливающие провода.
   * { type: "catenary", x: 7.06, tracks: ["main", "second"], first: -30, span: 60, count: 18,
   *   height: 10.4, contact: 6.0, system: 1.8, feeders: true }
   * masts: false — без своих опор и консолей: провода подвешены к порталам (gantry) на высоте hangFrom.
   */
  catenary(p, ctx) {
    const MX = p.x, H = p.height ?? 10.4, SPAN = p.span ?? 60, RB = .24, RT = .14;
    const CONTACT = p.contact ?? 6.0, CARRIER = CONTACT + (p.system ?? 1.8), SAG = 1.1;
    const FEEDER = H + .2, FEEDER_SAG = 1.4;
    const tracks = (p.tracks ?? []).map(n => ctx.track(n).x);
    const ownMasts = p.masts !== false;
    const masts = [];
    for (let i = 0; i < (p.count ?? 18); i++) masts.push({ i, z: (p.first ?? -30) - SPAN * i });
    const mastR = y => RB + (RT - RB) * Math.max(0, y) / H;
    const zig = (i, dir) => (i % 2 ? .3 : -.3) * dir;
    const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const W = ctx.wires;

    // опоры: граненый конус, красный поясок, фундамент — instanced-мешами (по одному вызову на всё)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const cone = flat(new THREE.CylinderGeometry(RT, RB, H + .3, 8));
    cone.translate(0, (H + .3) / 2 - .3, 0);
    const band = flat(new THREE.CylinderGeometry(mastR(1.55) + .006, mastR(1.25) + .006, .3, 8));
    band.translate(0, 1.4, 0);
    const found = flat(new THREE.BoxGeometry(.84, .4, .84));
    found.translate(0, -.12, 0);
    for (const [geo, color] of ownMasts ? [[cone, "concrete"], [band, "mastBand"], [found, "foundation"]] : []) {
      const mesh = new THREE.InstancedMesh(geo, ctx.material({ color, snow: true }), masts.length);
      masts.forEach((mm, k) => mesh.setMatrixAt(k, m.compose(new THREE.Vector3(MX, 0, mm.z), q, one)));
      ctx.add(mesh, { cast: true });
    }
    if (ownMasts) for (const mm of masts) for (let y = 2.4; y < H; y += 1.7) W.add([MX - mastR(y), y, mm.z + .02], [MX + mastR(y), y, mm.z + .02], .02, "concreteDark");

    // консоль с тягой, подкосом, изоляторами и фиксатором — для пути с осью xc
    const consoleParts = (xc, z, i) => {
      const s = Math.sign(xc - MX);
      const face = y => MX + s * mastR(y);
      const kp = xc + zig(i, -s);
      const insTop = [xc, CARRIER + .62, z];
      const n6 = [face(CONTACT - .3), CONTACT - .3, z];                 // нижний узел крепления
      const dx = insTop[0] - n6[0], dy = insTop[1] - n6[1], len = Math.hypot(dx, dy);
      const tip = [insTop[0] + dx / len * .45, insTop[1] + dy / len * .45, z];
      const n5 = [face(insTop[1] + .32), insTop[1] + .32, z];           // верхний узел (тяга)
      W.add(n6, tip, .075, "steel");                                     // консоль
      W.add(n5, lerp3(n6, insTop, .9), .045, "steel");                   // тяга
      W.add(n5, lerp3(n6, insTop, .42), .04, "steel");                   // подкос
      W.insulator([n5[0] + s * .05, n5[1], z], [n5[0] + s * .5, n5[1] - .01, z], 3);
      W.insulator([n6[0] + s * .04, n6[1] + .02, z], lerp3(n6, insTop, .12), 3);
      W.insulator(insTop, [xc, CARRIER + .08, z], 4);                    // подвесной изолятор
      W.add([xc - .12, CARRIER + .04, z], [xc + .12, CARRIER + .04, z], .05, "steel");   // седло
      const hf = CONTACT + .45;
      const f0 = lerp3(n6, insTop, (hf - n6[1]) / (insTop[1] - n6[1]));
      const f1 = [f0[0] + s * .6, hf, z], f2 = [kp - s * .5, hf, z];
      W.insulator(f0, f1, 4);                                            // фиксаторный изолятор
      W.add(f1, f2, .035, "steel");                                      // фиксатор
      W.add(f2, [kp - s * .16, CONTACT + .15, z], .03, "steel");
      W.add([kp - s * .16, CONTACT + .15, z], [kp, CONTACT + .02, z], .03, "steel");
      W.add([xc, CARRIER, z], f2, .01, "wire");                          // поддерживающая струна
    };
    for (const mm of masts) {
      if (!ownMasts) {
        // подвес к поперечине портала: изолятор и седло над каждым путём
        for (const xc of tracks) {
          W.insulator([xc, p.hangFrom ?? CARRIER + .7, mm.z], [xc, CARRIER + .06, mm.z], 3);
          W.add([xc - .12, CARRIER + .04, mm.z], [xc + .12, CARRIER + .04, mm.z], .05, "steel");
          W.add([xc, CARRIER, mm.z], [xc + zig(mm.i, 1), CONTACT + .02, mm.z], .012, "steel");
        }
        continue;
      }
      for (const xc of tracks) consoleParts(xc, mm.z, mm.i);
      if (p.feeders !== false) {
        W.add([MX - .95, H - .25, mm.z], [MX + .95, H - .25, mm.z], .06, "steel");
        for (const dx of [-.8, .8]) W.insulator([MX + dx, H - .22, mm.z], [MX + dx, FEEDER, mm.z], 3);
      }
    }
    const carrierY = t => CARRIER - SAG * 4 * t * (1 - t);
    const contactY = t => CONTACT - .05 * 4 * t * (1 - t);
    for (const xc of tracks) {
      const s = ownMasts ? Math.sign(xc - MX) : 1, carrier = [], contact = [];
      // пролёт перед первой опорой — к камере и за спину
      const pre = [{ i: -1, z: masts[0].z + SPAN }, ...masts];
      for (let k = 0; k < pre.length - 1; k++) {
        const a = pre[k], b = pre[k + 1];
        for (let st = 0; st < SPAN; st += 5) {
          const t = st / SPAN;
          carrier.push([xc, carrierY(t), a.z - st]);
          contact.push([xc + zig(a.i, -s) + (zig(b.i, -s) - zig(a.i, -s)) * t, contactY(t), a.z - st]);
        }
        for (let st = 5; st < SPAN - 4; st += 6.5) {
          const t = st / SPAN, xk = xc + zig(a.i, -s) + (zig(b.i, -s) - zig(a.i, -s)) * t;
          W.add([xc + (xk - xc) * .15, carrierY(t), a.z - st], [xk, contactY(t) + .01, a.z - st], .006, "wire");
        }
      }
      W.line(carrier, .015, "wire");
      W.line(contact, .014, "wire");
    }
    if (ownMasts && p.feeders !== false) {
      for (const dx of [-.8, .8]) {
        const pts = [];
        for (let k = 0; k < masts.length - 1; k++) {
          for (let st = 0; st < SPAN; st += 5) {
            const t = st / SPAN;
            pts.push([MX + dx, FEEDER - FEEDER_SAG * 4 * t * (1 - t), masts[k].z - st]);
          }
        }
        W.line(pts, .018, "wire");
      }
    }
  },

  /**
   * Жёсткая поперечина: две решётчатые опоры и ферма над путями.
   * { type: "gantry", z: -62, x: [-5.4, 13], height: 9.2 }
   */
  gantry(p, ctx) {
    const z = p.z, [xa, xb] = p.x, H = p.height ?? 9.2, S = ctx.solid, W = ctx.wires;
    for (const x of [xa, xb]) S.box([x - .22, x + .22], [-.3, H], [z - .22, z + .22], "steel");
    S.box([xa - .2, xb + .2], [H - .45, H], [z - .2, z + .2], "steel");
    S.box([xa - .2, xb + .2], [H - 1.45, H - 1.22], [z - .15, z + .15], "steel");
    for (let x = xa; x < xb; x += 1.2) {
      W.add([x, H - 1.22, z + .15], [x + .6, H - .45, z + .15], .05, "steel");
      W.add([x + .6, H - .45, z + .15], [x + 1.2, H - 1.22, z + .15], .05, "steel");
    }
    for (const x of [xa, xb]) for (let y = .4; y < H - .4; y += .9) W.add([x - .22, y, z + .23], [x + .22, y + .45, z + .23], .04, "steel");
  },

  /**
   * Пешеходный мост через пути: опоры, пролёт с фермой.
   * { type: "footbridge", z: -165, x: [-40, 40], piers: [-9, 15], height: 7.2 }
   */
  footbridge(p, ctx) {
    const z = p.z, [xa, xb] = p.x ?? [-40, 40], h = p.height ?? 7.2, S = ctx.solid, W = ctx.wires;
    for (const x of p.piers ?? [-9, 15]) S.box([x - .8, x + .8], [-.3, h + .4], [z - .8, z + .8], "bridge");
    S.box([xa, xb], [h, h + .7], [z - 1.4, z + 1.4], "bridge");
    S.box([xa, xb], [h + 2.6, h + 3], [z - 1.4, z + 1.4], "bridge");
    for (const dz of [-1.38, 1.38]) {
      for (let x = xa; x < xb; x += 3) {
        W.add([x, h + .7, z + dz], [x + 1.5, h + 2.6, z + dz], .09, "bridge");
        W.add([x + 1.5, h + 2.6, z + dz], [x + 3, h + .7, z + dz], .09, "bridge");
      }
    }
  },
};
