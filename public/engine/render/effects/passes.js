// Эффекты с подготовкой до сборки кадра:
//   bloom   — ореол ярких огней ночью: яркие места сцены в буфере 1/4 разрешения, размытие в два прохода;
//             считается заново, только когда перерисована сцена (в простое — ничего);
//   outline — контуры по глубине сцены (стилизация «рисунок тушью»): скачок глубины между соседними пикселями;
//   lut     — цветокоррекция по таблице 3D LUT: PNG-полоса N² × N (256×16 или 1024×32), amount 0…1.
//             Путь к картинке — от папки assets/.
// @ts-check
import * as THREE from "three";
import { FullscreenPass, PostEffect } from "../post.js";

const QUAD_VERTEX = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

export class Bloom extends PostEffect {
  static type = "bloom";
  static order = 40;
  static doc = "Ореол ярких огней (ночью): яркие места сцены размываются и складываются с кадром.";
  static props = {
    amount: { type: "number", default: .6, min: 0, doc: "Сила" },
    threshold: { type: "number", default: .72, min: 0, doc: "С какой яркости светится (0…1)" },
    radius: { type: "number", default: 1, min: .1, doc: "Ширина ореола (множитель)" },
    night: { type: "boolean", default: true, doc: "Только ночью (и в сумрачную погоду)" },
  };
  static glsl = /* glsl */`
    uniform sampler2D uBloomTex;
    uniform float uBloomAmount;
    uniform float uBloomNight;
    uniform float uLampsPost;
    vec3 bloom(vec3 col, vec2 uv){
      float k = uBloomAmount * mix(1.0, uLampsPost, uBloomNight);
      return col + texture2D(uBloomTex, uv).rgb * k;
    }`;

  /** @param {any} stack @param {Record<string, any>} [props] */
  constructor(stack, props) {
    super(stack, props);
    const opts = { depthBuffer: false, type: THREE.HalfFloatType };
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
    this.bright = new FullscreenPass(new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uThreshold: { value: .72 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        uniform sampler2D tScene; uniform float uThreshold; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tScene, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + .25, l), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.blur = new FullscreenPass(new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          vec3 s = texture2D(tSrc, vUv).rgb * .227;
          s += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * .316;
          s += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * .07;
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.ready = false;
  }

  /** @param {Record<string, any>} p */
  uniforms(p) {
    return { uBloomTex: this.a.texture, uBloomAmount: p.amount, uBloomNight: p.night ? 1 : 0, uLampsPost: this.stack.engine.light.uLamps };
  }

  /** @param {import("../post.js").PostInputs} i */
  prepare(i) {
    const w = Math.max(1, Math.round(i.width / 4)), h = Math.max(1, Math.round(i.height / 4));
    const resized = this.a.width !== w || this.a.height !== h;
    if (resized) { this.a.setSize(w, h); this.b.setSize(w, h); }
    if (!i.sceneChanged && !resized && this.ready) return;
    const r = i.renderer;
    this.bright.material.uniforms.tScene.value = i.scene;
    this.bright.material.uniforms.uThreshold.value = this.props.threshold;
    this.bright.render(r, this.a);
    const U = this.blur.material.uniforms, k = this.props.radius;
    for (let pass = 0; pass < 2; pass++) {
      U.tSrc.value = this.a.texture; U.uDir.value.set(k * (1 + pass) / w, 0); this.blur.render(r, this.b);
      U.tSrc.value = this.b.texture; U.uDir.value.set(0, k * (1 + pass) / h); this.blur.render(r, this.a);
    }
    this.ready = true;
  }

  dispose() {
    this.a.dispose(); this.b.dispose(); this.bright.dispose(); this.blur.dispose();
  }
}

export class Outline extends PostEffect {
  static type = "outline";
  static order = 15;
  static doc = "Контуры по глубине сцены — стилизация «рисунок тушью».";
  static props = {
    amount: { type: "number", default: .8, min: 0, max: 1, doc: "Сила линий" },
    color: { type: "color", default: "#1c1f26", doc: "Цвет линий" },
    threshold: { type: "number", default: .08, min: .001, doc: "Скачок глубины (доля расстояния), с которого рисуется линия" },
    width: { type: "number", default: 1, min: .5, doc: "Толщина, px" },
    fade: { type: "number", default: 220, min: 1, doc: "Дальше этого (м) линии гаснут" },
  };
  static glsl = /* glsl */`
    uniform sampler2D uOutlineDepth;
    uniform vec4 uOutline;         // сила, порог, толщина (px), дальность
    uniform vec3 uOutlineColor;
    uniform vec4 uOutlineProjZ;    // строки z и w матрицы проекции: [2][2], [3][2], [2][3], [3][3]
    float outlineDepth(vec2 uv){
      // расстояние вдоль оси камеры — через саму матрицу: верно для перспективы и для ортографии
      float ndc = texture2D(uOutlineDepth, uv).r * 2.0 - 1.0;
      return (ndc * uOutlineProjZ.w - uOutlineProjZ.y) / (ndc * uOutlineProjZ.z - uOutlineProjZ.x);
    }
    vec3 outline(vec3 col, vec2 uv){
      vec2 px = uOutline.z / uRes;
      float c = outlineDepth(uv);
      float e = 0.0;
      e = max(e, abs(outlineDepth(uv + vec2(px.x, 0.0)) - c));
      e = max(e, abs(outlineDepth(uv - vec2(px.x, 0.0)) - c));
      e = max(e, abs(outlineDepth(uv + vec2(0.0, px.y)) - c));
      e = max(e, abs(outlineDepth(uv - vec2(0.0, px.y)) - c));
      float line = smoothstep(uOutline.y, uOutline.y * 2.0, e / max(c, .01));
      line *= 1.0 - smoothstep(uOutline.w * .6, uOutline.w, c);
      return mix(col, uOutlineColor, line * uOutline.x);
    }`;
  depth = { value: /** @type {THREE.Texture | null} */ (null) };
  projZ = { value: new THREE.Vector4(-1, -.6, -1, 0) };
  /** @param {Record<string, any>} p */
  uniforms(p) {
    return { uOutlineDepth: this.depth, uOutline: [p.amount, p.threshold, p.width, p.fade], uOutlineColor: this.stack.engine.palette.rgb(p.color), uOutlineProjZ: this.projZ };
  }
  /** @param {import("../post.js").PostInputs} i */
  prepare(i) {
    this.depth.value = i.depth;
    const pe = i.camera.projectionMatrix.elements;
    this.projZ.value.set(pe[10], pe[14], pe[11], pe[15]);
  }
}

export class Lut extends PostEffect {
  static type = "lut";
  static order = 50;
  static doc = "Цветокоррекция по таблице 3D LUT: PNG-полоса N² × N (256×16 или 1024×32). Путь — от папки assets/.";
  static props = {
    texture: { type: "asset", default: "", doc: "Картинка LUT, например \"img/lut/cold.png\"" },
    amount: { type: "number", default: 1, min: 0, max: 1, doc: "Сила (0 — без изменений)" },
  };
  static glsl = /* glsl */`
    uniform sampler2D uLutTex;
    uniform vec3 uLutInfo;         // N, сила, загружена (1/0)
    vec3 lutSample(vec3 c){
      float N = uLutInfo.x;
      c = clamp(c, 0.0, 1.0);
      float b = c.b * (N - 1.0), b0 = floor(b), b1 = min(b0 + 1.0, N - 1.0);
      vec2 xy = c.rg * (N - 1.0) + .5;
      vec2 uv0 = vec2((b0 * N + xy.x) / (N * N), xy.y / N);
      vec2 uv1 = vec2((b1 * N + xy.x) / (N * N), xy.y / N);
      return mix(texture2D(uLutTex, uv0).rgb, texture2D(uLutTex, uv1).rgb, b - b0);
    }
    vec3 lut(vec3 col, vec2 uv){
      if (uLutInfo.z < .5) return col;
      return mix(col, lutSample(col), uLutInfo.y);
    }`;
  /** @type {THREE.Texture | null} */
  tex = null;
  src = "";
  size = 16;
  loaded = false;

  /** @param {Record<string, any>} p */
  uniforms(p) {
    if (p.texture !== this.src) this.#load(p.texture);
    return { uLutTex: this.tex, uLutInfo: [this.size, p.amount, this.loaded ? 1 : 0] };
  }

  /** @param {string} src */
  #load(src) {
    this.src = src;
    this.loaded = false;
    this.tex?.dispose();
    this.tex = null;
    if (!src) return;
    const E = this.stack.engine;
    const url = E.assets.url(src);
    this.tex = new THREE.TextureLoader().load(url, (/** @type {any} */ t) => {
      if (this.src !== src) return;
      this.size = t.image.height;
      if (t.image.width !== this.size * this.size) console.warn(`LUT ${src}: нужна полоса N² × N, а она ${t.image.width}×${t.image.height}`);
      this.loaded = true;
      this.stack.sync(this);
    }, undefined, () => console.warn(`LUT ${src} не загрузился (${url})`));
    const t = /** @type {any} */ (this.tex);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
  }

  dispose() { this.tex?.dispose(); }
}
