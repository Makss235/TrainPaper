// Платформа и всё, что на ней: пол с плиткой, жёлтая линия, тактильная полоса, кромка, навес,
// ограда, фонари, табло, табличка с названием станции.
// Высоты — над головкой рельса (y = 0); top — высота пола платформы (обычно 1,1 м).
import * as THREE from "three";
import { boxGeometry, panel, transform } from "../engine/geometry.js";
import { translit } from "../../lib/names.js";

const floorStrip = (x0, x1, y, from, to) => {
  const g = new THREE.PlaneGeometry(x1 - x0, from - to);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (from + to) / 2);
  return g;
};

export const platform = {
  /**
   * Пассажирская платформа вдоль пути. Полосы разметки — по расстоянию от края платформы, м.
   * { type: "platform", x: [-4.2, 2.5], top: 1.1, from: 6, to: -1500,
   *   edges: [1],               // у какого края путь: 1 — у правого (x1), -1 — у левого (x0), [-1, 1] — островная
   *   coping: 0.29,             // светлая кромка у края
   *   tactile: [0.29, 0.65],    // тактильная полоса (null — нет)
   *   line: [0.65, 0.8],        // жёлтая линия безопасности (null — нет)
   *   tiles: { step: [0.6, 0.6], width: 0.02 } }   // швы плитки (false — ровный пол)
   * Полосы не перекрываются: каждая точка пола принадлежит одной полосе — без мерцания.
   */
  platform(p, ctx) {
    const [x0, x1] = p.x, top = p.top ?? 1.1, from = p.from ?? 6, to = p.to ?? -1500;
    const edges = p.edges ?? [p.edgeSide ?? 1];
    const coping = p.coping ?? .29;
    const tact = p.tactile === null ? null : p.tactile ?? [coping, .65];
    const line = p.line === null ? null : p.line ?? [.65, .8];
    // полосы от каждого края внутрь: [ближе, дальше] — расстояния от края
    const bands = [{ d: [0, coping], color: "coping" }];
    if (tact) bands.push({ d: [Math.max(coping, tact[0]), tact[1]], color: "tactile" });
    if (line) bands.push({ d: [Math.max(bands.at(-1).d[1], line[0]), line[1]], color: "yellow" });
    const inner = bands.at(-1).d[1];
    const strips = [];
    let mid0 = x0, mid1 = x1;
    for (const e of edges) {
      const edge = e > 0 ? x1 : x0;
      for (const b of bands) strips.push({ x: [edge - e * b.d[1], edge - e * b.d[0]].sort((a, c) => a - c), color: b.color });
      if (e > 0) mid1 = x1 - inner; else mid0 = x0 + inner;
    }
    if (mid1 > mid0) strips.push({ x: [mid0, mid1], color: "platform", tiles: true });
    const tiles = p.tiles === false ? null : { type: "tiles", step: p.tiles?.step ?? [.6, .6], width: p.tiles?.width ?? .02, fade: p.tiles?.fade ?? 70, color: "tileLine" };
    for (const st of strips) {
      const mat = ctx.material({ color: st.color, wet: true, snow: true, patternShadows: true, ...(st.tiles && tiles ? { pattern: tiles } : {}) });
      ctx.add(new THREE.Mesh(floorStrip(st.x[0], st.x[1], top, from, to), mat), { cast: false });
    }
    // тело платформы: стенки с обеих сторон; у края к пути — тёмная щель под свесом кромки
    const wallMat = ctx.material({ color: "platformSide", wet: true });
    for (const e of [-1, 1]) {
      const edge = e > 0 ? x1 : x0;
      if (p.innerWall === false && !edges.includes(e)) continue;
      ctx.add(new THREE.Mesh(boxGeometry(e > 0 ? [edge - .3, edge] : [edge, edge + .3], [-.32, top - .005], [from, to]), wallMat), { cast: false });
      if (edges.includes(e)) ctx.wires.along(edge + e * .005, top - .03, from, to, .035, "gap");
    }
  },

  /**
   * Навес над платформой на колоннах.
   * { type: "canopy", x: [-4, 2.2], from: 2, to: -160, height: 4.6, thickness: 0.3, base: 1.1,
   *   columns: { x: [-1], step: 9 }, lamps: { step: 9, x: -1 } }
   */
  canopy(p, ctx) {
    const [x0, x1] = p.x, base = p.base ?? 1.1, h = base + (p.height ?? 4.6), th = p.thickness ?? .3;
    const from = p.from ?? 2, to = p.to ?? -160;
    ctx.solid.box([x0, x1], [h, h + th], [from, to], "canopy");
    ctx.solid.box([x0 - .05, x0 + .05], [h - .25, h + th], [from, to], "canopy");
    ctx.solid.box([x1 - .05, x1 + .05], [h - .25, h + th], [from, to], "canopy");
    // нижняя светлая обшивка — отдельным тоном
    ctx.flatParts.box([x0 + .06, x1 - .06], [h - .02, h], [from, to], "canopyUnder");
    const cols = p.columns ?? { x: [(x0 + x1) / 2], step: 9 };
    for (let z = from - (cols.offset ?? 3); z > to; z -= cols.step) {
      for (const cx of cols.x) {
        ctx.solid.box([cx - .14, cx + .14], [base, h], [z - .14, z + .14], "column");
        ctx.solid.box([cx - .22, cx + .22], [base, base + .12], [z - .22, z + .22], "column");
      }
    }
    if (p.lamps) {
      for (let z = from - (p.lamps.offset ?? 7); z > Math.max(to, -260); z -= p.lamps.step) {
        const lx = p.lamps.x ?? (x0 + x1) / 2;
        ctx.solid.box([lx - .5, lx + .5], [h - .12, h - .02], [z - .1, z + .1], "lamp");
        ctx.glows.add([lx, h - .14, z], 1.1, [1, .9, .72], { night: true, intensity: .55 });
        ctx.lamps.push({ position: [lx, h - .4, z], range: 8, intensity: .8 });
      }
    }
  },

  /**
   * Ограда: прутья (узором без ряби), стойки, двое перил; тень — аналитическим узором на пол.
   * { type: "fence", x: -4.2, base: 1.1, height: 1.12, from: 4, to: -700, step: 0.14, bar: 0.02, postStep: 2.5 }
   */
  fence(p, ctx) {
    const x = p.x, base = p.base ?? 1.1, top = base + (p.height ?? 1.12), low = base + .12;
    const from = p.from ?? 4, to = p.to ?? -700, step = p.step ?? .14, bar = p.bar ?? .02, postStep = p.postStep ?? 2.5;
    const g = new THREE.PlaneGeometry(from - to, top - low);
    g.rotateY(Math.PI / 2);
    g.translate(x, (top + low) / 2, (from + to) / 2);
    const mat = ctx.material({ color: "fence", side: THREE.DoubleSide, pattern: { type: "bars", step, width: bar, color: "fence" }, receive: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 1;
    ctx.add(mesh, { cast: false });
    for (const y of [top, low]) ctx.wires.along(x, y, from, to, .05, "fence");
    for (let z = from; z > Math.max(to, -420); z -= postStep) ctx.wires.add([x, base, z], [x, base + 1.2, z], .06, "fence");
    ctx.patterns.push({ x, y0: low, y1: top, step, bar, postStep, post: .06, rail: .025, rails: [top, low], from, to });
  },

  /**
   * Фонари вдоль платформы: столб, кронштейн, светильник; ночью — свет на пол и борт поезда.
   * { type: "lamps", x: -3.56, base: 1.1, height: 5.2, arm: 0.9, from: -14, to: -330, step: 24,
   *   extra: [6], toward: 1, light: { range: 10, intensity: 1 } }
   * toward — куда смотрит кронштейн (+1 — к большим x).
   */
  lamps(p, ctx) {
    const x = p.x, base = p.base ?? 1.1, h = base + (p.height ?? 5.2), arm = p.arm ?? .9, s = p.toward ?? 1;
    const zs = [...(p.extra ?? [])];
    for (let z = p.from ?? -14; z > (p.to ?? -330); z -= p.step ?? 24) zs.push(z);
    for (const z of zs) {
      ctx.solid.box([x - .06, x + .06], [base, h], [z - .06, z + .06], "post");
      ctx.solid.box(s > 0 ? [x, x + arm] : [x - arm, x], [h - .12, h - .04], [z - .04, z + .04], "post");
      const hx = x + s * (arm + .1);
      const head = new THREE.Mesh(boxGeometry([hx - .32, hx + .32], [h - .18, h - .04], [z - .15, z + .15]),
        ctx.material({ color: "lamp", emissiveNight: [1, .86, .56] }));
      ctx.add(head, { cast: true });
      ctx.glows.add([hx, h - .22, z], 1.7, [1, .92, .74], { night: true });
      ctx.lamps.push({ position: [hx, h - .5, z], range: p.light?.range ?? 11, intensity: p.light?.intensity ?? 1.15 });
    }
  },

  /**
   * Светодиодное табло на раме. screen: true — сюда натягивается живое табло с поездами.
   * { type: "board", x: [-3.2, -0.4], y: [3.37, 4.35], z: -6.3, depth: 0.22, base: 1.1, screen: true }
   */
  board(p, ctx) {
    const [x0, x1] = p.x, [y0, y1] = p.y, z = p.z, depth = p.depth ?? .22, base = p.base ?? 1.1;
    const S = ctx.solid;
    for (const x of [x0 - .08, x1 - .06]) S.box([x, x + .14], [base, y1 + .42], [z - .17, z - .03], "post");
    S.box([x0 - .2, x1 + .2], [y1 + .26, y1 + .42], [z - .2, z], "post");
    for (const x of [x0 + .3, x1 - .3]) S.box([x - .02, x + .02], [y1 + .04, y1 + .27], [z - .12, z - .08], "post");
    S.box([x0 - .05, x1 + .05], [y0 - .05, y1 + .05], [z - depth, z], "fence");
    if (p.screen !== false) {
      const m = .06, zz = z + .002;
      ctx.setBoardScreen([[x0 + m, y1 - m, zz], [x1 - m, y1 - m, zz], [x1 - m, y0 + m, zz], [x0 + m, y0 + m, zz]]);
      // ночью табло подсвечивает пол перед собой
      ctx.lamps.push({ position: [(x0 + x1) / 2, (y0 + y1) / 2, z + 1.2], range: 4.5, intensity: .35, color: [1, .78, .4] });
    }
  },

  /**
   * Табличка с названием станции (по-русски и латиницей) на двух стойках.
   * { type: "stationSign", x: -3.0, z: -44, base: 1.1, width: 3.2, height: 2.35, rotation: 0 }
   * rotation — поворот вокруг вертикали, °: 0 — лицом к камере (к +z), 90 — лицом к пути (к +x).
   * Название подставляется само при смене станции; text: "…" — задать вручную.
   */
  stationSign(p, ctx) {
    const base = p.base ?? 1.1, w = p.width ?? 3.2, h = .78, y0 = base + (p.height ?? 2.35);
    const M = transform([p.x, 0, p.z], [0, p.rotation ?? 0, 0]);
    // в своих осях: табличка в плоскости xy, лицом к +z, стойки по краям
    for (const dx of [-w / 2 + .25, w / 2 - .25]) ctx.solid.add(boxGeometry([dx - .04, dx + .04], [base, y0 + h], [-.04, .04]), "post", M);
    ctx.solid.add(boxGeometry([-w / 2 - .04, w / 2 + .04], [y0 - .04, y0 + h + .04], [-.05, .05]), "post", M);
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = Math.round(1024 * h / w);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const paint = name => {
      const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
      g.fillStyle = "#1f3f73"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#e21a1a"; g.fillRect(0, H - 14, W, 14);
      const fit = (text, size, weight, y, color) => {
        g.font = `${weight} ${size}px "Exo 2", sans-serif`;
        g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
        const k = Math.min(1, (W - 60) / g.measureText(text).width);
        g.save(); g.translate(W / 2, y); g.scale(k, 1); g.fillText(text, 0, 0); g.restore();
      };
      fit(name.toUpperCase(), H * .38, 700, H * .36, "#ffffff");
      fit(translit(name), H * .22, 500, H * .72, "#cfe0f5");
      tex.needsUpdate = true;
      ctx.invalidate();
    };
    paint(p.text || "Станция");
    for (const s of [1, -1]) {
      // с обеих сторон текст читается слева направо
      const g = panel([[-w / 2, y0], [w / 2, y0], [w / 2, y0 + h], [-w / 2, y0 + h]], (x, y) => [s > 0 ? x : -x, y, s * .052], [0, 0, s]);
      g.applyMatrix4(M);
      const mesh = new THREE.Mesh(g, ctx.material({ map: tex, litNight: [.55, .55, .6] }));
      ctx.add(mesh, { cast: false });
    }
    if (!p.text) ctx.onStation(info => info.name && paint(info.name));
    document.fonts?.ready.then(() => paint(p.text || ctx.stationName || "Станция"));
  },
};

