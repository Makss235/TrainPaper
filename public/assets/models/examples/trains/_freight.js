// @ts-check
// Пример детальных моделей (examples): грузовые вагоны.
// Грузовые вагоны: крытый, цистерна, полувагон. Простые объёмы; рёбра жёсткости — узором шейдера
// (полосы с фильтрацией по пикселю), поэтому длинный состав вдали не рябит.
import * as THREE from "three";
import { geometry } from "../../../../engine/index.js";

const { Batch, boxGeometry, flat } = geometry;
import { addBogie } from "./_coach.js";

const BOTTOM = 1.2;                          // верх рамы над рельсом

function frame(parts, L) {
  parts.box([-1.45, 1.45], [BOTTOM - .32, BOTTOM], [.25, L - .25], "under");
  // автосцепки и буферные брусья
  for (const [z0, z1] of [[-.35, .25], [L - .25, L + .35]]) parts.box([-.16, .16], [1.0, 1.16], [z0, z1], "frame");
  for (const z of [.25, L - .25]) parts.box([-1.4, 1.4], [.88, 1.22], [z - .12, z + .12], "under");
  for (const zc of [2.1, L - 2.1]) addBogie(parts, zc, BOTTOM - .3, { wheelbase: 1.85 });
}

const shared = (key, make) => make();

/** Объект вагона: склеенные части (цвет у вершин) и, если есть, корпус с узором рёбер. */
function object(S, kit) {
  const toonCached = opts => kit.material(opts);
  const group = new THREE.Group();
  const parts = new THREE.Mesh(S.parts, toonCached({ vertexColors: true, wet: true, snow: true }));
  parts.userData.cast = true;
  group.add(parts);
  if (S.ribbed) {
    const mesh = new THREE.Mesh(S.ribbed, S.ribMaterial);
    mesh.userData.cast = true;
    group.add(mesh);
  }
  return group;
}

/* ---------- крытый вагон ---------- */

export const boxcar = {
  name: "Крытый вагон (детальный)",
  meta: { length: 14.7, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build: (p, kit) => object(shared("boxcar", () => {
    const L = 14.7, parts = new Batch(), top = 4.35;
    frame(parts, L);
    // стены — отдельным мешем с вертикальными рёбрами (узор по z)
    const ribbed = boxGeometry([-1.55, 1.55], [BOTTOM, top], [.15, L - .15]);
    // крыша-дуга
    const arc = [];
    for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; arc.push([-Math.cos(a) * 1.6, top + Math.sin(a) * .38]); }
    for (let i = 0; i < 8; i++) {
      const [xa, ya] = arc[i], [xb, yb] = arc[i + 1];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([xa, ya, .1, xb, yb, .1, xb, yb, L - .1, xa, ya, .1, xb, yb, L - .1, xa, ya, L - .1], 3));
      g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) g.setAttribute("position", new THREE.Float32BufferAttribute([xa, ya, .1, xb, yb, L - .1, xb, yb, .1, xa, ya, .1, xa, ya, L - .1, xb, yb, L - .1], 3));
      g.computeVertexNormals();
      parts.add(g, "#8a8f94");
    }
    // раздвижные двери посередине и их направляющие
    for (const s of [-1, 1]) {
      parts.box(s < 0 ? [-1.6, -1.55] : [1.55, 1.6], [BOTTOM + .1, top - .2], [L / 2 - 1.95, L / 2 + 1.95], "#6e3428");
      parts.box(s < 0 ? [-1.62, -1.55] : [1.55, 1.62], [top - .22, top - .14], [L / 2 - 2.4, L / 2 + 2.4], "frame");
    }
    return {
      parts: parts.geometry(), ribbed: flat(ribbed),
      ribMaterial: kit.material({ color: "#7b3e30", wet: true, pattern: { type: "stripes", step: .62 / 14.4, width: .1 / 14.4, strength: .35, color: "#5a2a20" } }),   // шаг — в долях грани (u 0…1 по длине)
    };
  }), kit),
};

/* ---------- цистерна ---------- */

export const tank = {
  name: "Цистерна (детальный)",
  meta: { length: 12.1, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build: (p, kit) => object(shared("tank", () => {
    const L = 12.1, parts = new Batch(), r = 1.45, cy = BOTTOM + r + .05;
    frame(parts, L);
    const body = flat(new THREE.CylinderGeometry(r, r, L - 1.0, 14, 1, false));
    body.rotateX(Math.PI / 2);
    body.translate(0, cy, L / 2);
    parts.add(body, "#2f3236");
    // днища — пологие конусы
    for (const [z, dir] of [[.5, -1], [L - .5, 1]]) {
      const end = flat(new THREE.ConeGeometry(r, .35, 14));
      end.rotateX(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      end.translate(0, cy, z + dir * .175);
      parts.add(end, "#2a2d31");
    }
    const dome = flat(new THREE.CylinderGeometry(.42, .42, .45, 10));
    dome.translate(0, cy + r + .15, L / 2);
    parts.add(dome, "#3a3e43");
    parts.box([-.35, .35], [cy + r - .05, cy + r + .02], [.8, L - .8], "#565b61");          // мостик
    parts.box([-r - .05, r + .05], [BOTTOM, BOTTOM + .25], [1.2, 1.5], "frame");
    parts.box([-r - .05, r + .05], [BOTTOM, BOTTOM + .25], [L - 1.5, L - 1.2], "frame");
    return { parts: parts.geometry() };
  }), kit),
};

/* ---------- полувагон ---------- */

export const gondola = {
  name: "Полувагон (детальный)",
  meta: { length: 13.9, gap: .7, tailLights: [[-1.2, 1.4], [1.2, 1.4]] },
  build: (p, kit) => object(shared("gondola", () => {
    const L = 13.9, parts = new Batch(), top = 3.25;
    frame(parts, L);
    // борта и торцы — тонкие стенки, внутри пусто
    const walls = [
      boxGeometry([-1.58, -1.5], [BOTTOM, top], [.1, L - .1]), boxGeometry([1.5, 1.58], [BOTTOM, top], [.1, L - .1]),
    ];
    for (const z of [.1, L - .18]) parts.box([-1.5, 1.5], [BOTTOM, top], [z, z + .08], "#4f5a40");
    parts.box([-1.5, 1.5], [BOTTOM, BOTTOM + .1], [.18, L - .18], "#3c4432");
    parts.box([-1.62, -1.5], [top - .1, top], [.1, L - .1], "#3f4734");
    parts.box([1.5, 1.62], [top - .1, top], [.1, L - .1], "#3f4734");
    const both = new Batch().add(walls[0], [1, 1, 1]).add(walls[1], [1, 1, 1]).geometry();
    return {
      parts: parts.geometry(), ribbed: both,
      ribMaterial: kit.material({ color: "#5d6b4b", vertexColors: true, wet: true, pattern: { type: "stripes", step: 1.15 / 13.7, width: .12 / 13.7, strength: .4, color: "#465237" } }),
    };
  }), kit),
};
