// Финальная сборка кадра — один полноэкранный проход:
//   1. небо (буфер пониженного разрешения) + звёзды и луна в полном разрешении, спрятанные за облаками;
//   2. поверх — сцена (её буфер с прозрачностью там, где видно небо);
//   3. осадки — слой частиц в мире (environment/precipitation.js), уже проверенный по глубине сцены;
//   4. эффекты пост-обработки из стека engine.post (render/post.js): по умолчанию grade, vignette, posterize,
//      grain, dither (бывшие style.filters); по желанию — bloom, outline, lut и свои эффекты.
// Шейдер пересобирается только при смене набора эффектов; параметры — uniforms.
// @ts-check
import * as THREE from "three";

const BASE = /* glsl */`
  uniform sampler2D tSky;
  uniform sampler2D tScene;
  uniform sampler2D tFx;
  uniform float uFxOn;
  uniform vec2 uRes;
  uniform mat4 uInvProj;
  uniform mat4 uCamRot;
  uniform float uTime;
  // небо ночью
  uniform float uStars;
  uniform vec3 uMoonDir;
  uniform vec3 uSunDir;
  uniform float uMoon;           // видимость луны 0…1
  uniform vec3 uMoonColor;
  uniform vec3 uSkyTop;
  uniform vec4 uMoonDisc;        // лунный диск: xy — центр на экране (пиксели буфера), z — радиус, w — виден ли (в кадре)
  uniform vec4 uSunDisc;         // солнечный диск: xy — центр на экране (пиксели буфера), z — радиус, w — видимость 0…1
  uniform vec3 uSunDiscColor;
  uniform vec4 uPlaneA;          // самолёт: xyz — направление на конец шлейфа, w — сила шлейфа (ночью 0)
  uniform vec4 uPlaneB;          // xyz — направление на самолёт, w — видимость 0…1
  uniform vec3 uPlaneColor;
  uniform float uPlaneLight;     // ночной огонёк 0…1 (мигает)
  varying vec2 vUv;

  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 hash33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

  vec3 rayDir(vec2 uv){
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    return normalize(mat3(uCamRot) * (p.xyz / p.w));
  }

  // звёзды: в каждой ячейке сетки направлений — не больше одной, с мягким пятном в 1–2 пикселя.
  // Положение звезды фиксировано в мире, поэтому при повороте камеры они не мерцают.
  float stars(vec3 d, float pix){
    if (d.y < .02) return 0.0;
    vec3 g = d * 90.0;
    vec3 cell = floor(g);
    vec3 r = hash33(cell);
    if (r.x > .07) return 0.0;
    vec3 star = (cell + .2 + .6 * r) / 90.0;
    float ang = length(normalize(star) - d);
    float size = pix * (.45 + .6 * r.y * r.y);
    float b = exp(-ang * ang / (size * size));
    // лёгкое мерцание: у каждой звезды свой неторопливый ритм, яркие мерцают чуть заметнее
    float twinkle = 1.0 + (.14 + .2 * r.z) * sin(uTime * (.9 + 2.6 * fract(r.x * 37.0)) + r.y * 6.2832);
    return b * (.25 + .75 * r.z * r.z) * twinkle * smoothstep(.02, .25, d.y);
  }

  // луна: шар, освещённый со стороны солнца — серп и фаза получаются сами. Диск задан на экране (центр и радиус
  // в пикселях), а не углом на небе: при широком объективе круг на небесной сфере у края кадра вытянулся бы в эллипс
  vec3 moon(vec2 frag){
    float R = uMoonDisc.z;
    vec2 p = (frag - uMoonDisc.xy) / R;
    float r2 = dot(p, p);
    if (r2 > 1.3) return vec3(0.0);
    float edge = 1.0 - smoothstep(1.0 - 1.5 / R, 1.0, sqrt(r2));
    vec3 m = normalize(uMoonDir);
    vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, m);
    vec3 n = p.x * right + p.y * up - sqrt(max(0.0, 1.0 - r2)) * m;
    float lit = smoothstep(-.04, .08, dot(n, uSunDir));
    return uMoonColor * (.07 + .93 * lit) * edge;
  }
`;

/** Основная часть main(): небо, звёзды и луна, сцена, осадки → col. */
const MAIN = /* glsl */`
  void main(){
    vec4 sky = texture2D(tSky, vUv);
    vec3 col = sky.rgb;
    vec3 d = rayDir(vUv);
    float px = length(rayDir(vUv + vec2(1.0 / uRes.x, 0.0)) - d);       // угол одного пикселя
    float clear = 1.0 - sky.a;
    // солнце: ровный светлый круг с мягким ореолом. Он задан на экране, а не углом на небе: при широком
    // объективе круг на небесной сфере вытянулся бы в эллипс у краёв кадра
    if (uSunDisc.w > .002) {
      float sd = length(vUv * uRes - uSunDisc.xy), R = uSunDisc.z;
      float disc = 1.0 - smoothstep(R - 1.0, R + 1.0, sd);
      float halo = exp(-sd * sd / (R * R * 9.0)) * .45 + exp(-sd * sd / (R * R * 60.0)) * .18;
      col = mix(col, uSunDiscColor, clamp(disc + halo, 0.0, 1.0) * uSunDisc.w * (1.0 - sky.a * .92));
    }
    // самолёт на эшелоне: тонкий тающий шлейф и светлая точка, ночью — мигающий огонёк
    if (uPlaneB.w > .002) {
      vec3 a = uPlaneA.xyz, b = uPlaneB.xyz, ab = b - a;
      float t = clamp(dot(d - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
      float dist = length(d - normalize(a + ab * t));
      float w = px * (.75 + 1.5 * (1.0 - t));                           // шлейф расплывается к хвосту
      float trail = (1.0 - smoothstep(w * .5, w * 1.5, dist)) * t * t * (.35 + .4 * t) * uPlaneA.w;
      float near = length(d - b);
      float body = (1.0 - smoothstep(px * .9, px * 2.2, near)) * max(uPlaneA.w, .12);
      col = mix(col, uPlaneColor, clamp(trail + body, 0.0, 1.0) * uPlaneB.w * clear);
      col += vec3(1.0, .92, .8) * exp(-near * near / (px * px * 5.0)) * uPlaneLight * uPlaneB.w * clear;
    }
    if (uStars > .002 || uMoon > .002) {
      col += vec3(.9, .93, 1.0) * stars(d, px) * uStars * clear;
      if (uMoonDisc.w > .5) col = mix(col, max(col, moon(vUv * uRes)), uMoon * clear);
    }
    vec4 scene = texture2D(tScene, vUv);
    col = col * (1.0 - scene.a) + scene.rgb;

    // осадки: частицы в мире, отрисованные отдельным проходом с проверкой глубины сцены
    if (uFxOn > .5) {
      vec4 fx = texture2D(tFx, vUv);
      col = col * (1.0 - fx.a) + fx.rgb;
    }
`;

const SUN_V = new THREE.Vector3(), SUN_Q = new THREE.Quaternion(), SUN_P = new THREE.Matrix4();

/** @param {any} v */
const isUniform = v => v && typeof v === "object" && !Array.isArray(v) && "value" in v && !v.isTexture;

export class Composite {
  /** @param {any} style стиль движка */
  constructor(style) {
    this.style = style;
    /** @type {Record<string, {value: any}>} */
    this.base = {
      tSky: { value: null }, tScene: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() },
      uTime: { value: 0 },
      uStars: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: 0 }, uMoonColor: { value: new THREE.Vector3(.93, .95, .98) }, uSkyTop: { value: new THREE.Vector3() },
      uMoonDisc: { value: new THREE.Vector4(0, 0, 10, 0) }, uSunDisc: { value: new THREE.Vector4(0, 0, 10, 0) }, uSunDiscColor: { value: new THREE.Vector3(1, .98, .92) },
      uPlaneA: { value: new THREE.Vector4(0, 1, 0, 0) }, uPlaneB: { value: new THREE.Vector4(0, 1, 0, 0) },
      uPlaneColor: { value: new THREE.Vector3(1, 1, 1) }, uPlaneLight: { value: 0 },
      tFx: { value: null }, uFxOn: { value: 0 },
    };
    /** Все uniforms сборки (основные + эффектов) */
    this.uniforms = { ...this.base };
    /** @type {import("./post.js").PostStack | null} */
    this.stack = null;
    this.version = -1;
    this.sunVisible = 0;
    this.material = this.#material([]);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Стек эффектов (engine.post). @param {import("./post.js").PostStack} stack */
  setStack(stack) { this.stack = stack; this.version = -1; }

  /** Шейдер под набор эффектов. @param {import("./post.js").PostEffect[]} effects */
  #material(effects) {
    const glsl = effects.map(e => (/** @type {any} */ (e.constructor)).glsl).join("\n");
    const apply = effects.map(e => `    col = ${e.type}(col, vUv);`).join("\n");
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `${BASE}\n${glsl}\n${MAIN}\n${apply}\n    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n  }\n`,
      depthTest: false, depthWrite: false,
    });
  }

  /** Набор эффектов поменялся — пересобрать шейдер. */
  #rebuild() {
    const stack = /** @type {import("./post.js").PostStack} */ (this.stack);
    const effects = stack.list().filter(e => e.enabled);
    this.uniforms = { ...this.base };
    for (const fx of effects) this.#fill(fx);
    this.material.dispose();
    this.material = this.#material(effects);
    this.quad.material = this.material;
    this.version = stack.version;
    this.effects = effects;
  }

  /** @param {import("./post.js").PostEffect} fx */
  #fill(fx) {
    for (const [name, v] of Object.entries(fx.uniforms(fx.props))) {
      if (isUniform(v)) { this.uniforms[name] = v; continue; }        // общий uniform (например, uLamps движка)
      const u = (this.uniforms[name] ||= { value: null });
      u.value = Array.isArray(v) ? vec(v, u.value) : v;
    }
  }

  /** Обновить uniforms эффекта (свойства поменялись) — без пересборки шейдера. @param {import("./post.js").PostEffect} fx */
  syncEffect(fx) {
    if (this.version !== this.stack?.version) return;               // пересоберётся в ближайшем кадре
    this.#fill(fx);
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
  }

  /** Сила и цвет солнечного диска (задаёт окружение): visible 0…1. @param {number} visible @param {number[]} color */
  setSun(visible, color) {
    this.sunVisible = visible;
    this.base.uSunDiscColor.value.set(color[0], color[1], color[2]);
  }

  /** Где солнце и луна на экране: направления на них проецируются объективом неба. */
  #discs(camera, width, height) {
    // прямая проекция объектива неба (у ортографической камеры небо показано своим перспективным объективом)
    const P = (camera.userData.skyProjectionInverse ? SUN_P.copy(camera.userData.skyProjectionInverse).invert() : camera.projectionMatrix).elements;
    const inverse = SUN_Q.copy(camera.quaternion).invert(), focal = P[5] * height / 2;
    /** @param {THREE.Vector4} out @param {THREE.Vector3} dir @param {number} radius @param {number} visible */
    const place = (out, dir, radius, visible) => {
      const v = SUN_V.copy(dir).normalize().applyQuaternion(inverse);
      if (v.z > -1e-3 || !(visible > 0)) { out.w = 0; return; }           // светило за спиной камеры
      const x = (P[0] * v.x + P[8] * v.z) / -v.z, y = (P[5] * v.y + P[9] * v.z) / -v.z;
      out.set((x + 1) / 2 * width, (y + 1) / 2 * height, radius, visible);
    };
    // радиусы: угловой размер по объективу, но не мельче заметного кружка
    place(this.base.uSunDisc.value, this.base.uSunDir.value, Math.max(focal * Math.tan(1.5 * Math.PI / 180), height * .017), this.sunVisible);
    place(this.base.uMoonDisc.value, this.base.uMoonDir.value, Math.max(focal * .0145, height * .0135), this.base.uMoon.value > .002 ? 1 : 0);
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Texture} sky @param {THREE.Texture} scene @param {THREE.Texture | null} fx
   * @param {THREE.PerspectiveCamera} camera @param {number} width @param {number} height
   */
  render(renderer, sky, scene, fx, camera, width, height) {
    if (this.stack && this.version !== this.stack.version) this.#rebuild();
    // анимированные эффекты (зерно) — новое значение на каждый кадр сборки
    for (const e of this.effects || []) if ((/** @type {any} */ (e.constructor)).fps) this.#fill(e);
    const U = this.uniforms;
    U.tSky.value = sky;
    U.tScene.value = scene;
    U.tFx.value = fx;
    U.uFxOn.value = fx ? 1 : 0;
    U.uRes.value.set(width, height);
    U.uInvProj.value.copy(camera.userData.skyProjectionInverse || camera.projectionMatrixInverse);   // лучи неба — см. CameraSystem.layout
    U.uCamRot.value.extractRotation(camera.matrixWorld);
    U.uTime.value = (performance.now() / 1000) % 3600;
    this.#discs(camera, width, height);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.ortho);
  }
}

/** Массив → THREE.Vector2/3/4 (тот же объект, если уже есть). @param {number[]} v @param {any} old */
function vec(v, old) {
  const C = v.length === 2 ? THREE.Vector2 : v.length === 3 ? THREE.Vector3 : v.length === 4 ? THREE.Vector4 : null;
  if (!C) return v;
  const out = old instanceof C ? old : new C();
  return out.fromArray(v);
}
