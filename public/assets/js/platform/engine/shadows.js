// Тени от солнца: карта глубины из «глаз» солнца над областью, где тени видны (обычно — ближние
// ~100 м платформы и путей). Перерисовывается только по требованию: сдвинулось солнце
// или проехал поезд. Камера теней привязана к сцене, а не к зрителю, поэтому края теней
// не «плывут» при повороте камеры за курсором.
//
// Отбрасывают тень только объекты на слое SHADOW_LAYER (см. castShadow() ниже) — провода,
// ореолы, прозрачные ограды в карту не попадают: их тонкие тени давали бы муар.
import * as THREE from "three";
import { LIGHT } from "./light.js";

export const SHADOW_LAYER = 1;

/** Пометить объект (и всех потомков-мешей) как отбрасывающий тень. */
export function castShadow(object, on = true) {
  object.traverse(o => {
    if (!o.isMesh) return;
    if (on) o.layers.enable(SHADOW_LAYER); else o.layers.disable(SHADOW_LAYER);
  });
  return object;
}

export class SunShadow {
  constructor(renderer, size = 2048) {
    this.renderer = renderer;
    this.size = size;
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depth.compareFunction = THREE.LessEqualCompare;          // аппаратное сравнение: PCF за одно чтение
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 500);
    this.camera.layers.set(SHADOW_LAYER);
    this.material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    // область, где нужны тени: [x0, x1], [y0, y1], [z0, z1]
    this.region = { x: [-20, 20], y: [-1, 14], z: [14, -110] };
    LIGHT.uShadowMap.value = depth;
    LIGHT.uShadowParams.value.set(0, 0, 0, 1 / size);
    this.enabled = false;
    this.#clear();
  }

  /** Карта «без теней» — чтобы шейдерам всегда было что читать. */
  #clear() {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.setRenderTarget(null);
  }

  setRegion(region) {
    Object.assign(this.region, region);
    const far = Math.max(Math.abs(region.z?.[1] ?? this.region.z[1]), 40);
    LIGHT.uShadowFade.value.set(far * .72, far * .95);
  }

  /** Направление на солнце (мир) и сила прямого света: при слабом солнце тени выключаются. */
  update(scene, sunDir, direct) {
    this.enabled = direct > .02 && sunDir.y > .01;
    LIGHT.uShadowParams.value.x = this.enabled ? 1 : 0;
    if (!this.enabled) return;
    const { x, y, z } = this.region;
    const center = new THREE.Vector3((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2);
    const cam = this.camera;
    cam.position.copy(center).addScaledVector(sunDir, 300);
    // «верх» карты — вдоль пути: длинная область ложится на карту экономнее
    cam.up.set(0, 0, -1);
    if (Math.abs(sunDir.z) > .98) cam.up.set(1, 0, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    // рамка камеры по 8 углам области в осях солнца
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const px of x) for (const py of y) for (const pz of z) {
      const p = new THREE.Vector3(px, py, pz).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    Object.assign(cam, { left: minX, right: maxX, bottom: minY, top: maxY, near: Math.max(.1, -maxZ - 40), far: -minZ + 5 });
    cam.updateProjectionMatrix();
    // мир → текстурные координаты карты (0…1) и глубина
    const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    LIGHT.uShadowMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const texel = Math.max(maxX - minX, maxY - minY) / this.size;          // метров на тексель
    const depthRange = cam.far - cam.near;
    LIGHT.uShadowParams.value.set(1, (.03 + texel * 1.2) / depthRange, texel * 1.6, 1 / this.size);
  }

  render(scene) {
    if (!this.enabled) return;
    const r = this.renderer;
    const prev = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    r.setRenderTarget(this.target);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(scene, this.camera);
    r.setRenderTarget(null);
    scene.overrideMaterial = prev;
  }

  dispose() {
    this.target.dispose();
    this.target.depthTexture.dispose();
    this.material.dispose();
  }
}
