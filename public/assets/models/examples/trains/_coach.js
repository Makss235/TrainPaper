// Пример детальной модели (examples): общий строитель пассажирского вагона по спецификации.
// Общий строитель пассажирского вагона: кузов по поперечному профилю, борта с настоящими
// оконными проёмами (стекло утоплено, у проёма есть откосы), ливрея текстурой, табличка в окне,
// торцы, низ с ящиками оборудования, тележки.
//
// Вагон описывается спецификацией (см. cars/fpk.js — пример):
//   length      длина кузова, м
//   half        полуширина кузова, м
//   bottom      низ кузова над головкой рельса, м
//   wallTop     верх вертикальной стенки борта, м
//   shoulder    профиль верха от края стенки к оси: [[внутрь, вверх], ...] (м от верха стенки)
//   liveryBands сколько первых отрезков плеча покрыты ливреей (дальше — крыша)
//   livery      { canvas, vBase, vScale } — холст ливреи: v = (y − vBase) / vScale, u = z / length
//               canvasRight — свой холст для борта +x (если кузов несимметричен: нос, кабина); тогда окна
//               второго борта не зеркалятся, а рисунок на нём нарисован уже «с той стороны»
//   windows     [{ z0, z1, y0, y1, r, transom }] — проёмы на борту (для стороны −x, z от торца z = 0)
//   plateWindow индекс окна с маршрутной табличкой (или null)
//   bogies      [z центров тележек]
//   boxes       [[z0, z1], ...] ящики оборудования под кузовом
//   steps       [[z0, z1], ...] подножки под дверями
//   roofBoxes   [[z0, z1], ...] короба на крыше
//   colors      { roof, end, under, frame }
//   bodyEnd     где кончается кузов постоянного сечения (если дальше нос), по умолчанию = length
//   nose        ({ parts, glass, spec }) => void — достроить носовую часть (электропоезд)
//   glassBands  [{ z0, z1, y0, y1 }] — сплошные стеклянные ленты поверх борта (окна электропоезда)
// Геометрия строится один раз на спецификацию и общая у всех вагонов этого типа.
import * as THREE from "three";
import { clipAxis } from "../../../js/lib/shadow.js";
import { roundRect } from "../../../js/lib/geom.js";
import { geometry } from "../../../../engine/index.js";

const { Batch, cap, extrude, flat, merge, reveal, wall } = geometry;
import { liveryTexture } from "./_livery.js";


/** Контур окна (скруглённый прямоугольник) в координатах борта [z, y]. */
const windowOutline = w => roundRect(w.z0, w.y0, w.z1, w.y1, w.r ?? .1, 5);

/** Окна для стороны side: у стороны +x вагон виден «с другого бока» — окна зеркально по длине. */
function sideWindows(spec, side) {
  if (side < 0 || spec.livery.canvasRight) return spec.windows;
  return spec.windows.map(w => ({ ...w, z0: spec.length - w.z1, z1: spec.length - w.z0 }));
}

/** Плоский профиль половины верха: от края стенки к оси, x — от оси вагона. */
function upperProfile(spec, side) {
  return spec.shoulder.map(([dx, dy]) => [side * (spec.half - dx), spec.wallTop + dy]);
}

function buildShared(spec, kit) {
  const toonCached = opts => kit.material(opts);
  const L = spec.length, H = spec.half, E = spec.bodyEnd ?? spec.length;
  const texture = liveryTexture(spec.livery.canvas);
  spec.texture = texture;                          // чтобы перерисовать ливрею после загрузки шрифта
  const liveryMat = toonCached({ map: texture, wet: true, snow: false });
  const textureR = spec.livery.canvasRight ? liveryTexture(spec.livery.canvasRight) : null;
  spec.textureRight = textureR;
  const liveryMatR = textureR ? toonCached({ map: textureR, wet: true, snow: false }) : liveryMat;
  const sidesR = [];
  const parts = new Batch();                       // всё одноцветное — одним мешем с цветом у вершин
  const sides = [], glass = [], plates = [];
  const uvOf = side => (z, y) => [side < 0 ? z / L : 1 - z / L, (y - spec.livery.vBase) / spec.livery.vScale];

  for (const side of [-1, 1]) {
    const x = side * H;
    const wins = sideWindows(spec, side);
    const outline = [[0, spec.bottom], [E, spec.bottom], [E, spec.wallTop], [0, spec.wallTop]];
    const holes = wins.map(windowOutline);
    // борт: плоская стенка с проёмами
    const target = side > 0 && textureR ? sidesR : sides;
    target.push(wall(outline, holes, (z, y) => [x, y, z], [side, 0, 0], uvOf(side)));
    // плечо с ливреей и крыша
    const prof = upperProfile(spec, side);
    const bands = spec.liveryBands ?? 3;
    target.push(extrude(prof.slice(0, bands + 1), 0, E, { vBase: spec.livery.vBase, vScale: spec.livery.vScale, uFlip: side > 0, center: [0, spec.bottom + 1], uLength: L }));
    parts.add(extrude(prof.slice(bands), 0, E, { center: [0, spec.bottom + 1] }), spec.colors?.roof ?? "roof");
    // сплошные стеклянные ленты (у электропоезда окна идут одной тёмной полосой)
    for (const b of spec.glassBands ?? []) {
      const [z0, z1] = side < 0 || textureR ? [b.z0, b.z1] : [L - b.z1, L - b.z0];
      const w = { z0, z1, y0: b.y0, y1: b.y1 };
      glass.push(glassPanel([[z0, b.y0], [z1, b.y0], [z1, b.y1], [z0, b.y1]], w, x + side * .008, side, b.shade ?? .45));
    }
    // проёмы: откосы, стекло (низ — прозрачная часть, верх — тёмная «шторка»), табличка
    const inset = .035;
    wins.forEach((w, i) => {
      const ol = windowOutline(w);
      parts.add(reveal(ol, (z, y, d) => [x - side * d, y, z], inset), spec.colors?.frame ?? "frame");
      const transom = w.transom ?? w.y1;
      for (const [lo, hi, shade] of [[w.y0, transom, 0], [transom, w.y1, 1]]) {
        if (hi - lo < .01) continue;
        const piece = clipAxis(ol, 1, lo, hi);
        if (piece.length < 3) continue;
        glass.push(glassPanel(piece, w, x - side * inset, side, shade));
      }
      // окна стороны +x зеркальны, но порядок тот же — табличка в том же по счёту окне
      if (spec.plateWindow != null && i === spec.plateWindow) plates.push(platePanel(w, x - side * (inset - .012), side));
    });
  }
  // торцы
  const full = [[-H, spec.bottom], ...upperProfile(spec, -1), ...upperProfile(spec, 1).reverse(), [H, spec.bottom]];
  const dedup = full.filter((p, i) => i === 0 || Math.hypot(p[0] - full[i - 1][0], p[1] - full[i - 1][1]) > 1e-4);
  for (const [z, dir] of spec.nose ? [[0, -1]] : [[0, -1], [L, 1]]) {
    parts.add(cap(dedup, z, dir), spec.colors?.end ?? "darkend");
    parts.box([-.45, .45], [spec.bottom + .1, spec.bottom + 2.55], dir < 0 ? [z - .02, z] : [z, z + .02], "darkdoor");
    parts.box([-.52, .52], [spec.bottom + 2.55, spec.bottom + 2.67], dir < 0 ? [z - .03, z] : [z, z + .03], "frame");
  }
  // низ: рама, ящики, подножки, короба на крыше
  const under = spec.colors?.under ?? "under";
  parts.box([-H + .2, H - .2], [spec.bottom - .55, spec.bottom], [.4, L - .4], under);
  for (const [z0, z1] of spec.boxes ?? []) parts.box([-H + .12, H - .12], [spec.bottom - .5, spec.bottom - .05], [z0, z1], "box");
  for (const [z0, z1] of spec.steps ?? []) for (const s of [-1, 1]) parts.box(s < 0 ? [-H - .05, -H + .25] : [H - .25, H + .05], [spec.bottom - .5, spec.bottom], [z0, z1], "step");
  const roofTop = spec.wallTop + spec.shoulder.at(-1)[1];
  for (const [z0, z1] of spec.roofBoxes ?? []) parts.box([-.85, .85], [roofTop - .1, roofTop + .16], [z0, z1], "roofbox");
  for (const zc of spec.bogies ?? []) addBogie(parts, zc, spec.bottom);
  spec.nose?.({ parts, glass, spec, profile: dedup });

  return {
    sides: { geometry: merge(sides), material: liveryMat },
    sidesRight: sidesR.length ? { geometry: merge(sidesR), material: liveryMatR } : null,
    parts: { geometry: parts.geometry(), material: toonCached({ vertexColors: true, wet: true, snow: true }) },
    glass: glass.length ? { geometry: merge(glass), material: toonCached({ glass: true, vertexColors: true, offset: 1 }) } : null,
    plates: plates.length ? merge(plates) : null,
    texture,
  };
}

/** Стекло окна: uv — координаты внутри всего окна (для отражения и блика), цвет.r — «шторка». */
export function glassPanel(piece, w, x, side, shade) {
  const shape = new THREE.Shape(piece.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ShapeGeometry(shape).toNonIndexed();
  const p = g.attributes.position, uv = [], col = [];
  for (let i = 0; i < p.count; i++) {
    const z = p.getX(i), y = p.getY(i);
    p.setXYZ(i, x, y, z);
    const u = (z - w.z0) / (w.z1 - w.z0);
    uv.push(side < 0 ? u : 1 - u, (y - w.y0) / (w.y1 - w.y0));
    col.push(shade, 0, 0);
  }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return orientX(g, side);
}

/** Табличка в окне: как в 2D-виде — с полями 7 % ширины, внизу проёма. */
function platePanel(w, x, side) {
  const mz = (w.z1 - w.z0) * .07;
  const z0 = w.z0 + mz, z1 = w.z1 - mz;
  const ph = (z1 - z0) * 400 / 1000;
  const y0 = w.y0 + (w.y1 - w.y0) * .1, y1 = Math.min(y0 + ph, w.y0 + (w.y1 - w.y0) * .72);
  const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0).toNonIndexed();
  g.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2);
  g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function orientX(g, side) {
  const n = g.attributes.normal;
  if (n.getX(0) * side < 0) {
    const idx = g.attributes.position;
    for (let i = 0; i < idx.count; i += 3) {
      for (const name of ["position", "uv", "color"]) {
        const a = g.attributes[name], s = a.itemSize;
        for (let k = 0; k < s; k++) {
          const t = a.array[(i + 1) * s + k];
          a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
          a.array[(i + 2) * s + k] = t;
        }
      }
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Двухосная тележка: рама и колёсные пары. */
export function addBogie(batch, zc, bottom, { wheelbase = 2.4, color = "under" } = {}) {
  batch.box([-1.15, 1.15], [.42, Math.min(.8, bottom - .05)], [zc - 1.5, zc + 1.5], color);
  const wheel = flat(new THREE.CylinderGeometry(.47, .47, .13, 12));
  wheel.rotateZ(Math.PI / 2);
  for (const dz of [-wheelbase / 2, wheelbase / 2]) {
    for (const x of [-.8, .8]) {
      const g = wheel.clone();
      g.translate(x, .47, zc + dz);
      batch.add(g, "frame");
    }
  }
}

/**
 * Вагон по спецификации → THREE.Group. Маршрутная табличка — меши-слоты "plate" (текстуру подставит приложение).
 * @param {object} spec
 * @param {object} kit  набор моделей движка (engine/assets/kit.js)
 */
export function buildCoach(spec, kit) {
  const S = buildShared(spec, kit);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(S.sides.geometry, S.sides.material), new THREE.Mesh(S.parts.geometry, S.parts.material));
  if (S.sidesRight) group.add(new THREE.Mesh(S.sidesRight.geometry, S.sidesRight.material));
  if (S.glass) group.add(new THREE.Mesh(S.glass.geometry, S.glass.material));
  if (S.plates) {
    const plate = new THREE.Mesh(S.plates, kit.material({ color: "#c8141c", receive: false }));
    plate.userData.slot = "plate";
    plate.userData.noBatch = true;
    group.add(plate);
  }
  return group;
}
