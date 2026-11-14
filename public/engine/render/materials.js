// Материалы движка. Почти всё в сцене — один cel-материал toon() с разными параметрами:
// плоские грани своим тоном, тени от солнца, дымка, ночные огни. Шейдер — render/shaders.js.
// У каждого движка свои материалы (они ссылаются на его uniforms освещения): engine.materials.toon({...}).
//
//   toon({ color: "floor" })                     — ровный цвет (имя палитры или "#rrggbb")
//   toon({ vertexColors: true })                 — цвет у вершин (склеенные детали)
//   toon({ map: texture })                       — текстура
//   toon({ color: "#4f7a4a", toon: true })       — гладкое тело в два тона (кроны)
//   toon({ glass: true })                        — стекло окна (днём отражает небо, ночью светится)
//   toon({ pattern: { type: "tiles", ... } })    — узор без текстуры и без ряби
// @ts-check
import * as THREE from "three";
import { GLOW_FRAGMENT, GLOW_VERTEX } from "./glows.js";
import { LINE_FRAGMENT, LINE_VERTEX } from "./lines.js";
import { TOON_FRAGMENT, TOON_VERTEX } from "./shaders.js";

/**
 * @typedef {object} ToonOptions
 * @property {string|number[]} [color]   цвет (по умолчанию белый)
 * @property {boolean} [vertexColors]    цвет из атрибута вершин
 * @property {THREE.Texture} [map]       текстура
 * @property {number} [opacity]
 * @property {boolean} [transparent]
 * @property {THREE.Side} [side]
 * @property {boolean} [toon]            гладкое тело в две полосы тона
 * @property {boolean} [glass]           стекло
 * @property {number} [glassShade]       стекло: затемнение 0…1 (тонировка, шторка)
 * @property {number} [haze]             множитель дымки (меньше — объект виднее вдали)
 * @property {number} [extra]            добавка к освещённости
 * @property {string|number[]} [emissive]       свечение всегда
 * @property {string|number[]} [emissiveNight]  свечение ночью
 * @property {string|number[]} [litNight]       подсветка изнутри ночью (умножается на цвет — надписи читаются)
 * @property {boolean} [receive]         принимает тени (по умолчанию да)
 * @property {boolean} [cardLight]       плоская картинка: солнце освещает её с обеих сторон (спрайты 2D-сцен)
 * @property {boolean} [nightOnly]       слой виден только ночью — проявляется вместе с фонарями (свет в окнах)
 * @property {boolean} [patternShadows]  принимает тени-узоры решёток (StripeShadow)
 * @property {boolean} [wet]             мокнет в дождь
 * @property {boolean} [snow]            покрывается снегом сверху
 * @property {number} [offset]           сдвиг глубины (для наклеек и стёкол)
 * @property {boolean} [depthWrite]
 * @property {{type: "tiles"|"slats"|"stripes"|"bars", [k: string]: any}} [pattern]
 *   tiles: { step: [0.6, 0.6], width: 0.02, fade: 70, color } — швы плитки по мировым x и z;
 *   slats: { half: 1.35, step: 0.55, width: 0.26, color } — поперечные планки на полосе (настил, ступени); координаты — uv поверхности
 *     в метрах (u — поперёк полосы от её оси, v — вдоль): kit.plane(size, { uvMeters: true });
 *   stripes: { step, width, strength, color } — полосы по координате u поверхности (в её единицах:
 *     у коробки kit.box u идёт 0…1 по грани) — рифление, рёбра; едут вместе с объектом;
 *   bars: { step: 0.14, width: 0.02, color } — прутья: прозрачность по узору вдоль z.
 */

export class Materials {
  /**
   * @param {import("./lighting.js").LightUniforms} light  uniforms освещения движка
   * @param {{uRes: {value: THREE.Vector2}, uMinPx: {value: number}}} screen  размер буфера сцены
   * @param {import("./palette.js").Palette} palette  палитра движка (имена цветов)
   * @param {{maxLights?: number}} [o]  maxLights — сколько источников света читает шейдер
   */
  constructor(light, screen, palette, { maxLights = 32 } = {}) {
    this.light = light;
    this.palette = palette;
    this.maxLights = maxLights;
    this.screen = screen;
    /** @type {Map<string, THREE.ShaderMaterial>} */
    this.cache = new Map();
    /** @type {THREE.ShaderMaterial | null} */
    this.lineMaterial = null;
    /** @type {THREE.ShaderMaterial | null} */
    this.glowMaterial = null;
  }

  /** Новый cel-материал. @param {ToonOptions} [opts] */
  create(opts = {}) {
    const v3 = (/** @type {any} */ c) => new THREE.Vector3(...this.palette.rgb(c));
    /** @type {Record<string, string>} */
    const defines = { MAX_LIGHTS: String(this.maxLights) };
    /** @type {Record<string, {value: any}>} */
    const uniforms = {
      ...this.light,
      uColor: { value: v3(opts.color ?? [1, 1, 1]) },
      uOpacity: { value: opts.opacity ?? 1 },
      uExtra: { value: opts.extra ?? 0 },
      uHaze: { value: opts.haze ?? 1 },
      uEmissive: { value: v3(opts.emissive ?? [0, 0, 0]) },
      uEmissiveNight: { value: v3(opts.emissiveNight ?? [0, 0, 0]) },
      uLitNight: { value: v3(opts.litNight ?? [0, 0, 0]) },
      uGlassShade: { value: opts.glassShade ?? 0 },
    };
    if (opts.map) { defines.USE_MAP = ""; uniforms.uMap = { value: opts.map }; }
    if (opts.toon) defines.TOON = "";
    if (opts.glass) defines.GLASS = "";
    if (opts.receive !== false && !opts.glass) defines.RECEIVE = "";
    if (opts.patternShadows) defines.PATTERN_SHADOWS = "";
    if (opts.cardLight) defines.CARD_LIGHT = "";
    if (opts.nightOnly) defines.NIGHT_ONLY = "";
    if (opts.wet) defines.WET = "";
    if (opts.snow) defines.SNOW = "";
    let transparent = !!opts.transparent || (opts.opacity ?? 1) < 1;
    const p = opts.pattern;
    if (p) {
      uniforms.uPatColor = { value: v3(p.color ?? "#000000") };
      if (p.type === "tiles") {
        defines.PAT_TILES = "";
        uniforms.uPat = { value: new THREE.Vector4(p.step?.[0] ?? .6, p.step?.[1] ?? .6, p.width ?? .02, p.fade ?? 70) };
      } else if (p.type === "slats") {
        defines.PAT_SLATS = "";
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
      premultipliedAlpha: true,
      polygonOffset: !!opts.offset,
      polygonOffsetFactor: opts.offset ? -1 : 0,
      polygonOffsetUnits: opts.offset ? -opts.offset : 0,
    });
    material.userData.toon = opts;
    return material;
  }

  /** Cel-материал из кэша: при одинаковых параметрах — тот же объект (одинаковые меши склеиваются). @param {ToonOptions} [opts] */
  toon(opts = {}) {
    // текстуры — по uuid: JSON.stringify сам вызвал бы у них toJSON() и закодировал картинку целиком
    const key = JSON.stringify(Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, v instanceof THREE.Texture ? `tex:${v.uuid}` : v])));
    let m = this.cache.get(key);
    if (!m) { m = this.create(opts); this.cache.set(key, m); }
    return m;
  }

  /** Освободить все материалы (движок удаляется). */
  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.lineMaterial?.dispose();
    this.glowMaterial?.dispose();
    this.lineMaterial = this.glowMaterial = null;
  }

  /** Материал тонких линий (render/lines.js). */
  line() {
    return this.lineMaterial ||= new THREE.ShaderMaterial({
      uniforms: { ...this.light, uRes: this.screen.uRes, uMinPx: this.screen.uMinPx, uOpacity: { value: 1 } },
      vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT,
      transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
    });
  }

  /** Материал ореолов (render/glows.js): свет складывается со сценой, прозрачность слоя не трогается. */
  glow() {
    return this.glowMaterial ||= new THREE.ShaderMaterial({
      uniforms: { uRes: this.screen.uRes, uLamps: this.light.uLamps, uFog: this.light.uFog },
      vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
  }

  /**
   * Перевод материалов загруженной модели (glTF из Blender) в стиль сцены: берутся базовый цвет
   * и текстура; PBR отбрасывается. Цвета glTF линейные — переводятся в sRGB.
   * Имя материала: «glass» — стекло, «night» + Emission — светится ночью, «slot:имя» — слот,
   * в который приложение подставит свою текстуру (например, маршрутную табличку).
   * @param {THREE.Object3D} root
   * @param {{receive?: boolean, snow?: boolean, flat?: boolean}} [opts]
   */
  stylize(root, { receive = true, snow = false, flat = true } = {}) {
    const toSrgb = (/** @type {number} */ c) => (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
    const converted = new Map();
    root.traverse(obj => {
      const mesh = /** @type {THREE.Mesh} */ (obj);
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = list.map(src => {
        if (converted.has(src)) return converted.get(src);
        const m = /** @type {THREE.MeshStandardMaterial} */ (src);
        const color = m.color ? [m.color.r, m.color.g, m.color.b].map(toSrgb) : [1, 1, 1];
        const map = m.map || undefined;
        if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
        const emissive = m.emissive && m.emissiveIntensity && (m.emissive.r + m.emissive.g + m.emissive.b) > 0
          ? [m.emissive.r, m.emissive.g, m.emissive.b].map(c => toSrgb(c) * m.emissiveIntensity) : null;
        const t = this.toon({
          color, map, vertexColors: !!mesh.geometry.attributes.color, receive, snow,
          transparent: m.transparent, opacity: m.opacity, side: m.side,
          ...(emissive ? (/night|ноч/i.test(m.name) ? { emissiveNight: emissive } : { emissive }) : {}),
          glass: /glass|стекл/i.test(m.name),
        });
        const slot = /slot:([\w-]+)/i.exec(m.name)?.[1];
        if (slot) mesh.userData.slot = slot;
        converted.set(src, t);
        return t;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
      // плоские грани: cel-стиль лучше смотрится гранями; «smooth» в имени объекта — оставить гладким
      if (flat && mesh.geometry.index && !/smooth/i.test(mesh.name)) {
        mesh.geometry = mesh.geometry.toNonIndexed();
        mesh.geometry.computeVertexNormals();
      }
    });
    return root;
  }
}
