// @ts-check
// Пример детальной модели (examples): контактная сеть по типовому чертежу КС-160.4.1.050
// («Промежуточная опора на прямой»): железобетонная опора, для каждого пути изолированная консоль —
// консоль, тяга, подкос, подвесной изолятор, седло несущего троса, фиксаторный изолятор и фиксатор
// с изогнутым концом к контактному проводу; несущий трос с провисом, зигзаг контактного провода ±0,3 м,
// струны, усиливающие провода поверху опор. Параметры — как у простой station/catenary.
// Включается в assets/models/index.jsonc → aliases: "station/catenary": "examples/catenary.js".
export default {
  name: "Контактная сеть (детальная, КС-160)",
  params: {
    tracks: { type: "array", default: [-2.64, 2.64], doc: "Оси путей относительно линии опор (x), м" },
    span: { type: "number", default: 60, doc: "Пролёт, м" },
    count: { type: "number", default: 18, doc: "Число опор" },
    height: { type: "number", default: 10.4, doc: "Высота опоры, м" },
    contact: { type: "number", default: 6, doc: "Высота контактного провода, м" },
    system: { type: "number", default: 1.8, doc: "Высота несущего троса над контактным, м" },
    masts: { type: "boolean", default: true, doc: "Свои опоры (false — провода на порталах)" },
    feeders: { type: "boolean", default: true, doc: "Усиливающие провода поверху опор" },
    back: { type: "number", default: 60, doc: "Провода за спину камеры от первой опоры, м" },
  },
  build(p, kit) {
    const THREE = kit.THREE, flat = kit.geometry.flat, group = kit.group();
    const MX = 0, H = p.height ?? 10.4, SPAN = p.span ?? 60, RB = .24, RT = .14;
    const CONTACT = p.contact ?? 6.0, CARRIER = CONTACT + (p.system ?? 1.8), SAG = 1.1;
    const FEEDER = H + .2, FEEDER_SAG = 1.4;
    const tracks = p.tracks;
    const ownMasts = p.masts !== false;
    const masts = [];
    for (let i = 0; i < (p.count ?? 18); i++) masts.push({ i, z: -SPAN * i });
    const mastR = y => RB + (RT - RB) * Math.max(0, y) / H;
    const zig = (i, dir) => (i % 2 ? .3 : -.3) * dir;
    const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const W = kit.lines();

    // опоры: граненый конус, красный поясок, фундамент — instanced-мешами (по одному вызову на всё)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const cone = flat(new THREE.CylinderGeometry(RT, RB, H + .3, 8));
    cone.translate(0, (H + .3) / 2 - .3, 0);
    const band = flat(new THREE.CylinderGeometry(mastR(1.55) + .006, mastR(1.25) + .006, .3, 8));
    band.translate(0, 1.4, 0);
    const found = flat(new THREE.BoxGeometry(.84, .4, .84));
    found.translate(0, -.12, 0);
    for (const [geo, color] of ownMasts ? [[cone, "concrete"], [band, "mastBand"], [found, "foundation"]] : []) {
      const mesh = new THREE.InstancedMesh(geo, kit.material({ color, snow: true }), masts.length);
      masts.forEach((mm, k) => mesh.setMatrixAt(k, m.compose(new THREE.Vector3(MX, 0, mm.z), q, one)));
      mesh.computeBoundingSphere();
      group.add(mesh);
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
      const pre = [{ i: -1, z: masts[0].z + (p.back ?? SPAN) }, ...masts];
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
    group.add(W.build());
    return group;
  }
};
