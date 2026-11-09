// Набор для построения JS-моделей: модель получает его вторым аргументом build(params, kit).
// Все примитивы используют общие единичные геометрии (коробка 1×1×1 и т. д.) и масштаб — поэтому
// одинаковые по материалу детали разных объектов движок склеивает в один вызов отрисовки.
//
//   build(p, kit) {
//     const g = kit.group();
//     g.add(kit.box([0.12, 5.2, 0.12], { at: [0, 0, 0], pivot: "bottom", color: "post" }));
//     g.add(kit.cylinder(0.2, 5, { at: [1, 0, 0], pivot: "bottom", color: "#a9aaa6" }));
//     const lines = kit.lines(); lines.add([0, 5, 0], [1, 5, 0], 0.03, "steel"); g.add(lines.build());
//     return g;
//   }
// @ts-check
import * as THREE from "three";
import * as geometry from "../render/geometry.js";
import { GlowBatch } from "../render/glows.js";
import { LineBatch } from "../render/lines.js";
import { rng } from "../core/data.js";

const DEG = Math.PI / 180;
const unit = {};
function unitGeometry(kind, segments = 0) {
  const key = `${kind}:${segments}`;
  if (unit[key]) return unit[key];
  let g;
  if (kind === "box") g = new THREE.BoxGeometry(1, 1, 1);
  else if (kind === "cylinder") g = geometry.flat(new THREE.CylinderGeometry(.5, .5, 1, segments || 12));
  else if (kind === "cone") g = geometry.flat(new THREE.ConeGeometry(.5, 1, segments || 12));
  else if (kind === "sphere") g = new THREE.IcosahedronGeometry(.5, segments || 2);
  else if (kind === "plane") { g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); }       // лежит, смотрит вверх
  else throw new Error(`Нет примитива «${kind}»: box, cylinder, cone, sphere, plane`);
  return (unit[key] = g);
}

/**
 * Набор для моделей конкретного движка.
 * @param {import("../core/engine.js").Engine} engine
 */
export function createKit(engine) {
  /**
   * Меш-примитив.
   * @param {"box"|"cylinder"|"cone"|"sphere"|"plane"} kind
   * @param {number[]} size  [ширина x, высота y, глубина z] (у plane — [x, z])
   * @param {object} [o]
   * @param {number[]} [o.at]          где центр (или низ при pivot "bottom")
   * @param {"center"|"bottom"} [o.pivot]
   * @param {number[]} [o.rotation]    градусы, YXZ
   * @param {string|number[]} [o.color]
   * @param {import("../render/materials.js").ToonOptions} [o.material]  параметры материала (кроме цвета)
   * @param {THREE.Material} [o.mat]   готовый материал
   * @param {number} [o.segments]
   * @param {string} [o.slot]          слот: приложение подставит сюда свою текстуру (табличка и т. п.)
   */
  function primitive(kind, size, o = {}) {
    const mat = o.mat || engine.materials.toon({ wet: true, snow: kind !== "sphere", ...(o.material || {}), color: o.color ?? o.material?.color ?? "#ffffff" });
    const m = new THREE.Mesh(unitGeometry(kind, o.segments), mat);
    const [sx, sy, sz] = kind === "plane" ? [size[0], 1, size[1]] : size;
    m.scale.set(sx, sy, sz);
    const at = o.at || [0, 0, 0];
    m.position.set(at[0], at[1] + (o.pivot === "bottom" && kind !== "plane" ? sy / 2 : 0), at[2]);
    if (o.rotation) m.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, (o.rotation[2] || 0) * DEG, "YXZ");
    if (o.slot) m.userData.slot = o.slot;
    return m;
  }
  return {
    THREE, engine, geometry, rng,
    /** Цвет из палитры этого движка → [r, g, b] (0…1). */
    rgb: (/** @type {string | number[]} */ c) => engine.palette.rgb(c),
    /** Склейка деталей с цветом у вершин (geometry.Batch) с палитрой этого движка. */
    batch: () => new geometry.Batch(engine.palette),
    /** Материал (cel) из кэша движка. */
    material: opts => engine.materials.toon(opts),
    group: (...children) => { const g = new THREE.Group(); if (children.length) g.add(...children); return g; },
    primitive,
    box: (size, o) => primitive("box", size, o),
    /** Коробка по границам: [x0, x1], [y0, y1], [z0, z1] */
    boxFrom: (x, y, z, o = {}) => primitive("box", [Math.abs(x[1] - x[0]), Math.abs(y[1] - y[0]), Math.abs(z[1] - z[0])],
      { ...o, at: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], pivot: "center" }),
    cylinder: (radius, height, o) => primitive("cylinder", [radius * 2, height, radius * 2], o),
    cone: (radius, height, o) => primitive("cone", [radius * 2, height, radius * 2], o),
    sphere: (radius, o) => primitive("sphere", [radius * 2, radius * 2, radius * 2], { material: { toon: true, snow: true }, ...o }),
    plane: (size, o = {}) => {
      if (!o.uvMeters) return primitive("plane", size, o);
      // плоскость с uv в метрах от центра (для узоров, привязанных к поверхности: шпалы)
      const g = new THREE.PlaneGeometry(size[0], size[1]);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
      const m = new THREE.Mesh(g, o.mat || engine.materials.toon({ wet: true, snow: true, ...(o.material || {}), color: o.color ?? "#ffffff" }));
      const at = o.at || [0, 0, 0];
      m.position.set(at[0], at[1], at[2]);
      return m;
    },
    /** Тонкие линии (провода): kit.lines().add(a, b, толщина, цвет) … .build() */
    lines: () => { const b = /** @type {LineBatch & {build: () => any}} */ (new LineBatch(engine.palette)); const build = b.build.bind(b); b.build = () => build(engine.materials); return b; },
    /** Ореолы огней: kit.glows().add(p, радиус, цвет, { night }) … .build() */
    glows: () => { const b = /** @type {GlowBatch & {build: () => any}} */ (new GlowBatch(engine.palette)); const build = b.build.bind(b); b.build = () => build(engine.materials); return b; },
    /** Меш из своей геометрии. */
    mesh: (geo, o = {}) => new THREE.Mesh(geo, o.mat || engine.materials.toon({ wet: true, ...(o.material || {}), color: o.color ?? "#ffffff" })),
  };
}
