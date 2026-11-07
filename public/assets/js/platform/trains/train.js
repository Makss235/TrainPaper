// Поезд: состав из вагонов, стоящий на пути. Собирается по типу из trains/index.js.
//
//   const train = new Train("fpk-long");
//   scene.add(train.object);
//   train.place(track, s, heading);
//
// Положение задаётся координатой хвоста s (z мира) и направлением heading:
//   heading = +1 — голова к большим z (к камере): поезд занимает z от s до s + length;
//   heading = −1 — голова к горизонту: поезд занимает z от s − length до s.
// Локальные оси поезда: z = 0 — хвост, z = length — голова.
import * as THREE from "three";
import { rng } from "../engine/geometry.js";
import { GlowBatch } from "../engine/glows.js";
import { toonCached } from "../engine/materials.js";
import { castShadow } from "../engine/shadows.js";
import { CARS, TRAIN_TYPES } from "./index.js";
import { Plate } from "./plate.js";
import { boxGeometry } from "../engine/geometry.js";
import { LIGHT } from "../engine/light.js";

const SPILL_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SPILL_FRAGMENT = /* glsl */`
  uniform float uLamps;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float a = max(0.0, 1.0 - dot(p, p));
    gl_FragColor = vec4(uColor * a * a * uLamps, 0.0);
  }
`;
let spillMaterial = null;
function spill() {
  return spillMaterial ||= new THREE.ShaderMaterial({
    uniforms: { uLamps: LIGHT.uLamps, uColor: { value: new THREE.Vector3(.27, .21, .13) } },
    vertexShader: SPILL_VERTEX, fragmentShader: SPILL_FRAGMENT,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

export class Train {
  constructor(typeId, { seed = 1 } = {}) {
    const type = TRAIN_TYPES[typeId] || TRAIN_TYPES["fpk-long"];
    this.typeId = TRAIN_TYPES[typeId] ? typeId : "fpk-long";
    this.plate = new Plate();
    this.object = new THREE.Group();
    this.object.name = `train:${this.typeId}`;
    const list = typeof type.consist === "function" ? type.consist(rng(seed)) : type.consist;
    // вагоны ставим от хвоста: в списке они от головы
    const order = [...list].reverse();
    this.cars = [];
    let z = 0, lastGap = 0;
    const gangways = new THREE.Group();
    order.forEach((entry, i) => {
      const [id, ...flags] = entry.split(":");
      const car = CARS[id];
      if (!car) { console.warn(`Нет вагона «${id}»`); return; }
      const flip = flags.includes("flip");
      const obj = car.build({ plate: this.plate, flip, rear: i === 0, head: i === order.length - 1 });
      const holder = new THREE.Group();
      if (flip) { obj.rotation.y = Math.PI; obj.position.z = car.length; }
      holder.add(obj);
      holder.position.z = z;
      this.object.add(holder);
      const prev = this.cars.at(-1);
      // переход-гармошка между соседними вагонами, у которых он есть
      if (prev && prev.car.gangway && car.gangway) {
        const gw = car.gangway, gap = z - prev.z1;
        const mesh = new THREE.Mesh(boxGeometry([-gw.half, gw.half], gw.y, [prev.z1 - .05, prev.z1 + gap + .05]), gangwayMaterial());
        gangways.add(mesh);
      }
      this.cars.push({ car, z0: z, z1: z + car.length, flip, holder });
      lastGap = car.gap ?? .64;
      z += car.length + lastGap;
    });
    this.length = z - lastGap;
    this.object.add(gangways);
    this.#lights();
    // тень отбрасывают кузова (стекло и огни — нет)
    this.object.traverse(o => { if (o.isMesh && (o.userData.cast || o.parent === gangways)) castShadow(o); });
    this.track = null;
    this.spill = null;
    this.s = 0;
    this.heading = 1;
  }

  /** Хвостовые огни и закрытый переход у хвоста, фары головы. */
  #lights() {
    const glows = new GlowBatch();
    const rear = this.cars[0];
    if (rear?.car.tailLights) {
      for (const [x, y] of rear.car.tailLights) {
        glows.add([x, y, -.06], .28, [1, .18, .1], { night: false, intensity: .6 });
        glows.add([x, y, -.06], .9, [1, .2, .12], { night: true, intensity: .55 });
      }
      if (rear.car.gangway && !rear.car.headLights) {           // у кабины и носа заглушки нет
        const gw = rear.car.gangway;
        const plate = new THREE.Mesh(boxGeometry([-gw.half, gw.half], gw.y, [-.22, 0]), gangwayMaterial());
        castShadow(plate);
        this.object.add(plate);
      }
    }
    // фары у головного вагона без своих (если голова — обычный вагон, например при толкании)
    this.object.add(glows.build());
  }

  /** Поставить поезд на путь: s — z хвоста, heading — ±1 (см. начало файла). */
  place(track, s, heading = 1) {
    if (track !== this.track || heading !== this.heading) {
      this.track = track;
      this.heading = heading;
      this.#buildSpill();
    }
    this.s = s;
    this.object.position.set(track.x, track.y, s);
    this.object.rotation.y = heading > 0 ? 0 : Math.PI;
    this.object.updateMatrixWorld(true);
  }

  /** Ночью свет из окон ложится на платформу у пути — мягкими пятнами. */
  #buildSpill() {
    if (this.spill) { this.spill.geometry.dispose(); this.spill.removeFromParent(); this.spill = null; }
    const pf = this.track?.platform;
    if (!pf) return;
    const side = this.heading > 0 ? 1 : -1;               // локальная ось x поезда в мире
    const edgeLocal = (pf.edge - this.track.x) * side;
    const width = 1.5, x0 = edgeLocal + Math.sign(edgeLocal) * width;     // от края — в сторону платформы
    const parts = [];
    const ps = Math.sign(edgeLocal);                       // с какой стороны поезда платформа
    for (const c of this.cars) {
      const L = c.car.length;
      for (const [a, b] of c.car.windowSpill ?? []) {
        // окна заданы для стороны −x вагона; сторона +x — зеркально по длине; развёрнутый вагон
        // показывает платформе другой свой бок
        const carSide = c.flip ? -ps : ps;
        const [ca, cb] = carSide < 0 || c.car.sameSides ? [a, b] : [L - b, L - a];
        const za = c.flip ? c.z1 - cb : c.z0 + ca, zb = c.flip ? c.z1 - ca : c.z0 + cb;
        const g = new THREE.PlaneGeometry(Math.abs(edgeLocal - x0), (zb - za) + .9);
        g.rotateX(-Math.PI / 2);
        g.translate((edgeLocal + x0) / 2, pf.top + .015, (za + zb) / 2);
        parts.push(g);
      }
    }
    if (!parts.length) return;
    const merged = mergePlanes(parts);
    this.spill = new THREE.Mesh(merged, spill());
    this.spill.renderOrder = 4;
    this.spill.frustumCulled = false;
    this.object.add(this.spill);
  }

  setPlate(train) {
    this.plate.set(train);
  }

  dispose() {
    this.object.removeFromParent();
    this.plate.dispose();
    this.spill?.geometry.dispose();
  }
}

let gwMat = null;
function gangwayMaterial() {
  return gwMat ||= toonCached({ color: "bellows", pattern: { type: "stripes", step: .07, width: .025, strength: .55, color: "fold" } });
}

function mergePlanes(list) {
  const pos = [], uv = [];
  for (const g of list) {
    const n = g.index ? g.toNonIndexed() : g;
    pos.push(...n.attributes.position.array);
    uv.push(...n.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
