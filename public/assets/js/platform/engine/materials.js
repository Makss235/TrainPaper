// Материалы сцены. Почти всё в сцене — один cel-материал toon() с разными параметрами:
// плоские грани в свой тон, тени от солнца, дымка, ночные фонари. Шейдер — engine/shaders.js.
//
//   toon({ color: "platform" })                    — ровный цвет (имя из colors.js или "#rrggbb")
//   toon({ vertexColors: true })                   — цвет у каждой вершины (склеенные детали)
//   toon({ map: texture })                         — текстура (ливрея вагона)
//   toon({ color: "tree1", toon: true })           — гладкое тело в два тона (кроны деревьев)
//   toon({ glass: true })                          — стекло окна
//   toon({ pattern: { type: "tiles", ... } })      — узор без текстуры и без ряби (см. ниже)
//
// Все материалы принимают тени (receive), кроме случаев, когда это выключено: receive: false.
import * as THREE from "three";
import { rgb } from "../colors.js";
import { LIGHT } from "./light.js";
import { TOON_FRAGMENT, TOON_VERTEX } from "./shaders.js";

const v3 = c => new THREE.Vector3(...rgb(c));

/**
 * Cel-материал.
 * opts: color, vertexColors, map, opacity, transparent, side, toon, glass, haze (множитель дымки),
 *   extra (добавка к освещённости), emissive (свечение всегда), emissiveNight (свечение ночью),
 *   litNight (подсветка изнутри ночью — умножается на цвет/текстуру, надписи остаются читаемыми),
 *   receive (тени от солнца, по умолчанию да), patternShadows (тени ограды), wet, snow,
 *   pattern: { type: "tiles", step: [0.6, 0.6], width: 0.02, fade: 70, color }
 *          | { type: "sleepers", x, half: 1.35, step: 0.55, width: 0.26, color }
 *          | { type: "stripes", step, width, strength, color }            — полосы вдоль z
 *          | { type: "bars", step: 0.14, width: 0.02, color }              — прутья (прозрачность)
 */
export function toon(opts = {}) {
  const defines = {};
  const uniforms = {
    ...LIGHT,
    uColor: { value: v3(opts.color ?? [1, 1, 1]) },
    uOpacity: { value: opts.opacity ?? 1 },
    uExtra: { value: opts.extra ?? 0 },
    uHaze: { value: opts.haze ?? 1 },
    uEmissive: { value: v3(opts.emissive ?? [0, 0, 0]) },
    uEmissiveNight: { value: v3(opts.emissiveNight ?? [0, 0, 0]) },
    uLitNight: { value: v3(opts.litNight ?? [0, 0, 0]) },
  };
  if (opts.map) { defines.USE_MAP = ""; uniforms.uMap = { value: opts.map }; }
  if (opts.toon) defines.TOON = "";
  if (opts.glass) defines.GLASS = "";
  if (opts.receive !== false && !opts.glass) defines.RECEIVE = "";
  if (opts.patternShadows) defines.PATTERN_SHADOWS = "";
  if (opts.wet) defines.WET = "";
  if (opts.snow) defines.SNOW = "";
  let transparent = !!opts.transparent || (opts.opacity ?? 1) < 1;
  const p = opts.pattern;
  if (p) {
    uniforms.uPatColor = { value: v3(p.color ?? "#000000") };
    if (p.type === "tiles") {
      defines.PAT_TILES = "";
      uniforms.uPat = { value: new THREE.Vector4(p.step?.[0] ?? .6, p.step?.[1] ?? .6, p.width ?? .02, p.fade ?? 70) };
    } else if (p.type === "sleepers") {
      defines.PAT_SLEEPERS = "";
      uniforms.uPat = { value: new THREE.Vector4(p.x ?? 0, p.half ?? 1.35, p.step ?? .55, p.width ?? .26) };
    } else if (p.type === "stripes") {
      defines.PAT_STRIPES = "";
      uniforms.uPat = { value: new THREE.Vector4(p.step ?? .3, p.width ?? .05, p.strength ?? .5, 0) };
    } else if (p.type === "bars") {
      defines.ALPHA_STRIPES = "";
      uniforms.uPat = { value: new THREE.Vector4(p.step ?? .14, p.width ?? .02, 0, 0) };
      transparent = true;
    }
  }
  const material = new THREE.ShaderMaterial({
    uniforms, defines,
    vertexShader: TOON_VERTEX,
    fragmentShader: TOON_FRAGMENT,
    vertexColors: !!opts.vertexColors,
    side: opts.side ?? THREE.FrontSide,
    transparent,
    depthWrite: opts.depthWrite ?? !transparent,
    premultipliedAlpha: true,                  // шейдер отдаёт цвет, уже умноженный на прозрачность
    polygonOffset: !!opts.offset,
    polygonOffsetFactor: opts.offset ? -1 : 0,
    polygonOffsetUnits: opts.offset ? -opts.offset : 0,
  });
  material.userData.toon = opts;
  return material;
}

/** Кэш одинаковых материалов: toonCached({color: "post"}) вернёт тот же объект при тех же параметрах. */
const cache = new Map();
export function toonCached(opts) {
  // текстуры — по uuid: JSON.stringify сам вызвал бы у них toJSON() и закодировал бы картинку целиком
  const key = JSON.stringify(Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, v instanceof THREE.Texture ? `tex:${v.uuid}` : v])));
  if (!cache.has(key)) cache.set(key, toon(opts));
  return cache.get(key);
}

/**
 * Перевод материалов загруженной модели (glTF из Blender и т. п.) в стиль сцены:
 * берём базовый цвет и текстуру, остальное (PBR, металличность, шероховатость) отбрасываем.
 * Цвета glTF линейные, а сцена считает в sRGB — переводим. Свечение (emissive) сохраняется.
 */
export function stylizeModel(root, { receive = true, snow = false } = {}) {
  const toSrgb = c => (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
  const converted = new Map();
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const out = list.map(m => {
      if (!m || converted.has(m)) return converted.get(m);
      const color = m.color ? [m.color.r, m.color.g, m.color.b].map(toSrgb) : [1, 1, 1];
      let map = m.map || null;
      if (map) {
        map.colorSpace = THREE.NoColorSpace;    // читать текстуру как есть (sRGB) — как и всю сцену
        map.needsUpdate = true;
      }
      const emissive = m.emissive && m.emissiveIntensity ? [m.emissive.r, m.emissive.g, m.emissive.b].map(c => toSrgb(c) * m.emissiveIntensity) : null;
      const t = toon({
        color, map, vertexColors: !!obj.geometry.attributes.color, receive, snow,
        transparent: m.transparent, opacity: m.opacity, side: m.side,
        // имя материала «…night…» в Blender — светится только ночью (окна, вывески)
        ...(emissive ? (/night|ноч/i.test(m.name) ? { emissiveNight: emissive } : { emissive }) : {}),
        glass: /glass|стекл/i.test(m.name),
      });
      converted.set(m, t);
      return t;
    });
    obj.material = Array.isArray(obj.material) ? out : out[0];
    // плоские грани: если у модели сглаженные нормали, cel-стиль всё равно выглядит лучше гранями
    if (obj.geometry.index && obj.userData.flat !== false && !/smooth/i.test(obj.name)) {
      obj.geometry = obj.geometry.toNonIndexed();
      obj.geometry.computeVertexNormals();
    }
  });
  return root;
}
