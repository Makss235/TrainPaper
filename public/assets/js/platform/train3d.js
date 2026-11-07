// Поезд в 3D: вагоны ФПК с объёмным кузовом (скруглённая крыша, завал низа, торцы, переходы),
// впереди — электровоз. Ось z поезда направлена к голове: z = 0 — хвост последнего вагона.
import * as THREE from "three";
import { BODY_BOTTOM_M, CAR_L, H_M, PLATE_WINDOW, WINDOWS, WINDOW_V } from "../lib/coach.js";
import { MATERIALS } from "../lib/palette.js";
import {
  bellowsTexture, coachEndTexture, coachSideTextures, locoFrontTexture, locoSideTexture,
  paintPlate, PLATE_ASPECT, plateCanvas, radialTexture, spillTexture, canvasTexture,
} from "./textures.js";

export const CAR_LEN = CAR_L * H_M;                  // 25,5 м
export const CAR_GAP = .64;
export const CAR_PITCH = CAR_LEN + CAR_GAP;
export const HALF_W = 1.7;                           // полуширина кузова
const LOCO_LEN = 19.6;
const SIDE_TOP = BODY_BOTTOM_M + H_M;                // карниз крыши ≈ 4,17 м

// поперечный профиль половины кузова со стороны платформы: (x — от оси вагона, y — над рельсом)
const HALF_PROFILE = [
  [-1.6, BODY_BOTTOM_M], [-HALF_W, BODY_BOTTOM_M + .33], [-HALF_W, SIDE_TOP],
  [-1.67, SIDE_TOP + .1], [-1.55, SIDE_TOP + .19], [-1.25, SIDE_TOP + .26], [-.75, SIDE_TOP + .31], [0, SIDE_TOP + .33],
];
const SIDE_SEGMENTS = 2;                             // первые два отрезка профиля — боковина с ливреей

const lambert = (hex, extra = {}) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex), ...extra });

/**
 * Кузов: лента по поперечному профилю вдоль длины. Группа 0 — боковина со стороны платформы
 * (текстура ливреи, v — высота от низа кузова в долях vScale), группа 1 — крыша и дальняя сторона.
 */
function bodyGeometry(length, profile = HALF_PROFILE, sideSegments = SIDE_SEGMENTS, vBase = BODY_BOTTOM_M, vScale = H_M) {
  const full = [...profile, ...profile.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const pos = [], nor = [], uv = [], sideIdx = [], restIdx = [];
  for (let i = 0; i < full.length - 1; i++) {
    const [x0, y0] = full[i], [x1, y1] = full[i + 1];
    const tl = Math.hypot(x1 - x0, y1 - y0);
    const n = [-(y1 - y0) / tl, (x1 - x0) / tl];          // касательная, повёрнутая на 90°, — наружу
    const b = pos.length / 3;
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      for (const z of [0, length]) {
        pos.push(x, y, z);
        nor.push(n[0], n[1], 0);
        uv.push(z / length, (y - vBase) / vScale);
      }
    }
    (i < sideSegments ? sideIdx : restIdx).push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...sideIdx, ...restIdx]);
  geo.addGroup(0, sideIdx.length, 0);
  geo.addGroup(sideIdx.length, restIdx.length, 1);
  return geo;
}

/** Торец кузова по профилю. */
function endGeometry(profile = HALF_PROFILE) {
  const full = [...profile, ...profile.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const shape = new THREE.Shape(full.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape);
  const top = Math.max(...full.map(p => p[1]));
  const p = geo.attributes.position, uvs = [];
  for (let i = 0; i < p.count; i++) uvs.push((p.getX(i) + HALF_W) / (2 * HALF_W), (p.getY(i) - BODY_BOTTOM_M) / (top - BODY_BOTTOM_M));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

function addBox(group, mat, [x0, x1], [y0, y1], [z0, z1], { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast; m.receiveShadow = receive;
  group.add(m);
  return m;
}

/* ---------- общий набор материалов и геометрий ---------- */

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const side = coachSideTextures(768);
  const sideMat = new THREE.MeshLambertMaterial({
    map: side.map, emissiveMap: side.emissive, emissive: new THREE.Color("#ffcf86"), emissiveIntensity: 0,
  });
  const roofMat = lambert(MATERIALS.roof);
  const endMat = new THREE.MeshLambertMaterial({ map: coachEndTexture() });
  const bellowsMat = new THREE.MeshLambertMaterial({ map: bellowsTexture() });
  shared = {
    sideMat, roofMat, endMat, bellowsMat,
    underMat: lambert(MATERIALS.under), boxMat: lambert(MATERIALS.box), bogieMat: lambert("#2c2e31"),
    acMat: lambert(MATERIALS.roofbox), stepMat: lambert(MATERIALS.step),
    body: bodyGeometry(CAR_LEN), end: endGeometry(),
    spillMat: new THREE.MeshBasicMaterial({ map: spillTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    tailMat: new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(255,60,40,.9)"], [.4, "rgba(255,40,20,.35)"], [1, "rgba(255,20,10,0)"]]),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    headMat: new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(255,250,235,1)"], [.25, "rgba(255,240,210,.55)"], [1, "rgba(255,230,190,0)"]]),
      transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  };
  return shared;
}

/** Один вагон. rear — хвостовой: на нём табличка и хвостовые огни. */
function makeCar(rear) {
  const P = sharedParts();
  const car = new THREE.Group();
  const body = new THREE.Mesh(P.body, [P.sideMat, P.roofMat]);
  body.castShadow = body.receiveShadow = true;
  car.add(body);
  for (const [z, rot] of [[0, Math.PI], [CAR_LEN, 0]]) {
    const end = new THREE.Mesh(P.end, P.endMat);
    end.position.z = z; end.rotation.y = rot;
    end.castShadow = end.receiveShadow = true;
    car.add(end);
  }
  // рама, ящики, подножки, тележки, кондиционеры
  addBox(car, P.underMat, [-1.45, 1.45], [.58, BODY_BOTTOM_M + .02], [.4, CAR_LEN - .4]);
  for (const [z0, z1] of [[5.2, 6.8], [8.4, 11.6], [14, 16], [17.2, 19]]) addBox(car, P.boxMat, [-1.5, -1.0], [.5, .9], [z0, z1]);
  for (const zc of [2.9, CAR_LEN - 2.9]) {
    addBox(car, P.bogieMat, [-1.25, 1.25], [.32, .78], [zc - 1.35, zc + 1.35]);
    for (const dz of [-1.2, 1.2]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.475, .475, 2.9, 16), P.bogieMat);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(0, .475, zc + dz);
      car.add(wheel);
    }
  }
  for (const [z0, z1] of [[.3, 1.6], [CAR_LEN - 1.6, CAR_LEN - .3]]) addBox(car, P.stepMat, [-1.55, -1.2], [.7, BODY_BOTTOM_M], [z0, z1]);
  addBox(car, P.acMat, [-1.0, 1.0], [SIDE_TOP + .25, SIDE_TOP + .55], [1.4, 3.8]);
  addBox(car, P.acMat, [-.9, .9], [SIDE_TOP + .25, SIDE_TOP + .45], [CAR_LEN - 3.5, CAR_LEN - 1.4]);
  // ночной отсвет окон на платформе (рядом с бортом, у кромки)
  for (const [u0, u1] of WINDOWS) {
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(1.7, (u1 - u0) * H_M + 1.2), P.spillMat);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(-HALF_W - .22 - .85, 1.104, (u0 + u1) / 2 * H_M);   // на платформе, от кромки к центру
    car.add(spill);
  }
  if (rear) {
    // закрытый переход и хвостовой отсвет на пути позади поезда
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, .22), P.bellowsMat);
    b.position.set(0, 2.55, -.11); b.castShadow = true;
    car.add(b);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 10), P.tailMat);
    tail.rotation.x = -Math.PI / 2; tail.position.set(0, .03, -5);
    car.add(tail);
    car.userData.tail = tail;
  }
  return car;
}

/** Переход между вагонами. */
function makeBellows() {
  const P = sharedParts();
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, CAR_GAP + .1), P.bellowsMat);
  b.castShadow = b.receiveShadow = true;
  b.position.set(0, 2.55, 0);
  return b;
}

/** Электровоз: тот же профиль кузова, лобовая часть с окнами кабины и прожекторами. */
function makeLoco() {
  const P = sharedParts();
  const loco = new THREE.Group();
  const profile = [[-1.55, 1.0], [-1.6, 1.3], [-1.6, 4.0], [-1.5, 4.25], [-1.1, 4.42], [0, 4.5]];
  const sideMat = new THREE.MeshLambertMaterial({ map: locoSideTexture(LOCO_LEN, 3.0) });
  const body = new THREE.Mesh(bodyGeometry(LOCO_LEN, profile, 2, 1.0, 3.0), [sideMat, lambert("#5a5d61")]);
  body.castShadow = body.receiveShadow = true;
  loco.add(body);
  const front = new THREE.Mesh(endGeometry(profile), new THREE.MeshLambertMaterial({ map: locoFrontTexture() }));
  front.position.z = LOCO_LEN;
  loco.add(front);
  const rear = new THREE.Mesh(endGeometry(profile), lambert("#5a5d61"));
  rear.rotation.y = Math.PI;
  loco.add(rear);
  addBox(loco, P.underMat, [-1.4, 1.4], [.55, 1.02], [.5, LOCO_LEN - .5]);
  for (const zc of [4.2, LOCO_LEN - 4.2]) addBox(loco, P.bogieMat, [-1.3, 1.3], [.3, .85], [zc - 1.6, zc + 1.6]);
  addBox(loco, lambert("#3c3f43"), [-.9, .9], [4.45, 4.75], [5, 14]);           // оборудование на крыше
  // прожекторы: светят всегда, ночью заметнее
  for (const x of [-1.05, 1.05]) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.headMat.map, color: 0xfff4dc, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.set(x, 1.55, LOCO_LEN + .05); glow.scale.set(1.2, 1.2, 1);
    loco.add(glow);
    (loco.userData.lights ||= []).push(glow);
  }
  return loco;
}

/**
 * Состав из N вагонов и электровоза. setOffset(s) двигает его вдоль пути: хвост последнего вагона
 * находится в zRear + s. Возвращает объект управления.
 */
export function createTrain(scene, { cars = 6, trackX, zRear }) {
  const group = new THREE.Group();
  group.position.set(trackX, 0, zRear);
  const list = [];
  for (let k = 0; k < cars; k++) {
    const car = makeCar(k === 0);
    car.position.z = k * CAR_PITCH;
    group.add(car);
    list.push(car);
    if (k < cars - 1) {
      const b = makeBellows();
      b.position.z = k * CAR_PITCH + CAR_LEN + CAR_GAP / 2;
      group.add(b);
    }
  }
  const loco = makeLoco();
  loco.position.z = cars * CAR_PITCH;
  group.add(loco);
  scene.add(group);

  // маршрутная табличка в окне хвостового вагона
  const plate = plateCanvas();
  const plateTex = canvasTexture(plate);
  const [u0, u1] = WINDOWS[PLATE_WINDOW];
  const pw = (u1 - u0) * H_M * .9, ph = pw / PLATE_ASPECT;
  const plateMat = new THREE.MeshLambertMaterial({ map: plateTex, emissiveMap: plateTex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: .15,
    polygonOffset: true, polygonOffsetFactor: -2 });
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), plateMat);
  plateMesh.rotation.y = -Math.PI / 2;
  const vTop = WINDOW_V[0] + (WINDOW_V[1] - WINDOW_V[0]) * .72;
  plateMesh.position.set(-HALF_W - .006, BODY_BOTTOM_M + vTop * H_M - ph / 2, (u0 + u1) / 2 * H_M);
  plateMesh.receiveShadow = true;
  list[0].add(plateMesh);

  const length = cars * CAR_PITCH + LOCO_LEN;
  return {
    group, length,
    setOffset(s, present = true) {
      group.position.z = zRear + s;
      group.visible = present;
    },
    setPlate(train) {
      paintPlate(plate, train);
      plateTex.needsUpdate = true;
    },
    setNight(lamps) {
      const P = sharedParts();
      P.sideMat.emissiveIntensity = lamps * 1.05;
      P.spillMat.opacity = lamps * .38;
      P.tailMat.opacity = .12 + .88 * lamps;
      plateMat.emissiveIntensity = .12 + lamps * .55;
      for (const l of loco.userData.lights) l.material.opacity = .45 + .55 * lamps;
    },
  };
}
