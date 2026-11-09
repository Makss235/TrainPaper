// Задник — компонент Backdrop: картинка или панорама на цилиндре большого радиуса за сценой (город, лес, горы).
// Подкрашивается светом и дымкой неба, поэтому вписывается в любое время суток; ночью поверх — вторая
// текстура с огнями (nightTexture, светится × сумерки). Без теней и без осадков.
//
//   { "name": "Город", "components": [{ "type": "Backdrop", "texture": "img/backdrops/city.png",
//     "nightTexture": "img/backdrops/city-night.png", "distance": 1800, "height": 160, "from": -70, "to": 70 }] }
//
// from / to — направления краёв картинки, ° от оси −z сцены (вправо — плюс). Центр цилиндра — объект
// (обычно начало сцены, где камера). Прозрачные места картинки (небо) — прозрачны: видно настоящее небо.
// Пути к картинкам — от папки assets/.
// @ts-check
import * as THREE from "three";
import { Component } from "../core/component.js";

const VERTEX = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main(){
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */`
  uniform sampler2D uMap;
  uniform sampler2D uNight;
  uniform vec4 uInfo;            // есть дневная, есть ночная, дымка 0…1, яркость
  uniform vec3 uTint;
  uniform vec3 uAmbSky;
  uniform vec3 uSun;
  uniform vec3 uFogColor;
  uniform vec3 uFog;
  uniform float uLamps;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main(){
    vec4 day = uInfo.x > .5 ? texture2D(uMap, vUv) : vec4(uTint, 1.0);
    if (day.a < .004) discard;
    // свет неба: рассеянный и немного солнца — силуэт не плоско-чёрный и не пересвеченный
    vec3 col = day.rgb * uTint * (uAmbSky * 1.05 + uSun * .3) * uInfo.w;
    // дымка — как у дальних объектов, но с собственной силой (задник очень далеко)
    float haze = clamp(uInfo.z * uFog.z, 0.0, 1.0);
    col = mix(col, uFogColor, haze);
    if (uInfo.y > .5) col += texture2D(uNight, vUv).rgb * uLamps * (1.0 - haze * .6);
    gl_FragColor = vec4(col * day.a, day.a);
  }
`;

export class Backdrop extends Component {
  static type = "Backdrop";
  static category = "Окружение";
  static doc = "Задник: картинка или панорама на цилиндре за сценой, подкрашенная небом и дымкой; ночью — огни (nightTexture).";
  static props = {
    texture: { type: "asset", default: "", doc: "Картинка (PNG с прозрачным небом), путь от папки assets/" },
    nightTexture: { type: "asset", default: "", doc: "Огни ночью (светятся × сумерки)" },
    distance: { type: "number", default: 1800, min: 10, doc: "Радиус цилиндра, м" },
    height: { type: "number", default: 160, min: 1, doc: "Высота картинки, м" },
    bottom: { type: "number", default: -2, doc: "Низ картинки, м (над объектом)" },
    from: { type: "number", default: -60, doc: "Левый край, ° от оси −z (вправо — плюс)" },
    to: { type: "number", default: 60, doc: "Правый край, °" },
    fog: { type: "number", default: .55, min: 0, max: 1, doc: "Сила дымки (0 — чётко, 1 — тонет в дымке)" },
    tint: { type: "color", default: "#ffffff", doc: "Цвет-множитель" },
    brightness: { type: "number", default: 1, min: 0, doc: "Яркость" },
    segments: { type: "number", default: 64, min: 4, doc: "Граней цилиндра" },
  };

  awake() { this.#build(); }
  onChange() { this.#build(); this.invalidate(); }
  onEnable() { if (this.mesh) this.mesh.visible = true; }
  onDisable() { if (this.mesh) this.mesh.visible = false; }
  onDestroy() { this.#clear(); }

  #clear() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    /** @type {THREE.ShaderMaterial} */ (this.mesh.material).dispose();
    for (const t of this.textures || []) t.dispose();
    this.mesh.removeFromParent();
    this.mesh = null;
  }

  /** @param {string} src */
  #texture(src) {
    const tex = new THREE.TextureLoader().load(this.engine.assets.url(src), () => this.invalidate(),
      undefined, () => this.engine.assets.report(`backdrop:${src}`, `Задник «${this.gameObject.name}»: картинка ${src} не загрузилась`));
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return tex;
  }

  #build() {
    this.#clear();
    const p = this.props, E = this.engine, L = E.light;
    const day = p.texture ? this.#texture(p.texture) : null, night = p.nightTexture ? this.#texture(p.nightTexture) : null;
    this.textures = [day, night].filter(Boolean);
    // цилиндр изнутри: угол от оси −z (вправо — плюс): x = R·sin, z = −R·cos
    const a0 = p.from * Math.PI / 180, a1 = p.to * Math.PI / 180, n = Math.max(4, Math.round(p.segments));
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + (a1 - a0) * t, x = Math.sin(a) * p.distance, z = -Math.cos(a) * p.distance;
      pos.push(x, p.bottom, z, x, p.bottom + p.height, z);
      uv.push(t, 0, t, 1);
      if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: day }, uNight: { value: night },
        uInfo: { value: new THREE.Vector4(day ? 1 : 0, night ? 1 : 0, p.fog, p.brightness) },
        uTint: { value: new THREE.Vector3(...E.palette.rgb(p.tint)) },
        uAmbSky: L.uAmbSky, uSun: L.uSun, uFogColor: L.uFogColor, uFog: L.uFog, uLamps: L.uLamps,
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, premultipliedAlpha: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;                               // раньше сцены: всё остальное рисуется поверх
    mesh.frustumCulled = false;
    mesh.userData.noBatch = true;
    mesh.visible = this.activeAndEnabled;
    /** @type {THREE.Mesh | null} */
    this.mesh = mesh;
    this.object3D.add(mesh);
  }
}
