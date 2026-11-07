// Светящиеся ореолы: фонари, прожекторы и хвостовые огни поезда, подсветка табло.
// Каждый ореол — квадрат, повёрнутый к камере, с мягким радиальным спадом; складывается со сценой
// (свет добавляется, а не закрашивает). Ореол меньше пары пикселей плавно гаснет — дальние огни
// не мерцают. night: true — горит только ночью (×uLamps), иначе всегда.
//
//   const glows = new GlowBatch();
//   glows.add([x, y, z], 1.7, [1, .9, .7], { night: true, intensity: 1 });
//   group.add(glows.build());
import * as THREE from "three";
import { rgb } from "../colors.js";
import { LIGHT } from "./light.js";
import { WIRE_UNIFORMS } from "./wires.js";

const VERTEX = /* glsl */`
  attribute vec3 aCenter;
  attribute vec4 aGlow;        // rgb — цвет × яркость, a — радиус (м)
  attribute float aNight;
  uniform vec2 uRes;
  uniform float uLamps;
  uniform vec3 uFog;
  varying vec2 vP;
  varying vec3 vColor;
  void main(){
    vec4 v = viewMatrix * modelMatrix * vec4(aCenter, 1.0);
    float r = aGlow.a;
    float focal = projectionMatrix[1][1] * uRes.y * .5;
    float px = r * focal / max(-v.z, .01);
    float k = mix(1.0, uLamps, aNight);
    k *= smoothstep(.6, 2.5, px);                                 // крошечные ореолы гаснут
    // дальние огни гаснут: у точки схода десятки ореолов иначе складываются в яркую полосу
    float dist = length(v.xyz);
    k *= (1.0 - smoothstep(25.0, 320.0, dist) * .65) * (1.0 - smoothstep(uFog.x, uFog.y * 1.2, dist) * .9);
    vColor = aGlow.rgb * k;
    vP = position.xy;
    v.xy += position.xy * r;
    gl_Position = k < .002 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * v;
  }
`;

const FRAGMENT = /* glsl */`
  varying vec2 vP;
  varying vec3 vColor;
  void main(){
    float d = dot(vP, vP);
    if (d > 1.0) discard;
    float a = (1.0 - d);
    a = a * a * (.35 + .65 * exp(-d * 9.0));                     // яркое ядро и широкий мягкий ореол
    gl_FragColor = vec4(vColor * a, 0.0);
  }
`;

let material = null;
function glowMaterial() {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    uniforms: { uRes: WIRE_UNIFORMS.uRes, uLamps: LIGHT.uLamps, uFog: LIGHT.uFog },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // свет складывается с цветом, а прозрачность (альфа) слоя сцены не трогаем —
    // иначе ореол на фоне неба «вырезал» бы небо при сборке кадра
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  return material;
}

export class GlowBatch {
  constructor() {
    this.items = [];
  }

  /** Ореол в точке p радиусом r (м). opts: night (только ночью), intensity. */
  add(p, r, color, { night = true, intensity = 1 } = {}) {
    this.items.push({ p, r, c: rgb(color).map(v => v * intensity), night });
    return this;
  }

  build() {
    const n = this.items.length;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const center = new Float32Array(n * 3), glow = new Float32Array(n * 4), night = new Float32Array(n);
    this.items.forEach((it, i) => {
      center.set(it.p, i * 3);
      glow.set([...it.c, it.r], i * 4);
      night[i] = it.night ? 1 : 0;
    });
    g.setAttribute("aCenter", new THREE.InstancedBufferAttribute(center, 3));
    g.setAttribute("aGlow", new THREE.InstancedBufferAttribute(glow, 4));
    g.setAttribute("aNight", new THREE.InstancedBufferAttribute(night, 1));
    g.instanceCount = n;
    const mesh = new THREE.Mesh(g, glowMaterial());
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = n > 0;
    return mesh;
  }
}
