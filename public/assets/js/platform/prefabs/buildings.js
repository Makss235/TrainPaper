// Здания-заготовки (блокаут) и свои 3D-модели.
//
// building — быстрый объём здания: коробка, ряды окон (ночью светятся), карниз, крыша.
// Им удобно «набросать» вокзал, пока нет настоящей модели; потом заменить на { type: "model" }.
import * as THREE from "three";
import { panel, transform } from "../engine/geometry.js";
import { loadModel } from "../engine/assets.js";

export const buildings = {
  /**
   * Здание-заготовка.
   * { type: "building", x: [20, 60], y: [-0.3, 14], z: [-40, -110], color: "wall", roof: "roofDark",
   *   cornice: "trim", facade: "-x",            // какой стороной смотрит на пути: "-x" | "+x" | "+z" | "-z"
   *   windows: { rows: 3, step: 4.2, width: 1.6, height: 2.2, bottom: 2.5, gap: 3.4, color: "windowDark" },
   *   gable: 3 }                                 // высота двускатной крыши (0 — плоская)
   */
  building(p, ctx) {
    const [x0, x1] = p.x, [y0, y1] = p.y, [za, zb] = p.z;
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    ctx.solid.box([x0, x1], [y0, y1], [z0, z1], p.color ?? "wall");
    if (p.cornice !== null) ctx.solid.box([x0 - .25, x1 + .25], [y1 - .5, y1], [z0 - .25, z1 + .25], p.cornice ?? "trim");
    if (p.gable) {
      const ridge = new THREE.BufferGeometry();
      const xm = (x0 + x1) / 2, top = y1 + p.gable;
      const v = [x0 - .3, y1, z1 + .3, xm, top, z1 + .3, xm, top, z0 - .3, x0 - .3, y1, z1 + .3, xm, top, z0 - .3, x0 - .3, y1, z0 - .3,
        x1 + .3, y1, z0 - .3, xm, top, z0 - .3, xm, top, z1 + .3, x1 + .3, y1, z0 - .3, xm, top, z1 + .3, x1 + .3, y1, z1 + .3,
        x0 - .3, y1, z1 + .3, x1 + .3, y1, z1 + .3, xm, top, z1 + .3, x1 + .3, y1, z0 - .3, x0 - .3, y1, z0 - .3, xm, top, z0 - .3];
      ridge.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      ridge.computeVertexNormals();
      ctx.solid.add(ridge, p.roof ?? "roofDark");
    } else if (p.roof) {
      ctx.solid.box([x0 + .3, x1 - .3], [y1, y1 + .4], [z0 + .3, z1 - .3], p.roof);
    }
    const w = p.windows;
    if (!w) return;
    const facade = p.facade ?? "-x";
    const normal = { "-x": [-1, 0, 0], "+x": [1, 0, 0], "-z": [0, 0, -1], "+z": [0, 0, 1] }[facade];
    const along = facade.endsWith("x") ? [z0, z1] : [x0, x1];
    const place = facade === "-x" ? (s, t) => [x0 - .02, t, s] : facade === "+x" ? (s, t) => [x1 + .02, t, s]
      : facade === "-z" ? (s, t) => [s, t, z0 - .02] : (s, t) => [s, t, z1 + .02];
    const parts = [];
    const ww = w.width ?? 1.6, wh = w.height ?? 2.2, gap = w.gap ?? 3.4;
    for (let r = 0; r < (w.rows ?? 2); r++) {
      const t0 = y0 + (w.bottom ?? 2.5) + r * (w.step ?? 4.2);
      if (t0 + wh > y1 - .6) break;
      for (let s = along[0] + gap / 2; s + ww < along[1] - gap / 3; s += ww + gap) {
        parts.push(panel([[s, t0], [s + ww, t0], [s + ww, t0 + wh], [s, t0 + wh]], place, normal));
      }
    }
    if (!parts.length) return;
    const mat = ctx.material({ color: w.color ?? "windowDark", emissiveNight: w.night === false ? [0, 0, 0] : [.62, .5, .3], offset: 2 });
    for (const g of parts) ctx.add(new THREE.Mesh(g, mat), { cast: false });
  },

  /**
   * Своя 3D-модель (glTF/GLB — например, из Blender). Материалы сами переводятся в стиль сцены
   * (берутся базовый цвет и текстура, см. engine/materials.js stylizeModel).
   * { type: "model", url: "../assets/models/my-station.glb", position: [x, y, z], rotation: [0, 90, 0],
   *   scale: 1, cast: true, receive: true, snow: false,
   *   repeat: { count: 6, step: [0, 0, -12] } }   // одинаковые копии (скамейки вдоль платформы) — одним мешем
   * Путь url — от страницы public/platform/. Модель грузится в фоне: сцена появляется сразу.
   */
  async model(p, ctx) {
    const root = await loadModel(p.url, { receive: p.receive !== false, snow: !!p.snow });
    const base = transform(p.position, p.rotation, p.scale ?? 1);
    const count = p.repeat?.count ?? 1, step = p.repeat?.step ?? [0, 0, 0];
    root.updateMatrixWorld(true);
    const group = new THREE.Group();
    root.traverse(obj => {
      if (!obj.isMesh) return;
      const mesh = new THREE.InstancedMesh(obj.geometry, obj.material, count);
      for (let i = 0; i < count; i++) {
        const offset = new THREE.Matrix4().makeTranslation(step[0] * i, step[1] * i, step[2] * i);
        mesh.setMatrixAt(i, offset.multiply(base).multiply(obj.matrixWorld));
      }
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
    ctx.add(group, { cast: p.cast !== false });
    ctx.invalidate("scene", "shadow");
  },
};

