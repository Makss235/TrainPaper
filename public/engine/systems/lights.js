// Система света: собирает компоненты Light (фонари) и StripeShadow (тени оград) со всей сцены
// и отдаёт их шейдерам. Шейдер учитывает 8 ближайших к камере источников — этого хватает
// для пятен света под фонарями и на борту поезда.
// @ts-nocheck
import * as THREE from "three";
import { setLamps, setPatternShadows } from "../render/lighting.js";

export class LightSystem {
  constructor(engine) {
    this.engine = engine;
    this.lights = new Set();
    this.patterns = new Set();
    this.dirty = true;
    this.lastCam = null;
  }

  add(light) { this.lights.add(light); this.dirty = true; }
  remove(light) { this.lights.delete(light); this.dirty = true; }
  addPattern(p) { this.patterns.add(p); this.dirty = true; }
  removePattern(p) { this.patterns.delete(p); this.dirty = true; }
  markDirty() { this.dirty = true; }

  /** Перед кадром: пересобрать список, если что-то поменялось или камера ушла далеко. */
  update() {
    const cam = this.engine.camera.position;
    const far = !this.lastCam || cam.distanceTo(this.lastCam) > 4;
    if (!this.dirty && !far) return;
    this.dirty = false;
    this.lastCam = cam.clone();
    const L = this.engine.light;
    const lamps = [];
    const v = new THREE.Vector3();
    for (const l of this.lights) {
      if (!l.enabled || !l.gameObject.activeInHierarchy) continue;
      const p = l.props;
      v.set(...p.offset).applyMatrix4(l.object3D.matrixWorld);
      lamps.push({ position: v.toArray(), color: l.color, range: p.range, intensity: p.intensity, night: p.night });
    }
    setLamps(L, lamps, cam.toArray());
    setPatternShadows(L, [...this.patterns].filter(p => p.enabled && p.gameObject.activeInHierarchy).map(p => p.world()));
  }
}
