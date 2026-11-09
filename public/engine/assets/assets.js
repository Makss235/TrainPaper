// Ресурсы: модели (JS и glTF), префабы. Движок не содержит ни одной модели — они лежат в папке
// проекта (по умолчанию assets/models/) и подключаются по имени.
//
// Модель по имени "lamp-post" ищется так:
//   1) зарегистрирована из кода: engine.assets.registerModel("lamp-post", definition);
//   2) в манифесте моделей (assets/models/index.jsonc): { "aliases": { "lamp-post": "examples/lamp.js" } };
//   3) по соглашению — файл assets/models/lamp-post.js.
// Имя с расширением .glb/.gltf — модель из Blender: "station/murmansk.glb".
//
// JS-модель — модуль, который экспортирует по умолчанию описание:
//   export default {
//     name: "Фонарь",
//     params: { height: { type: "number", default: 5.2, doc: "Высота столба, м" } },
//     meta: { … },                  // данные для логики (размеры, точки огней) — объект или (params) => объект
//     build(params, kit) { … return object3D; },   // kit — engine/assets/kit.js
//   };
// Модель строится один раз на набор параметров, экземпляры — копии с общими геометриями и материалами.
//
// Скрипты (пользовательские компоненты) ищутся так же: неизвестный type компонента "examples/blink" →
//   1) уже зарегистрирован (registerComponent);
//   2) замена из assets/scripts/index.jsonc: { "aliases": { "blink": "examples/blink.js" } };
//   3) файл assets/scripts/examples/blink.js — export default class extends Script { … }.
// @ts-check
import { componentTypes, getComponentClass, registerComponent } from "../core/component.js";
import { loadData } from "../core/data.js";
import { createKit } from "./kit.js";
import { withPalette } from "../render/palette.js";

const MODEL_EXT = /\.(glb|gltf)$/i;

export class AssetManager {
  /**
   * @param {import("../core/engine.js").Engine} engine
   * @param {{assets?: string, models?: string, prefabs?: string, scripts?: string, manifest?: string | null, scriptsManifest?: string | null}} paths
   */
  constructor(engine, paths = {}) {
    this.engine = engine;
    const base = new URL(document.baseURI);
    this.modelsBase = new URL(paths.models || "assets/models/", base).href;
    this.prefabsBase = new URL(paths.prefabs || "assets/prefabs/", base).href;
    this.scriptsBase = new URL(paths.scripts || "assets/scripts/", base).href;
    /** Корень содержимого: от него — пути картинок, расписаний, LUT в данных сцены (по умолчанию — над папкой моделей) */
    this.assetsBase = new URL(paths.assets || "../", paths.assets ? base : this.modelsBase).href;
    this.manifestUrl = paths.manifest === null ? null : new URL(paths.manifest || "index.jsonc", this.modelsBase).href;
    this.scriptsManifestUrl = paths.scriptsManifest === null ? null : new URL(paths.scriptsManifest || "index.jsonc", this.scriptsBase).href;
    /** @type {Promise<{aliases: Record<string, string>}> | null} */
    this.scriptsManifest = null;
    /** @type {Map<string, Promise<any>>} загрузка скриптов по имени типа */
    this.scripts = new Map();
    /** @type {Map<string, any>} описания моделей (уже загруженные) */
    this.definitions = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.loading = new Map();
    /** @type {Map<string, Promise<any>>} построенные модели (прототипы) */
    this.built = new Map();
    this.manifest = { aliases: {}, models: {} };
    this.manifestReady = null;
    this.kit = createKit(engine);
    this.gltfLoader = null;
    /** @type {Set<string>} о каких ресурсах уже сообщили */
    this.reported = new Set();
  }

  /** Манифест моделей (необязательный): палитра, замены, данные glTF. Нет файла — не страшно. */
  async #ensureManifest() {
    if (!this.manifestUrl) return;
    this.manifestReady ||= loadData(this.manifestUrl).then(m => {
      this.manifest = { aliases: {}, models: {}, ...m };
      if (m.palette) this.engine.palette.define(m.palette);
    }).catch(error => console.warn(`Манифест моделей не загружен (${this.manifestUrl}): ${error.message}`));
    await this.manifestReady;
  }

  /** Дождаться манифеста (сцена ждёт его перед созданием объектов: в нём палитра). */
  ready() {
    return this.#ensureManifest();
  }

  /** Зарегистрировать модель из кода. @param {string} id @param {any} definition */
  registerModel(id, definition) {
    this.definitions.set(id, definition);
    this.built.forEach((_, k) => { if (k.startsWith(`${id}|`)) this.built.delete(k); });
  }

  /** Адрес файла модели по имени. @param {string} id */
  resolveModel(id) {
    const alias = this.manifest.aliases?.[id] ?? this.manifest.models?.[id]?.src;
    const file = alias || (MODEL_EXT.test(id) || id.endsWith(".js") ? id : `${id}.js`);
    return new URL(file, this.modelsBase).href;
  }

  /** Описание модели (загружает файл при первом обращении). @param {string} id */
  async definition(id) {
    if (this.definitions.has(id)) return this.definitions.get(id);
    if (!this.loading.has(id)) {
      this.loading.set(id, (async () => {
        await this.#ensureManifest();
        const url = this.resolveModel(id);
        const extra = this.manifest.models?.[id] || {};
        let def;
        if (MODEL_EXT.test(url)) {
          def = { name: id, params: {}, meta: extra.meta || {}, gltf: url, scale: extra.scale ?? 1 };
        } else {
          const mod = await import(url);
          def = mod.default;
          if (!def?.build) throw new Error(`Модель «${id}» (${url}): нет export default { build(params, kit) }`);
          if (extra.meta) def = { ...def, meta: { ...(typeof def.meta === "function" ? {} : def.meta), ...extra.meta } };
        }
        this.definitions.set(id, def);
        return def;
      })().catch(error => {
        // ошибка запоминается: сотня объектов с этой моделью не будет загружать файл заново
        // (registerModel(id, …) по-прежнему подставит модель из кода)
        throw new Error(`Модель «${id}» не загрузилась: ${error.message}`);
      }));
    }
    return this.loading.get(id);
  }

  /** Описание, если уже загружено (без ожидания). @param {string} id */
  definitionSync(id) {
    return this.definitions.get(id) || null;
  }

  /** Параметры модели с значениями по умолчанию. */
  params(def, params = {}) {
    const out = {};
    for (const [k, spec] of Object.entries(def.params || {})) out[k] = params[k] ?? (typeof spec.default === "object" && spec.default !== null ? structuredClone(spec.default) : spec.default);
    for (const k of Object.keys(params)) if (!(k in out)) out[k] = params[k];
    return out;
  }

  /** Данные модели для логики (meta). */
  meta(def, params = {}) {
    const p = this.params(def, params);
    return typeof def.meta === "function" ? def.meta(p) : def.meta || {};
  }

  /**
   * Экземпляр модели: { object, meta, definition }. object — копия прототипа (общие геометрии и материалы).
   * @param {string} id
   * @param {Record<string, any>} [params]
   */
  async model(id, params = {}) {
    const def = await this.definition(id);
    const p = this.params(def, params);
    const key = `${id}|${JSON.stringify(p)}`;
    if (!this.built.has(key)) this.built.set(key, this.#build(def, p));
    const proto = await this.built.get(key);
    return { object: proto.clone(true), meta: this.meta(def, p), definition: def };
  }

  async #build(def, p) {
    if (def.gltf) {
      if (!this.gltfLoader) this.gltfLoader = import("three/addons/loaders/GLTFLoader.js").then(m => new m.GLTFLoader());
      const gltf = await (await this.gltfLoader).loadAsync(def.gltf);
      const root = this.engine.materials.stylize(gltf.scene, {});
      if (def.scale !== 1) root.scale.setScalar(def.scale);
      return root;
    }
    return withPalette(this.engine.palette, () => def.build(p, this.kit));
  }

  /**
   * Сообщить об ошибке ресурса один раз (а не для каждого из сотни объектов с этой моделью).
   * @param {string} key  имя модели или префаба
   * @param {string} message
   */
  report(key, message) {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    console.error(message);
  }

  // ---------- скрипты ----------

  /** Манифест скриптов (необязательный): замены имён. */
  #scriptManifest() {
    if (!this.scriptsManifestUrl) return Promise.resolve({ aliases: {} });
    return (this.scriptsManifest ||= loadData(this.scriptsManifestUrl).then(m => ({ aliases: {}, ...m })).catch(() => ({ aliases: {} })));
  }

  /** Адрес файла скрипта по имени типа. @param {string} type @param {Record<string, string>} aliases */
  resolveScript(type, aliases = {}) {
    const file = aliases[type] || (type.endsWith(".js") ? type : `${type}.js`);
    return new URL(file, this.scriptsBase).href;
  }

  /**
   * Класс компонента по имени типа: встроенный, зарегистрированный или скрипт из файла (загружается один раз).
   * Ошибка загрузки — сообщение со списком похожих имён.
   * @param {string} type
   * @returns {Promise<typeof import("../core/component.js").Component>}
   */
  script(type) {
    const known = getComponentClass(type);
    if (known) return Promise.resolve(known);
    if (!this.scripts.has(type)) {
      this.scripts.set(type, (async () => {
        const { aliases } = await this.#scriptManifest();
        const url = this.resolveScript(type, aliases);
        let mod;
        try {
          mod = await import(url);
        } catch (error) {
          throw new Error(`Нет компонента «${type}»: ни встроенного, ни скрипта ${url} (${error.message}).${this.#similar(type, aliases)}`);
        }
        const C = mod.default;
        if (typeof C !== "function" || typeof C.prototype?.awake !== "function") {
          throw new Error(`Скрипт «${type}» (${url}): нужен export default class extends Script { … }`);
        }
        C.source = url;
        return registerComponent(C, type);
      })());
    }
    return /** @type {Promise<any>} */ (this.scripts.get(type));
  }

  /** «Может быть, …» — похожие имена компонентов. @param {string} type @param {Record<string, string>} aliases */
  #similar(type, aliases) {
    const names = [...new Set([...componentTypes(), ...Object.keys(aliases)])];
    const near = names.map(n => ({ n, d: distance(type.toLowerCase(), n.toLowerCase()) }))
      .filter(x => x.d <= Math.max(2, Math.floor(type.length / 3))).sort((a, b) => a.d - b.d).slice(0, 4).map(x => x.n);
    return near.length ? ` Может быть: ${near.join(", ")}?` : ` Есть: ${names.join(", ")}`;
  }

  /**
   * Загрузить скрипты для всех неизвестных типов в данных объектов (до создания объектов — instantiate синхронный).
   * Ошибка — одно сообщение на тип; объекты создаются без этого компонента.
   * @param {Record<string, any>[]} objects
   */
  async preloadScripts(objects) {
    /** @type {Set<string>} */
    const types = new Set();
    const walk = (/** @type {Record<string, any>} */ od) => {
      for (const cd of od.components || []) if (cd?.type && !cd.remove && !getComponentClass(cd.type)) types.add(cd.type);
      for (const ch of od.children || []) walk(ch);
    };
    objects.forEach(walk);
    await Promise.all([...types].map(t => this.script(t).catch(error => this.report(`component:${t}`, error.message))));
  }

  /** Адрес файла по пути от корня содержимого (assets/): "img/lut/cold.png". @param {string} path */
  url(path) {
    return new URL(path, this.assetsBase).href;
  }

  /** Данные префаба assets/prefabs/<name>.jsonc. @param {string} name */
  prefab(name) {
    const url = new URL(/\.jsonc?$/.test(name) ? name : `${name}.jsonc`, this.prefabsBase).href;
    return loadData(url).catch(error => { throw new Error(`Префаб «${name}»: ${error.message}`); });
  }
}

/** Расстояние Левенштейна (для подсказок при опечатке в имени). @param {string} a @param {string} b */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}
