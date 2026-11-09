// Компоненты внешнего вида: как объект выглядит. Меши кладутся внутрь object3D объекта,
// поэтому двигаются вместе с ним.
//
//   Primitive — коробка, цилиндр, конус, сфера, плоскость (заготовки, блокаут)
//   Model     — модель из папки моделей: JS-модель или glTF из Blender
//   Sprite    — картинка, повёрнутая к камере
//   Line      — тонкие линии без мерцания (провода с провисом, перила)
//   Glow      — ореол огня (фонарь, фара)
// @ts-check
import * as THREE from "three";
import { Component } from "../core/component.js";
import { SURFACE_LAYER } from "../environment/precipitation.js";
import { GlowBatch } from "../render/glows.js";
import { LineBatch } from "../render/lines.js";
import { SHADOW_LAYER } from "../render/shadows.js";

const DEG = Math.PI / 180;

/** Слои меша: отбрасывает тень, на него падают осадки. */
export function applyVisualFlags(object, { castShadow = true, surface = true } = {}) {
  object.traverse(o => {
    if (!o.isMesh) return;
    const opaque = !o.material?.transparent && !o.userData.lines;
    if (castShadow && opaque && !o.userData.noShadow) o.layers.enable(SHADOW_LAYER); else o.layers.disable(SHADOW_LAYER);
    if (surface && opaque) o.layers.enable(SURFACE_LAYER); else o.layers.disable(SURFACE_LAYER);
  });
  return object;
}

/** Общая часть: смещение, поворот и масштаб содержимого внутри объекта. */
function placeHolder(holder, p) {
  holder.position.set(...(p.offset || [0, 0, 0]));
  const r = p.rotation || [0, 0, 0];
  holder.rotation.set(r[0] * DEG, r[1] * DEG, (r[2] || 0) * DEG, "YXZ");
  const s = p.scale ?? 1;
  if (typeof s === "number") holder.scale.setScalar(s); else holder.scale.set(...s);
}

class VisualComponent extends Component {
  awake() {
    this.holder = new THREE.Group();
    this.holder.name = this.type;
    this.object3D.add(this.holder);
    this.rebuild();
  }
  /** Построить содержимое заново (переопределяется). */
  rebuild() {}
  clear() {
    this.holder?.clear();
  }
  onChange() {
    this.clear();
    this.rebuild();
    this.engine.scene.markDirty(this.gameObject);
    this.engine.precipitation.markDirty();
  }
  onEnable() { if (this.holder) this.holder.visible = true; this.engine.scene.markDirty(this.gameObject); }
  onDisable() { if (this.holder) this.holder.visible = false; this.engine.scene.markDirty(this.gameObject); }
  onDestroy() { this.holder?.removeFromParent(); this.engine?.scene.markDirty(this.gameObject); }
}

const VISUAL_PROPS = {
  offset: { type: "vec3", default: [0, 0, 0], doc: "Сдвиг внутри объекта, м" },
  rotation: { type: "vec3", default: [0, 0, 0], doc: "Доп. поворот внутри объекта, °" },
  castShadow: { type: "boolean", default: true, doc: "Отбрасывает тень от солнца" },
  surface: { type: "boolean", default: true, doc: "Крыша для осадков: под ним нет дождя и снега, пол сухой" },
};

export class Primitive extends VisualComponent {
  static type = "Primitive";
  static doc = "Простая фигура: коробка, цилиндр, конус, сфера или плоскость. Для заготовок (блокаута) и простых деталей.";
  static props = {
    shape: { type: "enum", options: ["box", "cylinder", "cone", "sphere", "plane"], default: "box", doc: "Форма" },
    size: { type: "vec3", default: [1, 1, 1], doc: "Размер [x, y, z], м (у цилиндра и конуса x и z — диаметры; у плоскости — [x, —, z])" },
    pivot: { type: "enum", options: ["center", "bottom"], default: "center", doc: "Точка объекта — центр фигуры или середина низа" },
    color: { type: "color", default: "#cccccc", doc: "Цвет: \"#rrggbb\", [r, g, b] или имя из палитры" },
    material: { type: "object", default: {}, doc: "Параметры материала: toon, glass, pattern, emissiveNight, haze… (render/materials.js)" },
    segments: { type: "number", default: 0, doc: "Число граней цилиндра/конуса или подробность сферы (0 — по умолчанию)" },
    ...VISUAL_PROPS,
  };

  rebuild() {
    const p = this.props;
    const kit = this.engine.assets.kit;
    const size = p.shape === "plane" ? [p.size[0], p.size[2] ?? p.size[1]] : p.size;
    const mesh = kit.primitive(p.shape, size, { pivot: p.pivot, color: p.color, material: p.material, segments: p.segments || undefined });
    placeHolder(this.holder, p);
    this.holder.add(applyVisualFlags(mesh, p));
  }
}

export class Model extends VisualComponent {
  static type = "Model";
  static doc = "Модель из папки моделей: JS-модель (assets/models/<имя>.js) или glTF из Blender (<имя>.glb).";
  static props = {
    model: { type: "asset", default: "", doc: "Имя модели: \"lamp-post\", \"trains/coach\" или \"station.glb\"" },
    params: { type: "object", default: {}, doc: "Параметры модели (у каждой свои — см. её файл)" },
    scale: { type: "number", default: 1, doc: "Масштаб содержимого" },
    ...VISUAL_PROPS,
  };

  /** Загрузить модель заранее, чтобы сцена появилась сразу целиком. */
  static preload(data, engine) {
    return data.model ? engine.assets.model(data.model, data.params || {}) : null;
  }

  rebuild() {
    const p = this.props;
    placeHolder(this.holder, p);
    if (!p.model) return;
    const token = (this.token = {});
    /** Промис готовности модели: await model.ready */
    this.ready = this.engine.assets.model(p.model, p.params).then(({ object, meta, definition }) => {
      if (token !== this.token || !this.holder) return this;
      this.instance = object;
      /** Данные модели для логики (размеры, точки огней…) */
      this.meta = meta;
      this.definition = definition;
      this.holder.add(applyVisualFlags(object, p));
      this.engine.scene.markDirty(this.gameObject);
      this.engine.precipitation.markDirty();
      this.invalidate("scene", "shadow");
      return this;
    }).catch(error => this.engine.assets.report(p.model, `${error.message} (объект «${this.gameObject.name}»; другие объекты с этой моделью тоже пустые)`));
  }

  /** Меши-слоты модели (куда приложение подставляет свою текстуру). @param {string} name */
  slots(name) {
    const out = [];
    this.instance?.traverse(o => { if (o.isMesh && o.userData.slot === name) out.push(o); });
    return out;
  }
}

export class Sprite extends VisualComponent {
  static type = "Sprite";
  static doc = "Картинка на плоскости, повёрнутая к камере (или стоящая вертикально).";
  static props = {
    texture: { type: "asset", default: "", doc: "Адрес картинки (относительно страницы)" },
    size: { type: "vec2", default: [1, 1], doc: "Размер [ширина, высота], м" },
    color: { type: "color", default: "#ffffff", doc: "Цвет-множитель" },
    billboard: { type: "enum", options: ["camera", "vertical", "none"], default: "camera", doc: "camera — всегда к камере; vertical — поворот только вокруг вертикали; none — как объект" },
    glowNight: { type: "number", default: 0, doc: "Подсветка ночью (0…1)" },
    offset: VISUAL_PROPS.offset,
  };

  rebuild() {
    const p = this.props;
    placeHolder(this.holder, { offset: p.offset });
    const tex = p.texture ? new THREE.TextureLoader().load(p.texture, () => this.invalidate()) : null;
    if (tex) { tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4; }
    const mat = this.engine.materials.create({ map: tex || undefined, color: p.color, transparent: true, receive: false,
      side: THREE.DoubleSide, litNight: [p.glowNight, p.glowNight, p.glowNight] });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]), mat);
    mesh.userData.noBatch = true;
    const cam = this.engine.camera, q = new THREE.Quaternion(), v = new THREE.Vector3();
    mesh.onBeforeRender = () => {
      if (p.billboard === "none") return;
      mesh.parent.getWorldQuaternion(q).invert();
      if (p.billboard === "camera") mesh.quaternion.copy(q.multiply(cam.quaternion));
      else {
        mesh.getWorldPosition(v);
        const yaw = Math.atan2(cam.position.x - v.x, cam.position.z - v.z);
        mesh.quaternion.copy(q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)));
      }
      mesh.updateMatrixWorld();
    };
    this.holder.add(mesh);
  }
}

export class Line extends VisualComponent {
  static type = "Line";
  static doc = "Тонкие линии без мерцания: провода, тросы, перила. Толщина в метрах, но не тоньше пикселя (тогда — прозрачнее).";
  static props = {
    points: { type: "array", default: [], doc: "Точки ломаной [[x, y, z], ...] в осях объекта, м" },
    width: { type: "number", default: .015, min: 0, doc: "Толщина, м" },
    color: { type: "color", default: "#33373c", doc: "Цвет" },
    sag: { type: "number", default: 0, doc: "Провис между соседними точками, м (провода)" },
    closed: { type: "boolean", default: false, doc: "Замкнуть ломаную" },
    offset: VISUAL_PROPS.offset,
  };

  rebuild() {
    const p = this.props;
    placeHolder(this.holder, { offset: p.offset });
    const pts = p.closed && p.points.length > 2 ? [...p.points, p.points[0]] : p.points;
    if (pts.length < 2) return;
    const lines = new LineBatch(this.engine.palette);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!p.sag) { lines.add(a, b, p.width, p.color); continue; }
      const n = 10;
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const t = k / n, q = [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * t);
        q[1] -= p.sag * 4 * t * (1 - t);
        lines.add(prev, q, p.width, p.color);
        prev = q;
      }
    }
    this.holder.add(lines.build(this.engine.materials));
  }
}

export class Glow extends VisualComponent {
  static type = "Glow";
  static doc = "Ореол огня: мягкое светящееся пятно, повёрнутое к камере. Свет на поверхности даёт компонент Light.";
  static props = {
    radius: { type: "number", default: 1, min: 0, doc: "Радиус ореола, м" },
    color: { type: "color", default: "#ffe9c0", doc: "Цвет" },
    intensity: { type: "number", default: 1, min: 0, doc: "Яркость" },
    night: { type: "boolean", default: true, doc: "Горит только ночью (и в сумрачную погоду)" },
    light: { type: "string", default: "", doc: "id компонента Light на этом объекте: ореол повторяет его состояние и яркость" },
    offset: VISUAL_PROPS.offset,
  };

  /** @type {number | undefined} яркость источника при связке (масштаб для ореола) */
  base = undefined;
  /** @type {number | undefined} */
  k = undefined;
  /** @type {boolean | undefined} */
  night = undefined;

  start() {
    if (!this.props.light) return;
    // источник меняется (включили, гаснет, яркость) — ореол за ним
    this.on("lightChanged", (/** @type {any} */ l) => { if (l?.key === this.props.light) this.#follow(); });
    this.#follow();
  }

  /** Связанный источник света. @returns {any} */
  get source() {
    const id = this.props.light;
    return id ? this.gameObject.components.find(c => c.type === "Light" && c.key === id) ?? null : null;
  }

  #follow() {
    const l = this.source;
    const k = !l || !l.activeAndEnabled ? 0 : (l.props.mode === "manual" && !l.props.on ? 0 : l.level) * (l.props.intensity / (this.base ??= l.props.intensity || 1));
    const night = l ? l.props.mode === "night" : this.props.night;
    if (k === this.k && night === this.night) return;
    this.k = k;
    this.night = night;
    this.clear();
    this.rebuild();
    this.invalidate("scene");
  }

  rebuild() {
    const p = this.props;
    const k = p.light ? this.k ?? 1 : 1, night = p.light ? this.night ?? p.night : p.night;
    const glows = new GlowBatch(this.engine.palette);
    glows.add(p.offset, p.radius, p.color, { night, intensity: p.intensity * k });
    this.holder.add(glows.build(this.engine.materials));
  }
}
