// Карты теней. Общий класс ShadowCaster — карта глубины из «глаз» источника с аппаратным сравнением:
//   SunShadow  — ортографическая, от солнца (и направленного света) над областью, где тени видны
//                (обычно — ближние ~100 м платформы и путей). Камера теней привязана к сцене, а не к зрителю,
//                поэтому края теней не «плывут» при повороте камеры за курсором;
//   SpotShadow — перспективная, от прожектора (Light kind "spot", castShadow). Таких не больше
//                quality.maxShadowLights (по умолчанию 2). Тени от точечных источников (кубические карты) — нет.
// Карты перерисовываются только по требованию: invalidate("shadow") (что-то сдвинулось), сдвиг или включение источника.
//
// Отбрасывают тень только объекты на слое SHADOW_LAYER (см. castShadow() ниже) — провода,
// ореолы, прозрачные ограды в карту не попадают: их тонкие тени давали бы муар.
// @ts-check
import * as THREE from "three";

export const SHADOW_LAYER = 1;

/** Пометить объект (и всех потомков-мешей) как отбрасывающий тень. @param {THREE.Object3D} object */
export function castShadow(object, on = true) {
  object.traverse((/** @type {any} */ o) => {
    if (!o.isMesh) return;
    if (on) o.layers.enable(SHADOW_LAYER); else o.layers.disable(SHADOW_LAYER);
  });
  return object;
}

/** Мир → текстурные координаты карты (0…1) и глубина. */
const BIAS = () => new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);

export class ShadowCaster {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} size  сторона карты, текселей
   * @param {THREE.Camera} camera  ортографическая или перспективная камера источника
   */
  constructor(renderer, size, camera) {
    this.renderer = renderer;
    this.size = size;
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depth.compareFunction = THREE.LessEqualCompare;          // аппаратное сравнение: PCF за одно чтение
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.depth = depth;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.camera = camera;
    this.camera.layers.set(SHADOW_LAYER);
    this.material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    /** Мир → карта (для шейдера) */
    this.matrix = new THREE.Matrix4();
    this.enabled = false;
    /** Сколько раз перерисована (для инспектора) */
    this.renders = 0;
    this.clear();
  }

  /** Карта «без теней» — чтобы шейдерам всегда было что читать. */
  clear() {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.setRenderTarget(null);
  }

  /** Обновить матрицу мир → карта после смены камеры. */
  updateMatrix() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix?.();
    this.matrix.copy(BIAS()).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  /** Нарисовать карту глубины сцены. @param {THREE.Scene} scene */
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
    this.renders++;
  }

  dispose() {
    this.target.dispose();
    this.depth.dispose();
    this.material.dispose();
  }
}

export class SunShadow extends ShadowCaster {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import("./lighting.js").LightUniforms} light  uniforms освещения движка
   * @param {number} size
   */
  constructor(renderer, light, size = 2048) {
    super(renderer, size, new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 500));
    this.L = light;
    // область, где нужны тени: [x0, x1], [y0, y1], [z0, z1]
    this.region = { x: [-20, 20], y: [-1, 14], z: [14, -110] };
    this.L.uShadowMap.value = this.depth;
    this.L.uShadowParams.value.set(0, 0, 0, 1 / size);
  }

  /** @param {{x?: number[], y?: number[], z?: number[]}} region */
  setRegion(region) {
    const { x, y, z } = region;
    Object.assign(this.region, Object.fromEntries(Object.entries({ x, y, z }).filter(([, v]) => v)));
    const far = Math.max(Math.abs(region.z?.[1] ?? this.region.z[1]), 40);
    this.L.uShadowFade.value.set(far * .72, far * .95);
  }

  /**
   * Направление на солнце (мир) и сила прямого света: при слабом солнце тени выключаются.
   * @param {THREE.Scene} scene @param {THREE.Vector3} sunDir @param {number} direct
   */
  update(scene, sunDir, direct) {
    void scene;
    this.enabled = direct > .02 && sunDir.y > .01;
    this.L.uShadowParams.value.x = this.enabled ? 1 : 0;
    if (!this.enabled) return;
    const { x, y, z } = this.region;
    const center = new THREE.Vector3((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2);
    const cam = /** @type {THREE.OrthographicCamera} */ (this.camera);
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
    this.updateMatrix();
    this.L.uShadowMatrix.value.copy(this.matrix);
    const texel = Math.max(maxX - minX, maxY - minY) / this.size;          // метров на тексель
    const depthRange = cam.far - cam.near;
    this.L.uShadowParams.value.set(1, (.03 + texel * 1.2) / depthRange, texel * 1.6, 1 / this.size);
  }
}

export class SpotShadow extends ShadowCaster {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import("./lighting.js").LightUniforms} light
   * @param {number} index  номер карты (0 или 1) — какие uniforms заполнять
   * @param {number} size
   */
  constructor(renderer, light, index, size = 1024) {
    super(renderer, size, new THREE.PerspectiveCamera(60, 1, .3, 40));
    this.L = light;
    this.index = index;
    this.key = "";
    if (index === 0) light.uSpotShadow0.value = this.depth; else light.uSpotShadow1.value = this.depth;
  }

  /**
   * Поставить «глаз» прожектора. Возвращает true, если поза поменялась (карту надо перерисовать).
   * @param {number[]} position @param {number[]} direction @param {number} angle  половина угла конуса, ° @param {number} range
   */
  aim(position, direction, angle, range) {
    const key = [...position, ...direction, angle, range].map(v => v.toFixed(3)).join(",");
    this.enabled = true;
    this.L.uSpotShadowParams.value[this.index].x = 1;
    if (key === this.key) return false;
    this.key = key;
    const cam = /** @type {THREE.PerspectiveCamera} */ (this.camera);
    cam.fov = Math.min(170, angle * 2 + 6);
    cam.near = Math.max(.1, range * .01);
    cam.far = range;
    cam.position.set(position[0], position[1], position[2]);
    const t = new THREE.Vector3(position[0] + direction[0], position[1] + direction[1], position[2] + direction[2]);
    cam.up.set(0, 1, 0);
    if (Math.abs(direction[1]) > .99) cam.up.set(0, 0, -1);
    cam.lookAt(t);
    this.updateMatrix();
    this.L.uSpotShadowMatrix.value[this.index].copy(this.matrix);
    const texel = 2 * Math.tan(cam.fov * Math.PI / 360) * range / this.size;
    this.L.uSpotShadowParams.value[this.index].set(1, .0006, Math.min(.12, texel * 1.5 + .02), 1 / this.size);
    return true;
  }

  off() {
    this.enabled = false;
    this.key = "";
    this.L.uSpotShadowParams.value[this.index].x = 0;
  }
}
