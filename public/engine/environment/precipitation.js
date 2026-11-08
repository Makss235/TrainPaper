// Осадки в мире: дождь штрихами, снег хлопьями, брызги на поверхностях — только в радиусе вокруг
// камеры (дальше они всё равно не различимы, а дымка их заменяет).
//
// Как устроено:
//  - частицы живут в объёме вокруг камеры; их положение целиком считается на видеокарте:
//    «зерно» частицы × размер объёма + накопленное смещение (падение и ветер), свёрнутое в объём.
//    Смещение копится по кадрам (offset += скорость × dt) — смена ветра меняет скорость, а не
//    сдвигает весь дождь разом (раньше из-за «скорость × всё время» осадки съезжали вбок);
//  - под крышей осадков нет: сверху рисуется карта высот поверхностей (крыши, навесы, вагоны, пол) —
//    капля исчезает, долетев до первой поверхности под собой, там же появляются брызги;
//  - частицы рисуются отдельным лёгким проходом в свой буфер с проверкой по глубине уже готовой
//    сцены: сама сцена при этом не перерисовывается, пока идёт дождь;
//  - плотность меняется постепенно: каждая частица видна, если её случайный порог ниже плотности —
//    при смене погоды капли появляются и исчезают на своих местах.
// Поверхности для карты высот — меши на слое SURFACE_LAYER (их помечают компоненты внешнего вида).
// @ts-nocheck
import * as THREE from "three";
import { COMMON, LIGHTING } from "../render/shaders.js";

export const SURFACE_LAYER = 2;

/** Пометить непрозрачные меши объекта как поверхности, на которые падают осадки. */
export function markSurfaces(object, on = true) {
  object.traverse(o => {
    if (!o.isMesh || o.material?.transparent) return;
    if (on) o.layers.enable(SURFACE_LAYER); else o.layers.disable(SURFACE_LAYER);
  });
  return object;
}

const SETTINGS = {
  rain: { count: 9000, radius: 22, height: 18, speed: 9.2, length: .035, width: .005, alpha: .55 },
  snow: { count: 14000, radius: 18, height: 14, speed: 1.15, size: .03, alpha: .95 },
  splash: { count: 900, size: .1 },
  map: { size: 512, extent: 120, ahead: 35 },   // карта высот: пикселей и метров по стороне; центр — на ahead м впереди камеры
};

// общие функции частиц: свёртка в объём, высота поверхности, глубина сцены
const PARTICLE_COMMON = /* glsl */`
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  uniform vec3 uOffset;
  uniform float uDensity;
  uniform float uTime;
  uniform sampler2D uHeight;        // глубина сверху: 0 — верх области, 1 — низ
  uniform vec4 uHeightBox;          // x0, z0, размер по x/z, —
  uniform vec2 uHeightRange;        // верх, низ области по y
  uniform vec2 uRes;
  vec3 wrapBox(vec3 p){ return uBoxMin + mod(p - uBoxMin, uBoxSize); }
  float surfaceY(vec2 xz){
    vec2 uv = (xz - uHeightBox.xy) / uHeightBox.z;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1e3;
    float d = textureLod(uHeight, vec2(uv.x, 1.0 - uv.y), 0.0).r;
    return mix(uHeightRange.x, uHeightRange.y, d);
  }
`;

const DEPTH_TEST = /* glsl */`
  uniform vec2 uRes;
  uniform sampler2D uSceneDepth;
  uniform vec2 uNearFar;
  float viewZ(float depth){ return (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * depth - uNearFar.y); }
  // доля видимости частицы: 0 — за геометрией сцены, плавно у самой поверхности
  float sceneVisible(float particleViewZ){
    float d = texture2D(uSceneDepth, gl_FragCoord.xy / uRes).r;
    if (d >= 1.0) return 1.0;
    float sceneZ = viewZ(d);
    return clamp((particleViewZ - sceneZ) / .15 + 1.0, 0.0, 1.0);
  }
`;

const RAIN_VERTEX = /* glsl */`
  ${PARTICLE_COMMON}
  attribute vec4 aSeed;             // xyz — место в объёме, w — порог плотности
  attribute vec2 aCorner;           // x: −1/+1 поперёк, y: 0 — голова, 1 — хвост
  uniform vec3 uDir;                // направление падения (единичный)
  uniform float uLength;            // длина штриха, м
  uniform float uWidth;             // толщина капли, м
  uniform float uRadius;
  varying float vAlpha;
  varying float vEdge;
  varying float vHalf;
  varying float vViewZ;
  varying vec3 vWorld;
  void main(){
    // капли падают с разной скоростью; k кратно 0,01 — см. перенос смещения в advance()
    float k = .85 + .06 * floor(fract(aSeed.w * 13.7) * 6.0);
    vec3 head = wrapBox(aSeed.xyz * uBoxSize + uOffset * k);
    float ground = surfaceY(head.xz);
    float hidden = step(uDensity, aSeed.w) + step(head.y, ground);
    vec3 tail = head - uDir * uLength * k;
    tail.y = max(tail.y, ground);
    vec3 cam = cameraPosition;
    float r = length(head.xz - cam.xz);
    float fade = (1.0 - smoothstep(uRadius * .6, uRadius, r)) * smoothstep(.6, 2.0, length(head - cam));
    vec4 vh = viewMatrix * vec4(head, 1.0), vt = viewMatrix * vec4(tail, 1.0);
    if (hidden > 0.0 || fade <= 0.0 || vh.z > -.3 || vt.z > -.3) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    vec4 ch = projectionMatrix * vh, ct = projectionMatrix * vt;
    vec2 sh = ch.xy / ch.w * uRes * .5, st = ct.xy / ct.w * uRes * .5;
    vec2 d = st - sh; float len = length(d);
    d = len > 1e-3 ? d / len : vec2(0.0, -1.0);
    vec2 n = vec2(-d.y, d.x);
    vec4 c = aCorner.y < .5 ? ch : ct;
    vec4 v = aCorner.y < .5 ? vh : vt;
    float focal = projectionMatrix[1][1] * uRes.y * .5;
    float px = uWidth * focal / -v.z;
    float w = max(px, 1.0);
    vAlpha = fade * clamp(px * 1.5, .35, 1.0);       // тонкая капля бледнее, но не исчезает
    float half_ = w * .5 + 1.0;
    c.xy += (n * aCorner.x * half_ + d * (aCorner.y < .5 ? -.5 : .5)) * 2.0 / uRes * c.w;
    vEdge = aCorner.x * half_;
    vHalf = w * .5;
    vViewZ = v.z;
    vWorld = aCorner.y < .5 ? head : tail;
    gl_Position = c;
  }
`;

const RAIN_FRAGMENT = /* glsl */`
  ${COMMON}
  ${LIGHTING}
  ${DEPTH_TEST}
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vAlpha;
  varying float vEdge;
  varying float vHalf;
  varying float vViewZ;
  varying vec3 vWorld;
  void main(){
    float cover = clamp(vHalf + .5 - abs(vEdge), 0.0, 1.0) * vAlpha * uAlpha * sceneVisible(vViewZ);
    if (cover < .004) discard;
    // капли подсвечиваются фонарями — ночью дождь блестит у огней
    vec3 col = uColor + lampLight(vWorld, vec3(0.0, 1.0, 0.0)) * .9;
    gl_FragColor = vec4(col * cover, cover);
  }
`;

const SNOW_VERTEX = /* glsl */`
  ${PARTICLE_COMMON}
  attribute vec4 aSeed;
  attribute vec2 aCorner;
  uniform float uSize;
  uniform float uRadius;
  varying vec2 vP;
  varying float vAlpha;
  varying float vViewZ;
  varying vec3 vWorld;
  void main(){
    float k = .75 + .05 * floor(fract(aSeed.w * 7.31) * 11.0);   // хлопья разной лёгкости (кратно 0,01)
    vec3 p = aSeed.xyz * uBoxSize + uOffset * k;
    // лёгкое кружение — ограниченное колебание вокруг траектории, а не снос
    float ph = aSeed.w * 6.2831;
    p.x += sin(uTime * (.6 + k * .5) + ph) * .35;
    p.z += cos(uTime * (.5 + k * .4) + ph * 1.7) * .3;
    p = wrapBox(p);
    float ground = surfaceY(p.xz);
    float hidden = step(uDensity, aSeed.w) + step(p.y, ground);
    float r = length(p.xz - cameraPosition.xz);
    float fade = (1.0 - smoothstep(.6 * uRadius, uRadius, r)) * smoothstep(.4, 1.4, length(p - cameraPosition));
    vec4 v = viewMatrix * vec4(p, 1.0);
    if (hidden > 0.0 || fade <= 0.0 || v.z > -.3) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    float focal = projectionMatrix[1][1] * uRes.y * .5;
    float size = uSize * (.6 + .8 * fract(aSeed.w * 3.17));
    float px = size * focal / -v.z;
    float w = max(px, 1.5);
    vAlpha = fade * clamp(px / 1.5, .25, 1.0);
    vec4 c = projectionMatrix * v;
    vec2 q = vec2(aCorner.x, aCorner.y * 2.0 - 1.0);       // углы квадрата −1…1
    c.xy += q * (w + 1.0) / uRes * c.w;                     // полуразмер (w + 1) / 2 пикселя
    vP = q * (w + 1.0) / w;
    vViewZ = v.z;
    vWorld = p;
    gl_Position = c;
  }
`;

const SNOW_FRAGMENT = /* glsl */`
  ${COMMON}
  ${LIGHTING}
  ${DEPTH_TEST}
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vP;
  varying float vAlpha;
  varying float vViewZ;
  varying vec3 vWorld;
  void main(){
    float r = length(vP);
    float a = (1.0 - smoothstep(.55, 1.0, r)) * vAlpha * uAlpha * sceneVisible(vViewZ);
    if (a < .004) discard;
    vec3 col = uColor + lampLight(vWorld, vec3(0.0, 1.0, 0.0)) * .7;
    gl_FragColor = vec4(col * a, a);
  }
`;

const SPLASH_VERTEX = /* glsl */`
  ${PARTICLE_COMMON}
  attribute vec4 aSeed;
  attribute vec2 aCorner;
  uniform float uSize;
  uniform float uRadius;
  varying vec2 vP;
  varying float vLife;
  varying float vViewZ;
  varying float vFade;
  float h11(float n){ return fract(sin(n) * 43758.5453); }
  void main(){
    // каждая брызга живёт короткий цикл и рождается в новом случайном месте объёма
    float period = .45 + .5 * aSeed.y;
    float t = uTime / period + aSeed.z;
    float cycle = floor(t);
    float life = fract(t);
    vec2 xz = uBoxMin.xz + vec2(h11(cycle * 1.31 + aSeed.x * 91.0), h11(cycle * 2.17 + aSeed.y * 57.0)) * uBoxSize.xz;
    float y = surfaceY(xz);
    float hidden = step(uDensity, aSeed.w) + step(y, -500.0) + step(.35, life);
    vec3 p = vec3(xz.x, y + .01, xz.y);
    float r = length(p.xz - cameraPosition.xz);
    vFade = (1.0 - smoothstep(.5 * uRadius, uRadius, r)) * smoothstep(1.0, 2.5, length(p - cameraPosition));
    vec2 q = vec2(aCorner.x, aCorner.y * 2.0 - 1.0);
    vec4 v = viewMatrix * vec4(p + vec3(q.x, 0.0, q.y) * uSize * (.4 + life * 2.2), 1.0);
    if (hidden > 0.0 || vFade <= 0.0 || v.z > -.3) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    vP = q;
    vLife = life / .35;
    vViewZ = v.z;
    gl_Position = projectionMatrix * v;
  }
`;

const SPLASH_FRAGMENT = /* glsl */`
  ${DEPTH_TEST}
  uniform vec3 uColor;
  varying vec2 vP;
  varying float vLife;
  varying float vViewZ;
  varying float vFade;
  void main(){
    // расходящееся кольцо
    float r = length(vP);
    float ring = smoothstep(.55, .8, r) * (1.0 - smoothstep(.85, 1.0, r));
    float a = ring * (1.0 - vLife) * vFade * .3 * sceneVisible(vViewZ);
    if (a < .004) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// side: DoubleSide — лента разворачивается в шейдере, обход вершин зависит от направления капли на экране
const BLEND = {
  transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

function particleGeometry(count, seed) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  let s = seed;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = count;
  return g;
}

export class Precipitation {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.rainOffset = new THREE.Vector3();
    this.snowOffset = new THREE.Vector3();
    this.rain = 0;
    this.snow = 0;
    this.wind = [0, 0];
    this.time = 0;
    // карта высот поверхностей сверху
    const M = SETTINGS.map;
    const depth = new THREE.DepthTexture(M.size, M.size, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.heightTarget = new THREE.WebGLRenderTarget(M.size, M.size, {
      depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false,
    });
    this.heightCamera = new THREE.OrthographicCamera(-M.extent / 2, M.extent / 2, M.extent / 2, -M.extent / 2, 1, 80);
    this.heightCamera.layers.set(SURFACE_LAYER);
    this.depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    this.heightCenter = null;
    this.heightDirty = true;
    this.heightLast = 0;

    const L = engine.light;
    const common = {
      uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uHeight: { value: depth }, uHeightBox: { value: new THREE.Vector4() },
      uHeightRange: { value: new THREE.Vector2(40, -40) }, uRes: engine.screen.uRes,
      uSceneDepth: { value: null }, uNearFar: { value: new THREE.Vector2(.3, 6000) },
    };
    this.common = common;
    const R = SETTINGS.rain, S = SETTINGS.snow, P = SETTINGS.splash;
    this.rainMat = new THREE.ShaderMaterial({
      ...BLEND, vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT,
      uniforms: { ...L, ...common, uOffset: { value: this.rainOffset }, uDensity: { value: 0 }, uDir: { value: new THREE.Vector3(0, -1, 0) },
        uLength: { value: R.speed * R.length }, uWidth: { value: R.width }, uRadius: { value: R.radius },
        uColor: { value: new THREE.Vector3(.7, .74, .8) }, uAlpha: { value: R.alpha } },
    });
    this.snowMat = new THREE.ShaderMaterial({
      ...BLEND, vertexShader: SNOW_VERTEX, fragmentShader: SNOW_FRAGMENT,
      uniforms: { ...L, ...common, uOffset: { value: this.snowOffset }, uDensity: { value: 0 }, uSize: { value: S.size },
        uRadius: { value: S.radius }, uColor: { value: new THREE.Vector3(.95, .96, .98) }, uAlpha: { value: S.alpha } },
    });
    this.splashMat = new THREE.ShaderMaterial({
      ...BLEND, vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT,
      uniforms: { ...common, uOffset: { value: new THREE.Vector3() }, uDensity: { value: 0 }, uSize: { value: P.size },
        uRadius: { value: R.radius * .7 }, uColor: { value: new THREE.Vector3(.75, .78, .84) } },
    });
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; this.scene.add(m); return m; };
    this.rainMesh = mk(particleGeometry(R.count, 7), this.rainMat);
    this.snowMesh = mk(particleGeometry(S.count, 13), this.snowMat);
    this.splashMesh = mk(particleGeometry(P.count, 29), this.splashMat);
  }

  /** Идёт ли что-нибудь (нужна ли анимация). */
  get active() {
    return this.rain > .002 || this.snow > .002;
  }

  /** Плотность и ветер из погоды; colorK — освещённость (днём ~1, ночью меньше). */
  setWeather(weather, colorK = 1) {
    this.rain = weather.rain;
    this.snow = weather.snow;
    this.wind = weather.wind;
    this.rainMat.uniforms.uDensity.value = weather.rain;
    this.splashMat.uniforms.uDensity.value = weather.rain * .9;
    this.snowMat.uniforms.uDensity.value = weather.snow;
    const g = .3 + .7 * colorK;
    this.rainMat.uniforms.uColor.value.set(.62 * g + .08, .66 * g + .08, .72 * g + .1);
    this.splashMat.uniforms.uColor.value.set(.7 * g + .1, .73 * g + .1, .78 * g + .1);
    this.snowMat.uniforms.uColor.value.set(.88 * g + .1, .9 * g + .1, .94 * g + .1);
    this.rainMesh.visible = weather.rain > .002;
    this.splashMesh.visible = weather.rain > .05;
    this.snowMesh.visible = weather.snow > .002;
  }

  /** Сцена изменилась (поезд проехал, объект подвинули) — перерисовать карту высот. */
  markDirty() {
    this.heightDirty = true;
  }

  /** Шаг анимации: накопить смещения падения и ветра. @param {number} dt */
  advance(dt) {
    this.time += dt;
    const R = SETTINGS.rain, S = SETTINGS.snow;
    // ветер лишь слегка наклоняет дождь и сносит снег — и только меняет скорость, не положение
    const wx = Math.max(-3, Math.min(3, this.wind[0] * .25)), wz = Math.max(-3, Math.min(3, this.wind[1] * .25));
    const v = new THREE.Vector3(wx, -R.speed, wz);
    this.rainOffset.addScaledVector(v, dt);
    this.rainMat.uniforms.uDir.value.copy(v).normalize();
    this.snowOffset.add(new THREE.Vector3(wx * .5 * dt, -S.speed * dt, wz * .5 * dt));
    // смещение держим в пределах 100 размеров объёма: обои работают сутками, а большие числа
    // во float32 теряют точность (капли начали бы дрожать). Скорости частиц кратны 0,01, поэтому
    // перенос на 100 размеров сдвигает каждую частицу на целое число объёмов — незаметно
    const size = this.common.uBoxSize.value;
    if (size.x > 0) for (const o of [this.rainOffset, this.snowOffset]) {
      o.x %= size.x * 100; o.y %= size.y * 100; o.z %= size.z * 100;
    }
    this.common.uTime.value = this.time;
  }

  /**
   * Нарисовать осадки в target (буфер того же размера, что сцена), проверяя глубину сцены.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} target
   * @param {THREE.Texture} sceneDepth
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Scene} worldScene  сцена (для карты высот)
   */
  render(renderer, target, sceneDepth, camera, worldScene) {
    const cam = camera.position, C = this.common;
    const R = Math.max(SETTINGS.rain.radius, SETTINGS.snow.radius);
    const H = SETTINGS.rain.height;
    C.uBoxMin.value.set(cam.x - R, cam.y - 5, cam.z - R);
    C.uBoxSize.value.set(R * 2, H, R * 2);
    C.uSceneDepth.value = sceneDepth;
    C.uNearFar.value.set(camera.near, camera.far);
    this.#updateHeightMap(renderer, worldScene, camera);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
  }

  #updateHeightMap(renderer, worldScene, camera) {
    const M = SETTINGS.map, now = performance.now();
    // центр карты — впереди камеры по горизонтали: под длинным навесом снег не «выглядывает» у края карты
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const len = Math.hypot(dir.x, dir.z) || 1;
    const cx = camera.position.x + dir.x / len * M.ahead, cz = camera.position.z + dir.z / len * M.ahead;
    const far = !this.heightCenter || Math.hypot(cx - this.heightCenter.x, cz - this.heightCenter.z) > M.extent * .1;
    if (!far && !(this.heightDirty && now - this.heightLast > 250)) return;
    this.heightDirty = false;
    this.heightLast = now;
    this.heightCenter = { x: cx, z: cz };
    const cam = { x: cx, z: cz };
    const hc = this.heightCamera, top = 40;
    hc.position.set(cam.x, top, cam.z);
    hc.up.set(0, 0, -1);
    hc.lookAt(cam.x, 0, cam.z);
    hc.near = 0; hc.far = 80;
    hc.updateProjectionMatrix();
    hc.updateMatrixWorld();
    this.common.uHeightBox.value.set(cam.x - M.extent / 2, cam.z - M.extent / 2, M.extent, 0);
    this.common.uHeightRange.value.set(top, top - 80);
    const prev = worldScene.overrideMaterial;
    worldScene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.heightTarget);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(worldScene, hc);
    worldScene.overrideMaterial = prev;
    // та же карта — материалам сцены: под крышей нет снега и пол сухой (сцена перерисуется со следующим кадром)
    const L = this.engine.light;
    L.uCoverMap.value = this.heightTarget.depthTexture;
    L.uCoverBox.value.set(cam.x - M.extent / 2, cam.z - M.extent / 2, M.extent, 1);
    L.uCoverRange.value.set(top, top - 80);
    this.engine.invalidate("scene");
  }

  dispose() {
    this.heightTarget.dispose();
    for (const m of [this.rainMesh, this.snowMesh, this.splashMesh]) { m.geometry.dispose(); m.material.dispose(); }
  }
}
