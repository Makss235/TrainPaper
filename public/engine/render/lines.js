// Тонкие линии без мерцания: провода, тросы, струны, консоли, рельсы, перила, пантографы.
//
// Обычная геометрия тоньше пикселя вдали рассыпается на пунктир, который «ползёт» при движении
// камеры — один из источников шума. Здесь каждый отрезок разворачивается к камере лентой шириной
// не меньше 1 пикселя, а если настоящая толщина меньше — линия становится прозрачнее (её вклад
// в пиксель такой же, как у настоящего провода). Края ленты сглажены аналитически.
//
//   const lines = new LineBatch();
//   lines.add([x, y, z], [x, y, z], 0.012, "#33373c");      // отрезок, толщина в метрах, цвет
//   lines.line([[...], [...], ...], 0.015, "#33373c");       // ломаная
//   group.add(lines.build(engine.materials));                // один меш на все отрезки
// @ts-nocheck
import * as THREE from "three";
import { rgb } from "./palette.js";
import { COMMON, LIGHTING } from "./shaders.js";

export const LINE_VERTEX = /* glsl */`
  attribute vec3 aA;
  attribute vec3 aB;
  attribute vec2 aSide;          // x: −1/+1 поперёк ленты, y: 0 — конец A, 1 — конец B
  attribute float aWidth;
  attribute vec3 aColor;
  uniform vec2 uRes;             // размер буфера в пикселях
  uniform float uMinPx;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vHalf;
  varying float vAlpha;
  void main(){
    vec4 wa = modelMatrix * vec4(aA, 1.0), wb = modelMatrix * vec4(aB, 1.0);
    vec4 va = viewMatrix * wa, vb = viewMatrix * wb;
    // отсечение ближней плоскостью: часть отрезка за спиной камеры подтягиваем к плоскости
    float nearZ = -0.3;
    if (va.z > nearZ && vb.z > nearZ) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    if (va.z > nearZ) va = mix(va, vb, (va.z - nearZ) / (va.z - vb.z));
    if (vb.z > nearZ) vb = mix(vb, va, (vb.z - nearZ) / (vb.z - va.z));
    vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
    vec2 sa = ca.xy / ca.w * uRes * .5, sb = cb.xy / cb.w * uRes * .5;
    vec2 dir = sb - sa;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 c = aSide.y < .5 ? ca : cb;
    vec4 v = aSide.y < .5 ? va : vb;
    float focal = projectionMatrix[1][1] * uRes.y * .5;
    float px = aWidth * focal / max(-v.z, .01);       // настоящая толщина в пикселях
    float w = max(px, uMinPx);
    vAlpha = clamp(px / uMinPx, 0.0, 1.0);
    float half_ = w * .5 + 1.0;                        // +1 пиксель на сглаживание края
    // концы ленты чуть вытягиваем вдоль отрезка, чтобы соседние отрезки ломаной сходились без щелей
    vec2 along = dir * (aSide.y < .5 ? -1.0 : 1.0) * .5;
    c.xy += (nrm * aSide.x * half_ + along) * 2.0 / uRes * c.w;
    vEdge = aSide.x * half_;
    vHalf = w * .5;
    vColor = aColor;
    vWorld = aSide.y < .5 ? wa.xyz : wb.xyz;
    gl_Position = c;
  }
`;

export const LINE_FRAGMENT = /* glsl */`
  ${COMMON}
  ${LIGHTING}
  uniform float uOpacity;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vHalf;
  varying float vAlpha;
  void main(){
    float cover = clamp(vHalf + .5 - abs(vEdge), 0.0, 1.0) * vAlpha * uOpacity;
    if (cover < .003) discard;
    // провод освещён рассеянным светом и немного солнцем; ночью — фонарями
    vec3 k = uAmbSky * .95 + uSun * .35 + lampLight(vWorld, vec3(0.0, 1.0, 0.0)) * .6;
    vec3 col = applyFog(vColor * softCeiling(k), vWorld, 1.0);
    // дальние провода растворяются в дымке и по прозрачности
    float d = distance(vWorld, cameraPosition);
    cover *= 1.0 - smoothstep(uFog.x, uFog.y * 1.1, d) * .85;
    gl_FragColor = vec4(col * cover, cover);
  }
`;

export class LineBatch {
  constructor() {
    this.a = []; this.b = []; this.side = []; this.width = []; this.color = []; this.index = [];
    this.count = 0;
  }

  /** Отрезок a→b толщиной width (м) цвета color. */
  add(a, b, width, color = "wire") {
    const c = rgb(color), base = this.count * 4;
    for (const [s, e] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      this.a.push(a[0], a[1], a[2]);
      this.b.push(b[0], b[1], b[2]);
      this.side.push(s, e);
      this.width.push(width);
      this.color.push(c[0], c[1], c[2]);
    }
    this.index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    this.count++;
    return this;
  }

  /** Ломаная через точки pts. */
  line(pts, width, color) {
    for (let i = 1; i < pts.length; i++) this.add(pts[i - 1], pts[i], width, color);
    return this;
  }

  /**
   * Длинная линия вдоль пути (рельс, перила) от z = from до z = to на высоте y.
   * Режется на куски, растущие с расстоянием: толщина и прозрачность ленты меняются вдоль куска
   * линейно, а на длинном куске это заметно расходилось бы с перспективой.
   */
  along(x, y, from, to, width, color) {
    let z = from;
    while (z > to) {
      const step = Math.max(2, Math.abs(z) * .35);
      const next = Math.max(to, z - step);
      this.add([x, y, z], [x, y, next], width, color);
      z = next;
    }
    return this;
  }

  /** Изолятор: стержень с «тарелками» поперёк. */
  insulator(a, b, sheds = 4, color = "insulator") {
    this.add(a, b, .045, color);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * .085, ny = dx / l * .085;
    for (let k = 1; k <= sheds; k++) {
      const t = k / (sheds + 1), p = [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t];
      this.add([p[0] - nx, p[1] - ny, p[2]], [p[0] + nx, p[1] + ny, p[2]], .028, color);
    }
    return this;
  }

  /**
   * Один меш на все отрезки (материал — engine.materials.line()).
   * @param {import("./materials.js").Materials} materials
   */
  build(materials) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("aA", new THREE.Float32BufferAttribute(this.a, 3));
    g.setAttribute("aB", new THREE.Float32BufferAttribute(this.b, 3));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(this.side, 2));
    g.setAttribute("aWidth", new THREE.Float32BufferAttribute(this.width, 1));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(this.color, 3));
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.a, 3));   // для границ объекта
    g.setIndex(this.index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials.line());
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.userData.lines = true;
    mesh.userData.noBatch = true;
    return mesh;
  }
}
