// Свет на полу — компонент GroundGlow: мягкие световые пятна на горизонтальной плоскости (свет из окон
// на пол, пятно от витрины, отсвет вывески). Пятна складываются со сценой, теней не дают.
//
//   { "type": "GroundGlow", "rects": [[1.9, 3, 3.4, 5.5], [1.9, 8, 3.4, 10.5]], "height": 1.115, "mode": "night" }
//
// rects — прямоугольники [x0, z0, x1, z1] в осях объекта, height — высота плоскости над объектом.
// Внутри прямоугольника яркость спадает от центра к краям (эллипсом), как у прежнего света из окон.
// @ts-check
import * as THREE from "three";
import { Component } from "../core/component.js";

const FRAGMENT = /* glsl */`
  uniform float uLamps;
  uniform float uNight;
  varying vec2 vUv;
  varying vec3 vColor;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float a = max(0.0, 1.0 - dot(p, p));
    gl_FragColor = vec4(vColor * a * a * mix(1.0, uLamps, uNight), 0.0);
  }
`;
const VERTEX = /* glsl */`
  attribute vec3 color;
  varying vec2 vUv;
  varying vec3 vColor;
  void main(){ vUv = uv; vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** @type {WeakMap<object, Record<string, THREE.ShaderMaterial>>} материалы по движку (night / always) */
const materials = new WeakMap();

/** @param {import("../core/engine.js").Engine} engine @param {string} mode */
function material(engine, mode) {
  let set = materials.get(engine);
  if (!set) materials.set(engine, (set = {}));
  return set[mode] ||= new THREE.ShaderMaterial({
    uniforms: { uLamps: engine.light.uLamps, uNight: { value: mode === "night" ? 1 : 0 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,             // прямоугольник в любом обходе
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

export class GroundGlow extends Component {
  static type = "GroundGlow";
  static category = "Свет";
  static doc = "Мягкие световые пятна на полу (свет из окон на платформу, отсвет витрины): прямоугольники в осях объекта, яркость спадает к краям.";
  static props = {
    rects: { type: "array", default: [], doc: "Прямоугольники [[x0, z0, x1, z1], ...] в осях объекта, м" },
    height: { type: "number", default: 0, doc: "Высота плоскости над объектом, м" },
    color: { type: "color", default: [.27, .21, .13], doc: "Цвет (складывается со сценой)" },
    intensity: { type: "number", default: 1, min: 0, doc: "Яркость" },
    mode: { type: "enum", options: ["night", "always"], default: "night", doc: "night — только ночью (и в сумрачную погоду), always — всегда" },
  };

  awake() { this.#build(); }
  onChange() { this.#build(); this.invalidate(); }
  onEnable() { if (this.mesh) this.mesh.visible = true; }
  onDisable() { if (this.mesh) this.mesh.visible = false; }
  onDestroy() { this.#clear(); }

  #clear() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
    this.mesh = null;
  }

  #build() {
    this.#clear();
    const p = this.props, rects = /** @type {number[][]} */ (p.rects || []);
    if (!rects.length) return;
    const c = this.engine.palette.rgb(p.color).map(v => v * p.intensity);
    const pos = [], uv = [], col = [];
    for (const [x0, z0, x1, z1] of rects) {
      const y = p.height;
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      for (let i = 0; i < 6; i++) col.push(...c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, material(this.engine, p.mode));
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    mesh.userData.noBatch = true;
    mesh.visible = this.activeAndEnabled;
    /** @type {THREE.Mesh | null} */
    this.mesh = mesh;
    this.object3D.add(mesh);
  }
}
