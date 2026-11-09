// Система света: собирает компоненты Light (фонари, прожекторы, направленная подсветка) и StripeShadow
// (тени оград) со всей сцены и отдаёт их шейдерам.
//
// Источники лежат в текстуре данных (до 256), шейдер читает не больше quality.maxLights (по умолчанию 32):
// отбираются те, чья область (сфера радиуса range или конус прожектора) попадает в кадр, по вкладу
// (яркость × радиус² / расстояние²). Список пересобирается только при изменениях (markDirty) и когда
// камера ушла далеко или повернулась заметно — в простое ничего не считается.
// Тени — у солнца и у не больше quality.maxShadowLights прожекторов с castShadow (render/shadows.js SpotShadow).
// @ts-check
import * as THREE from "three";
import { MAX_SPOT_SHADOWS, setLights, setPatternShadows } from "../render/lighting.js";
import { ShadowCaster, SpotShadow } from "../render/shadows.js";

const DEG = Math.PI / 180;

export class LightSystem {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {Set<import("../components/lighting.js").Light>} */
    this.lights = new Set();
    /** @type {Set<import("../components/lighting.js").StripeShadow>} */
    this.patterns = new Set();
    this.dirty = true;
    /** @type {THREE.Vector3 | null} */
    this.lastCam = null;
    /** @type {THREE.Quaternion | null} */
    this.lastRot = null;
    /** @type {SpotShadow[]} */
    this.shadows = [];
    /** Карты теней прожекторов поменяли позу — перерисовать в этом кадре */
    this.shadowsDirty = false;
    this.warned = false;
    /** Сводка для инспектора */
    this.stats = { total: 0, active: 0, shadows: 0 };
    this.frustum = new THREE.Frustum();
    // пока прожекторов с тенями нет, шейдеру нужна хоть какая-то карта глубины (сэмплер теней не принимает обычную текстуру)
    this.empty = new ShadowCaster(engine.renderer, 1, new THREE.PerspectiveCamera());
    engine.light.uSpotShadow0.value = engine.light.uSpotShadow1.value = this.empty.depth;
  }

  /** @param {any} light */
  add(light) { this.lights.add(light); this.dirty = true; this.engine.invalidate("scene"); }
  /** @param {any} light */
  remove(light) { this.lights.delete(light); this.dirty = true; this.engine.invalidate("scene", "shadow"); }
  /** @param {any} p */
  addPattern(p) { this.patterns.add(p); this.dirty = true; }
  /** @param {any} p */
  removePattern(p) { this.patterns.delete(p); this.dirty = true; }
  markDirty() { this.dirty = true; this.engine.invalidate("scene"); }

  /** Перед кадром: пересобрать список, если что-то поменялось или камера ушла далеко / повернулась. */
  update() {
    const E = this.engine, camera = E.camera, cam = camera.position;
    const far = !this.lastCam || cam.distanceTo(this.lastCam) > 4;
    const turned = !this.lastRot || this.lastRot.angleTo(camera.quaternion) > 4 * DEG;
    if (!this.dirty && !far && !turned) return;
    this.dirty = false;
    this.lastCam = cam.clone();
    this.lastRot = camera.quaternion.clone();
    const Q = E.quality;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    /** @type {{data: import("../render/lighting.js").LightData, score: number, light: any}[]} */
    const list = [];
    let total = 0;
    for (const l of this.lights) {
      if (!l.activeAndEnabled) continue;
      total++;
      const p = l.props;
      const on = p.mode === "manual" ? p.on : true;
      if (!on || l.level <= .001 || p.intensity <= 0) continue;
      const { position, direction } = l.world();
      const kind = p.kind;
      const cosOuter = Math.cos(p.angle * DEG), cosInner = Math.cos(p.angle * (1 - p.penumbra) * DEG);
      /** @type {import("../render/lighting.js").LightData} */
      const data = { kind, position, color: l.color, range: p.range, night: l.nightOnly, direction, cosOuter, cosInner, shadow: -1 };
      let score;
      if (kind === "directional") score = 1e9 * p.intensity;
      else {
        // область источника в кадре? (сфера с запасом — без «перескока» у края экрана)
        const center = kind === "spot"
          ? new THREE.Vector3(...position).addScaledVector(new THREE.Vector3(...direction), p.range * .5)
          : new THREE.Vector3(...position);
        sphere.set(center, (kind === "spot" ? p.range * .6 : p.range) * 1.15 + 2);
        if (!this.frustum.intersectsSphere(sphere)) continue;
        const d = Math.max(0, cam.distanceTo(center) - p.range * .5);
        score = p.intensity * l.level * p.range * p.range / (d * d + p.range * p.range);
      }
      list.push({ data, score, light: l });
    }
    list.sort((a, b) => b.score - a.score);
    const chosen = list.slice(0, Math.max(0, Q.maxLights));
    // тени: первые по вкладу прожекторы с castShadow
    const maxShadows = Math.min(MAX_SPOT_SHADOWS, Math.max(0, Q.maxShadowLights));
    let used = 0, skipped = 0;
    for (const c of chosen) {
      if (c.data.kind !== "spot" || !c.light.props.castShadow) continue;
      if (used >= maxShadows) { skipped++; continue; }
      const caster = (this.shadows[used] ||= new SpotShadow(E.renderer, E.light, used, Math.min(Q.spotShadowSize, E.renderer.capabilities.maxTextureSize)));
      if (caster.aim(c.data.position, /** @type {number[]} */ (c.data.direction), c.light.props.angle, c.data.range)) this.shadowsDirty = true;
      c.data.shadow = used++;
    }
    for (let i = used; i < this.shadows.length; i++) if (this.shadows[i].enabled) { this.shadows[i].off(); this.shadowsDirty = true; }
    if (skipped && !this.warned) {
      this.warned = true;
      console.warn(`Тени у ${used + skipped} прожекторов, а карт — ${maxShadows} (quality.maxShadowLights): у остальных без теней`);
    }
    setLights(E.light, chosen.map(c => c.data));
    setPatternShadows(E.light, [...this.patterns].filter(p => p.activeAndEnabled).map(p => p.world()));
    this.stats = { total, active: chosen.length, shadows: used };
  }

  /** Нарисовать карты теней прожекторов (движок — когда слой "shadow" грязный или прожектор сдвинулся). @param {THREE.Scene} scene */
  renderShadows(scene) {
    for (const s of this.shadows) if (s.enabled) s.render(scene);
    this.shadowsDirty = false;
  }

  dispose() {
    for (const s of this.shadows) s.dispose();
    this.shadows = [];
    this.empty.dispose();
  }
}
