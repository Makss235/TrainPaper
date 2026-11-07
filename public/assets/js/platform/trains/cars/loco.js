// Электровозы: пассажирский (красный, как ЭП2К/ЭП20 в ливрее РЖД) и грузовой (секция «Синары»-
// подобного двухсекционного). Кабина — у торца z = length: нижняя часть лба вертикальная, лобовое
// стекло наклонено назад. Пантографы на крыше: передний поднят к контактному проводу.
import * as THREE from "three";
import { MATERIALS } from "../../../lib/palette.js";
import { Batch, cap, extrude, merge, panel, wall } from "../../engine/geometry.js";
import { GlowBatch } from "../../engine/glows.js";
import { toonCached } from "../../engine/materials.js";
import { WireBatch } from "../../engine/wires.js";
import { addBogie } from "../coach.js";
import { drawLogo, liveryCanvas, liveryTexture } from "../livery.js";

/**
 * Спецификация локомотива:
 *   length, half, bottom, wallTop, cant (профиль верха [[внутрь, вверх]]), rake (насколько завален лоб, м),
 *   windshield — низ лобового стекла (м над рельсом), cabs: ["front"] или ["front", "rear"],
 *   paint(g, W, H, X, Y) — ливрея борта, colors { roof, front, band }, pantographs: [z...], bogies: [z...]
 */
function buildLoco(spec) {
  if (spec.shared) return spec.shared;
  const L = spec.length, H = spec.half, B = spec.bottom, T = spec.wallTop, rake = spec.rake ?? .6;
  const ws = spec.windshield ?? 2.55;
  const vScale = T - B;
  const canvas = liveryCanvas(2048, Math.round(2048 / L * vScale));
  const ppm = canvas.width / L;
  const paint = () => {
    const g = canvas.getContext("2d");
    spec.paint(g, canvas.width, canvas.height, z => z * ppm, y => (1 - (y - B) / vScale) * canvas.height, ppm);
  };
  paint();
  const tex = liveryTexture(canvas);
  document.fonts?.ready.then(() => { paint(); tex.needsUpdate = true; });
  const cabs = spec.cabs ?? ["front"];
  const front = cabs.includes("front"), rear = cabs.includes("rear");
  const sides = [], parts = new Batch(), glass = [];
  const cant = spec.cant;
  for (const side of [-1, 1]) {
    const x = side * H;
    // контур борта: у кабины верх срезан наклоном лобового стекла
    const pts = [[0, B], [L, B], [L, ws], [front ? L - rake : L, T], [rear ? rake : 0, T], [0, ws]];
    const uv = (z, y) => [side < 0 ? z / L : 1 - z / L, (y - B) / vScale];
    sides.push(wall(pts, [], (z, y) => [x, y, z], [side, 0, 0], uv));
    // окна кабины на борту
    for (const cab of cabs) {
      const z0 = cab === "front" ? L - 2.45 : 1.0, z1 = cab === "front" ? L - 1.05 : 2.4;
      const win = [[z0, 2.85], [z1, 2.85], [z1, 3.62], [z0, 3.62]];
      glass.push(panel(win, (z, y) => [x + side * .012, y, z], [side, 0, 0]));
    }
  }
  // скат крыши и крыша
  const prof = side => cant.map(([dx, dy]) => [side * (H - dx), T + dy]);
  const roofProfile = [...prof(-1), ...prof(1).reverse().slice(1)];
  const z0 = rear ? rake : 0, z1 = front ? L - rake : L;
  parts.add(extrude(roofProfile, z0, z1, { center: [0, B + 1] }), spec.colors?.roof ?? "red");
  // торцы: вертикальный низ лба, наклонное лобовое стекло, торец крыши
  const top = T + cant.at(-1)[1];
  for (const [isCab, zEnd, dir] of [[rear, 0, -1], [front, L, 1]]) {
    if (isCab) {
      parts.add(cap([[-H, B], [H, B], [H, ws], [-H, ws]], zEnd, dir), spec.colors?.front ?? "red");
      const zr = zEnd - dir * rake;
      const lobe = new THREE.BufferGeometry();
      lobe.setAttribute("position", new THREE.Float32BufferAttribute([-H, ws, zEnd, H, ws, zEnd, H, T, zr, -H, ws, zEnd, H, T, zr, -H, T, zr], 3));
      lobe.computeVertexNormals();
      if (lobe.attributes.normal.getZ(0) * dir < 0) lobe.setAttribute("position", new THREE.Float32BufferAttribute([-H, ws, zEnd, H, T, zr, H, ws, zEnd, -H, ws, zEnd, -H, T, zr, H, T, zr], 3));
      lobe.computeVertexNormals();
      parts.add(lobe, spec.colors?.front ?? "red");
      parts.add(cap(roofProfile, zr, dir), spec.colors?.roof ?? "red");
      // лобовые стёкла — на наклонной плоскости, чуть впереди неё
      const n = new THREE.Vector3(0, rake, dir * (T - ws)).normalize();
      for (const [xa, xb] of [[-H + .18, -.06], [.06, H - .18]]) {
        const a = .12, b = .9;
        const pt = (xx, t) => [xx + n.x * .015, ws + (T - ws) * t + n.y * .015, zEnd - dir * rake * t + n.z * .015];
        const g = new THREE.BufferGeometry();
        const P = [pt(xa, a), pt(xb, a), pt(xb, b), pt(xa, b)];
        const order = dir > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        g.setAttribute("position", new THREE.Float32BufferAttribute(order.flatMap(i => P[i]), 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(order.flatMap(i => [[0, 0], [1, 0], [1, 1], [0, 1]][i]), 2));
        g.computeVertexNormals();
        glass.push(g);
      }
      // буферный брус и сцепка
      parts.box([-H + .1, H - .1], [B - .05, B + .32], dir > 0 ? [zEnd, zEnd + .18] : [zEnd - .18, zEnd], spec.colors?.band ?? "band");
      parts.box([-.18, .18], [B - .02, B + .22], dir > 0 ? [zEnd, zEnd + .5] : [zEnd - .5, zEnd], "frame");
    } else {
      const full = [[-H, B], ...prof(-1), ...prof(1).reverse().slice(1), [H, B]];
      parts.add(cap(full, zEnd, dir), spec.colors?.end ?? "darkend");
    }
  }
  // низ и тележки
  parts.box([-H + .15, H - .15], [B - .5, B], [.6, L - .6], "under");
  for (const zc of spec.bogies ?? [4.2, L - 4.2]) addBogie(parts, zc, B, { wheelbase: 2.9 });
  for (const zc of spec.roofBoxes ?? []) parts.box([-.9, .9], [top - .05, top + .22], zc, "roofbox");

  // пантографы: рама на изоляторах, рычаги и полоз; поднятый касается контактного провода
  const wires = new WireBatch();
  (spec.pantographs ?? []).forEach((zc, i) => {
    const raised = i === (front ? spec.pantographs.length - 1 : 0);
    const h = raised ? 6.0 - .02 : top + .45;
    for (const x of [-.55, .55]) wires.insulator([x, top, zc - .6], [x, top + .22, zc - .6], 2).insulator([x, top, zc + .6], [x, top + .22, zc + .6], 2);
    wires.add([-.6, top + .22, zc - .6], [.6, top + .22, zc - .6], .06, "steel").add([-.6, top + .22, zc + .6], [.6, top + .22, zc + .6], .06, "steel");
    const knee = raised ? [0, (top + h) / 2 + .2, zc - 1.1] : [0, top + .32, zc - 1.4];
    for (const x of [-.3, .3]) {
      wires.add([x, top + .25, zc + .5], [x, knee[1], knee[2]], .05, "steel");
      wires.add([x, knee[1], knee[2]], [x * .4, h, zc], .04, "steel");
    }
    wires.add([-.95, h, zc], [.95, h, zc], .05, "frame");
  });

  spec.shared = {
    sides: merge(sides), tex,
    parts: parts.geometry(),
    glass: merge(glass.map(g => {
      g = g.index ? g.toNonIndexed() : g;
      const c = new Float32Array(g.attributes.position.count * 3);
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      return g;
    })),
    wires,
  };
  return spec.shared;
}

function locoObject(spec) {
  const S = buildLoco(spec);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(S.sides, toonCached({ map: S.tex, wet: true })));
  group.add(new THREE.Mesh(S.parts, toonCached({ vertexColors: true, wet: true, snow: true })));
  group.add(new THREE.Mesh(S.glass, toonCached({ glass: true, vertexColors: true, offset: 2 })));
  group.children.forEach((m, i) => { m.userData.cast = i < 2; });
  const w = S.wires.build();
  group.add(w);
  // фары: две нижних и прожектор над стеклом; горят всегда, ночью ярче
  const L = spec.length, H = spec.half;
  const glows = new GlowBatch();
  if ((spec.cabs ?? ["front"]).includes("front")) {
    for (const x of [-H + .45, H - .45]) {
      glows.add([x, spec.bottom + .55, L + .08], .5, [1, .97, .88], { night: false, intensity: .55 });
      glows.add([x, spec.bottom + .55, L + .08], 1.1, [1, .95, .82], { night: true, intensity: .6 });
    }
    glows.add([0, spec.wallTop + .12, L - (spec.rake ?? .6) - .05], .9, [1, .97, .9], { night: true, intensity: .5 });
  }
  group.add(glows.build());
  return group;
}

/* ---------- пассажирский электровоз ---------- */

const EP = {
  length: 19.6, half: 1.58, bottom: 1.0, wallTop: 4.0, rake: .62, windshield: 2.6,
  cant: [[0, 0], [.06, .18], [.2, .32], [.45, .42], [.9, .48], [1.58, .5]],
  pantographs: [6.2, 13.4],
  roofBoxes: [[8.2, 11.4]],
  colors: { roof: [.78, .08, .08], front: "red", band: "band" },
  paint(g, W, H, X, Y, ppm) {
    // красный кузов, светлая волна и тёмно-серый низ, белый логотип, жалюзи
    g.fillStyle = MATERIALS.red; g.fillRect(0, 0, W, H);
    g.fillStyle = MATERIALS.band; g.fillRect(0, Y(1.62), W, H - Y(1.62));
    g.fillStyle = "#c9cbce";
    g.beginPath(); g.moveTo(0, Y(1.62)); g.lineTo(W, Y(1.62)); g.lineTo(W, Y(1.86));
    g.bezierCurveTo(X(15), Y(1.86), X(12), Y(2.45), X(8), Y(2.45)); g.lineTo(0, Y(2.45)); g.closePath(); g.fill();
    g.fillStyle = "#a81414";
    for (let z = 4.4; z < 14.6; z += 1.45) { g.beginPath(); g.roundRect(X(z), Y(3.6), ppm * .95, Y(2.85) - Y(3.6), ppm * .05); g.fill(); }
    drawLogo(g, X(5.6), Y(2.25), ppm * .55, "#ffffff");
    g.fillStyle = MATERIALS.frame;
    g.fillRect(X(16.1), Y(3.75), ppm * .05, Y(1.7) - Y(3.75));
  },
};

export const locoEp = {
  name: "Пассажирский электровоз",
  length: EP.length,
  gap: .9,
  headLights: true,
  tailLights: [[-1.05, 1.5], [1.05, 1.5]],
  build: () => locoObject(EP),
};

/* ---------- грузовой электровоз (секция) ---------- */

const FR = {
  length: 17.4, half: 1.56, bottom: 1.05, wallTop: 4.05, rake: .45, windshield: 2.7,
  cant: [[0, 0], [.08, .16], [.25, .3], [.6, .4], [1.56, .44]],
  pantographs: [11.8],
  roofBoxes: [[4.5, 9.5]],
  colors: { roof: "#5c6268", front: "#d8d9d6", band: "band" },
  paint(g, W, H, X, Y, ppm) {
    g.fillStyle = "#8a9096"; g.fillRect(0, 0, W, H);
    g.fillStyle = MATERIALS.red; g.fillRect(0, Y(2.05), W, Y(1.65) - Y(2.05));
    g.fillStyle = MATERIALS.band; g.fillRect(0, Y(1.65), W, H - Y(1.65));
    g.fillStyle = "#6c7278";
    for (let z = 3.4; z < 13; z += 1.3) g.fillRect(X(z), Y(3.6), ppm * .9, Y(2.9) - Y(3.6));
    drawLogo(g, X(7), Y(2.0), ppm * .32, "#ffffff");
  },
};

export const locoFreight = {
  name: "Грузовой электровоз (секция)",
  length: FR.length,
  gap: .9,
  headLights: true,
  tailLights: [[-1.0, 1.55], [1.0, 1.55]],
  build: () => locoObject(FR),
};
