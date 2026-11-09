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
    return b * (.25 + .75 * r.z * r.z) * smoothstep(.02, .25, d.y);
  }

  // луна: шар, освещённый со стороны солнца — серп и фаза получаются сами
  vec3 moon(vec3 d, float pix){
    float R = .0145;
    vec3 m = normalize(uMoonDir);
    float c = dot(d, m);
    if (c < .99) return vec3(0.0);
    vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, m);
    vec2 p = vec2(dot(d - m * c, right), dot(d - m * c, up)) / R;
    float r2 = dot(p, p);
    float edge = 1.0 - smoothstep(1.0 - pix / R * 1.5, 1.0, sqrt(r2));
    if (edge <= 0.0) return vec3(0.0);
    vec3 n = p.x * right + p.y * up - sqrt(max(0.0, 1.0 - r2)) * m;
    float lit = smoothstep(-.04, .08, dot(n, uSunDir));
    vec3 col = uMoonColor * (.07 + .93 * lit);
    return col * edge;
  }
`;

/** Основная часть main(): небо, звёзды и луна, сцена, осадки → col. */
const MAIN = /* glsl */`
  void main(){
    vec4 sky = texture2D(tSky, vUv);
    vec3 col = sky.rgb;
    vec3 d = rayDir(vUv);
    float px = length(rayDir(vUv + vec2(1.0 / uRes.x, 0.0)) - d);       // угол одного пикселя
    if (uStars > .002 || uMoon > .002) {
      float clear = 1.0 - sky.a;
      col += vec3(.9, .93, 1.0) * stars(d, px) * uStars * clear;
      col = mix(col, max(col, moon(d, px)), uMoon * clear);
    }
    vec4 scene = texture2D(tScene, vUv);
    col = col * (1.0 - scene.a) + scene.rgb;

    // осадки: частицы в мире, отрисованные отдельным проходом с проверкой глубины сцены
    if (uFxOn > .5) {
      vec4 fx = texture2D(tFx, vUv);
      col = col * (1.0 - fx.a) + fx.rgb;
    }
`;

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
      tFx: { value: null }, uFxOn: { value: 0 },
    };
    /** Все uniforms сборки (основные + эффектов) */
    this.uniforms = { ...this.base };
    /** @type {import("./post.js").PostStack | null} */
    this.stack = null;
    this.version = -1;
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

  /** Перечитать style.filters (инструмент разработчика, прежний формат стиля). */
  syncStyle() {
    const F = this.style.filters, P = this.stack;
    if (!P) return;
    P.set("grade", { exposure: F.exposure, contrast: F.contrast, saturation: F.saturation, warmth: F.warmth });
    P.set("vignette", { amount: F.vignette, color: F.vignetteColor });
    P.set("posterize", { levels: F.posterize });
    P.set("grain", { amount: F.grain });
    P.set("dither", { amount: F.dither });
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
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamRot.value.extractRotation(camera.matrixWorld);
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
