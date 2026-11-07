// Земля и дальний план: земля до горизонта, город у горизонта, сопки, ряды деревьев.
import * as THREE from "three";
import { rgb } from "../colors.js";
import { flat } from "../engine/geometry.js";

export const nature = {
  /**
   * Земля до горизонта.
   * { type: "ground", y: -0.32, color: "ground", size: 12000 }
   */
  ground(p, ctx) {
    const size = p.size ?? 12000, y = p.y ?? -.32;
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, -size / 2 + 200);
    const mesh = new THREE.Mesh(g, ctx.material({ color: p.color ?? "ground", wet: true, snow: true, patternShadows: true }));
    ctx.add(mesh, { cast: false });
  },

  /**
   * Город у горизонта: коробки домов разной высоты в дымке.
   * { type: "skyline", seed: 7, count: 170, x: [-1300, 1300], z: [-900, -1800], gap: 60,
   *   height: [12, 82], width: [20, 80], colors: ["city", "city2", "city3"] }
   */
  skyline(p, ctx) {
    const random = ctx.random(p.seed ?? 7);
    const [x0, x1] = p.x ?? [-1300, 1300], [z0, z1] = p.z ?? [-900, -1800];
    const [h0, h1] = p.height ?? [12, 82], [w0, w1] = p.width ?? [20, 80];
    const colors = (p.colors ?? ["city", "city2", "city3"]).map(rgb);
    const items = [];
    for (let i = 0; i < (p.count ?? 170); i++) {
      const x = x0 + random() * (x1 - x0), z = z0 + random() * (z1 - z0);
      const w = w0 + random() * (w1 - w0), h = h0 + random() * (h1 - h0), d = 20 + random() * 40;
      if (Math.abs(x) < (p.gap ?? 60)) continue;
      items.push({ x, z, w, h, d, c: colors[Math.floor(random() * colors.length)] });
    }
    const mesh = new THREE.InstancedMesh(flat(new THREE.BoxGeometry(1, 1, 1)), ctx.material({ color: [1, 1, 1], haze: p.haze ?? 1.02, receive: false }), items.length);
    const m = new THREE.Matrix4();
    items.forEach((b, i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, b.h / 2 - .3, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d)));
      mesh.setColorAt(i, new THREE.Color(...b.c));
    });
    ctx.add(mesh, { cast: false });
  },

  /**
   * Сопки (горы) у горизонта: ломаные хребты, ближние темнее, дальние тонут в дымке.
   * { type: "hills", seed: 3, ridges: [{ z: -2200, height: [80, 260], color: "hills" }, ...], width: 9000 }
   */
  hills(p, ctx) {
    const random = ctx.random(p.seed ?? 3);
    const width = p.width ?? 9000;
    for (const ridge of p.ridges ?? [{ z: -2400, height: [80, 240] }]) {
      const n = 48, pts = [];
      let h = 0;
      for (let i = 0; i <= n; i++) {
        // сумма двух «волн» и случайности: пологие сопки с вершинами
        const t = i / n;
        h = ridge.height[0] + (ridge.height[1] - ridge.height[0]) * (.5 + .35 * Math.sin(t * 9 + random() * .6) * Math.sin(t * 3.3 + 1) + .15 * random());
        pts.push([-width / 2 + t * width, h]);
      }
      const pos = [];
      for (let i = 0; i < n; i++) {
        const [xa, ya] = pts[i], [xb, yb] = pts[i + 1], z = ridge.z, back = z - 400;
        // фасад хребта (наклонён к камере) и верхняя грань — две плоскости разного тона
        pos.push(xa, -1, z, xb, -1, z, xb, yb, z - 120, xa, -1, z, xb, yb, z - 120, xa, ya, z - 120);
        pos.push(xa, ya, z - 120, xb, yb, z - 120, xb, yb * .7, back, xa, ya, z - 120, xb, yb * .7, back, xa, ya * .7, back);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, ctx.material({ color: ridge.color ?? "hills", haze: ridge.haze ?? .8, receive: false, snow: true, side: THREE.DoubleSide }));
      ctx.add(mesh, { cast: false });
    }
  },

  /**
   * Ряды деревьев: крона из нескольких шаров в два тона (освещённая сторона и тень), ствол.
   * { type: "trees", seed: 17, rows: [{ x: -15, from: -30, to: -700, step: 9, spread: 5 }],
   *   size: [2.6, 4.8], trunk: [3.6, 6.6], colors: ["tree1", ...] }
   */
  trees(p, ctx) {
    const random = ctx.random(p.seed ?? 17);
    const colors = (p.colors ?? ["tree1", "tree2", "tree3", "tree4", "tree5"]).map(rgb);
    const [r0, r1] = p.size ?? [2.6, 4.8], [h0, h1] = p.trunk ?? [3.6, 6.6];
    const ground = p.y ?? -.32;
    const crowns = [], trunks = [];
    for (const row of p.rows ?? []) {
      for (let z = row.from; z > row.to; z -= row.step * (.8 + random() * .4)) {
        const r = r0 + random() * (r1 - r0), h = h0 + random() * (h1 - h0);
        const x = row.x + (random() - .5) * (row.spread ?? 5);
        const tone = colors[Math.floor(random() * colors.length)];
        crowns.push({ x, y: ground + h + r * .5, z, r: r * .95, c: tone });
        for (let q = 0; q < 4; q++) {
          crowns.push({ x: x + (random() - .5) * r * 1.3, y: ground + h + r * .5 + (random() - .2) * r * .9, z: z + (random() - .5) * r * 1.1, r: r * (.5 + random() * .3), c: tone });
        }
        trunks.push({ x, z, h: h + r * .2 });
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    // кроны — гладкие шары: тон считается по нормали в две полосы (cel), граница сглажена.
    // Ближние — подробнее, дальние (за 160 м) — проще: там шар всё равно в пару десятков пикселей
    const crownMat = ctx.material({ color: [1, 1, 1], toon: true, snow: true });
    const near = p.lod ?? 160;
    for (const [list, detail] of [[crowns.filter(c => Math.abs(c.z) < near), 2], [crowns.filter(c => Math.abs(c.z) >= near), 1]]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, detail), crownMat, list.length);
      list.forEach((c, i) => {
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.r, c.r * 1.02, c.r)));
        mesh.setColorAt(i, new THREE.Color(...c.c));
      });
      ctx.add(mesh, { cast: detail > 1 });
    }
    const trunkMesh = new THREE.InstancedMesh(flat(new THREE.CylinderGeometry(.2, .28, 1, 6)), ctx.material({ color: "trunk" }), trunks.length);
    trunks.forEach((t, i) => trunkMesh.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, ground + t.h / 2, t.z), q, new THREE.Vector3(1, t.h, 1))));
    ctx.add(trunkMesh, { cast: true });
  },

  /** Простая коробка-заготовка: { type: "box", x: [..], y: [..], z: [..], color: "wall", cast: true } */
  box(p, ctx) {
    if (p.cast === false) ctx.flatParts.box(p.x, p.y, p.z, p.color ?? "wall");
    else ctx.solid.box(p.x, p.y, p.z, p.color ?? "wall");
  },
};

