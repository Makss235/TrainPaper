// Окружение платформы в 3D. Метры; y — вверх (0 — головка рельса), камера смотрит вдоль −z.
import * as THREE from "three";
import { MATERIALS } from "../lib/palette.js";
import { fenceTexture, radialTexture, tactileTexture, tileTexture } from "./textures.js";

export const PLATFORM_TOP = 1.1;
export const EDGE = 2.5;
export const FENCE = -4.2;
export const TRACK = 4.42, TRACK2 = 9.7;
export const BOARD = { z: -6.3, x0: -3.2, x1: -.4, y0: 3.37, y1: 4.35, depth: .22 };   // y — над рельсом
const FAR = -1500;

const lambert = (hex, extra = {}) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex), ...extra });
const add = (parent, mesh, { cast = true, receive = true } = {}) => {
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
};
function box(parent, mat, [x0, x1], [y0, y1], [z0, z1], opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return add(parent, m, opts);
}
/** Горизонтальная полоса на высоте y (пол платформы, разметка). */
function strip(parent, mat, [x0, x1], y, [z0, z1], opts = { cast: false, receive: true }) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z0 - z1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  return add(parent, m, opts);
}
/** Много одинаковых коробок одной геометрией. */
function instanced(parent, geo, mat, matrices, { cast = true, receive = true, colors = null } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}
const at = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

function rng(seed) {
  return () => (seed = seed * 16807 % 2147483647) / 2147483647;
}

export function buildWorld(scene) {
  const W = new THREE.Group();
  scene.add(W);
  const glowMats = [];                                  // всё, что светится ночью: opacity ∝ фонарям
  const nightGlow = (tex, { peak = 1 } = {}) => {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    glowMats.push([m, peak]);
    return m;
  };

  // земля до горизонта
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), lambert(MATERIALS.ground));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -.32, -2500);
  add(W, ground, { cast: false });

  // платформа: тело, плитка, тактильная полоса, жёлтая линия, кромка
  box(W, lambert("#9fa09b"), [FENCE - .2, EDGE], [-.32, PLATFORM_TOP], [6, FAR], { cast: false });
  const tiles = tileTexture();
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  tiles.repeat.set((1.7 - FENCE) / 1.2, 1506 / 1.2);
  strip(W, new THREE.MeshLambertMaterial({ map: tiles }), [FENCE, 1.7], PLATFORM_TOP + .002, [6, FAR]);
  strip(W, lambert(MATERIALS.yellow), [1.7, 1.85], PLATFORM_TOP + .003, [6, FAR]);
  const tactile = tactileTexture();
  tactile.wrapS = tactile.wrapT = THREE.RepeatWrapping;
  tactile.repeat.set(1, 1506 / .3);
  strip(W, new THREE.MeshLambertMaterial({ map: tactile }), [1.85, 2.25], PLATFORM_TOP + .003, [6, FAR]);
  box(W, lambert(MATERIALS.coping), [2.25, EDGE + .04], [PLATFORM_TOP - .12, PLATFORM_TOP + .006], [6, FAR], { cast: false });

  // пути: балласт, шпалы, рельсы
  const ballastMat = lambert(MATERIALS.ballast), railMat = lambert("#7d8287"), sleeperMat = lambert(MATERIALS.sleeper);
  const sleeperGeo = new THREE.BoxGeometry(2.7, .16, .26);
  for (const c of [TRACK, TRACK2]) {
    box(W, ballastMat, [c - 2.4, c + 2.4], [-.32, -.2], [6, FAR], { cast: false });
    const sleepers = [];
    for (let z = 5; z > -520; z -= .55) sleepers.push(at(c, -.24, z));
    instanced(W, sleeperGeo, sleeperMat, sleepers, { cast: false });
    for (const r of [c - .76, c + .76]) box(W, railMat, [r - .037, r + .037], [-.16, 0], [6, FAR], { cast: false });
  }

  // ограда слева: стойки, перила, прутья; вдали — полупрозрачная текстура вместо тысяч прутьев
  const fenceMat = lambert(MATERIALS.fence);
  const posts = [], bars = [];
  for (let z = 4; z > -700; z -= 2.5) posts.push(at(FENCE, PLATFORM_TOP + .6, z));
  for (let z = 4; z > -160; z -= .14) bars.push(at(FENCE, PLATFORM_TOP + .55, z));
  instanced(W, new THREE.BoxGeometry(.06, 1.2, .06), fenceMat, posts);
  instanced(W, new THREE.BoxGeometry(.018, 1.1, .018), fenceMat, bars);
  for (const y of [PLATFORM_TOP + 1.12, PLATFORM_TOP + .12]) box(W, fenceMat, [FENCE - .025, FENCE + .025], [y - .025, y + .025], [5, FAR]);
  const farFence = fenceTexture();
  farFence.repeat.set(1300 / .56, 1);
  const ff = new THREE.Mesh(new THREE.PlaneGeometry(1340, 1.1), new THREE.MeshLambertMaterial({ map: farFence, transparent: true, alphaTest: .05, side: THREE.DoubleSide }));
  ff.rotation.y = Math.PI / 2; ff.position.set(FENCE, PLATFORM_TOP + .55, -160 - 670);
  add(W, ff, { cast: false });

  // фонари вдоль ограды; ночью — головы светятся, на полу пятна света
  const lampHead = lambert(MATERIALS.lamp, { emissive: new THREE.Color("#ffd98e"), emissiveIntensity: 0 });
  const poleMat = lambert(MATERIALS.post);
  const glowTex = radialTexture([[0, "rgba(255,246,220,1)"], [.18, "rgba(255,229,168,.75)"], [.5, "rgba(255,210,127,.2)"], [1, "rgba(255,207,122,0)"]]);
  const poolTex = radialTexture([[0, "rgba(255,226,166,.8)"], [.55, "rgba(255,213,144,.28)"], [1, "rgba(255,210,138,0)"]]);
  const lampGlowMat = nightGlow(glowTex), poolMat = nightGlow(poolTex, { peak: .85 });
  const lamps = [];
  const lampZ = [];
  for (let z = -14; z > -330; z -= 24) {
    lampZ.push(z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 5.2, 10), poleMat);
    pole.position.set(-3.56, PLATFORM_TOP + 2.6, z);
    add(W, pole);
    box(W, poleMat, [-3.56, -2.7], [PLATFORM_TOP + 5.08, PLATFORM_TOP + 5.16], [z - .04, z + .04]);
    box(W, lampHead, [-3.0, -2.35], [PLATFORM_TOP + 5.02, PLATFORM_TOP + 5.16], [z - .15, z + .15]);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
    glow.position.set(-2.67, PLATFORM_TOP + 4.98, z); glow.scale.set(3.4, 3.4, 1);
    W.add(glow);
    lamps.push(glow.material);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(-2.6, PLATFORM_TOP + .01, z);
    W.add(pool);
  }
  void lampGlowMat;

  // табло на раме: стойки, балка, корпус; ночью табло подсвечивает пол
  const B = BOARD, frameMat = lambert(MATERIALS.post), housingMat = lambert(MATERIALS.fence);
  for (const x of [B.x0 - .08, B.x1 - .06]) box(W, frameMat, [x, x + .14], [PLATFORM_TOP, B.y1 + .42], [B.z - .17, B.z - .03]);
  box(W, frameMat, [B.x0 - .2, B.x1 + .2], [B.y1 + .26, B.y1 + .42], [B.z - .2, B.z]);
  for (const x of [B.x0 + .3, B.x1 - .3]) box(W, frameMat, [x - .02, x + .02], [B.y1 + .04, B.y1 + .27], [B.z - .12, B.z - .08]);
  box(W, housingMat, [B.x0 - .05, B.x1 + .05], [B.y0 - .05, B.y1 + .05], [B.z - B.depth, B.z]);
  const boardPool = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.4), nightGlow(poolTex, { peak: .35 }));
  boardPool.rotation.x = -Math.PI / 2; boardPool.position.set((B.x0 + B.x1) / 2, PLATFORM_TOP + .012, B.z + 1.2);
  W.add(boardPool);

  // контактная сеть: опоры между путями, консоли, провода, портал
  const mastMat = lambert(MATERIALS.mast), wireMat = new THREE.LineBasicMaterial({ color: new THREE.Color(MATERIALS.wire) });
  const lineMats = [[wireMat, new THREE.Color(MATERIALS.wire)]];
  for (let z = -30; z > -900; z -= 55) {
    box(W, mastMat, [7.05, 7.35], [-.3, 8.6], [z - .15, z + .15]);
    for (const [x0, x1, y] of [[TRACK - .3, 7.2, 7.4], [TRACK, 7.2, 6.3], [7.2, TRACK2 + .3, 7.4], [7.2, TRACK2, 6.3]]) {
      box(W, mastMat, [Math.min(x0, x1), Math.max(x0, x1)], [y - .04, y + .04], [z - .04, z + .04], { cast: true, receive: false });
    }
  }
  const wirePts = [];
  for (const c of [TRACK, TRACK2]) {
    for (const y of [6.0, 7.4]) wirePts.push(new THREE.Vector3(c, y, 6), new THREE.Vector3(c, y, FAR));
    for (let z = 3; z > -450; z -= 6.5) wirePts.push(new THREE.Vector3(c, 7.4, z), new THREE.Vector3(c, 6.0, z));
  }
  W.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), wireMat));
  const zg = -62;
  for (const x of [-5.4, 13]) box(W, mastMat, [x - .22, x + .22], [-.3, 9.2], [zg - .22, zg + .22]);
  box(W, mastMat, [-5.6, 13.2], [8.7, 9.2], [zg - .2, zg + .2]);
  box(W, mastMat, [-5.6, 13.2], [7.75, 8.0], [zg - .15, zg + .15]);
  const lattice = [];
  for (let x = -5.4; x < 13; x += 1.2) {
    lattice.push(new THREE.Vector3(x, 8.0, zg), new THREE.Vector3(x + .6, 8.7, zg), new THREE.Vector3(x + .6, 8.7, zg), new THREE.Vector3(x + 1.2, 8.0, zg));
  }
  const latticeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(MATERIALS.mast) });
  lineMats.push([latticeMat, new THREE.Color(MATERIALS.mast)]);
  W.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lattice), latticeMat));

  // ряды деревьев за оградой и за вторым путём
  const random = rng(17);
  const crowns = [], trunks = [], tones = [];
  const greens = ["#4f6b58", "#5e7c62", "#6d8a75", "#566f50"].map(c => new THREE.Color(c));
  for (const [X, from, to, step] of [[-15, 30, 700, 9], [18, 25, 700, 11]]) {
    for (let d = from; d < to; d += step * (.8 + random() * .4)) {
      const x = X + (random() - .5) * 5, z = -d, r = 3 + random() * 2.2, h = 4 + random() * 3;
      trunks.push(at(x, h / 2 - .3, z, 1, h, 1));
      // крона — гроздь из нескольких шаров разного размера
      const tone = greens[Math.floor(random() * greens.length)];
      for (let q = 0; q < 4; q++) {
        const rr = r * (q ? .55 + random() * .3 : .85);
        crowns.push(at(x + (random() - .5) * r * 1.1, h + r * .5 + (q ? random() * r * .9 : 0), z + (random() - .5) * r * 1.1, rr, rr * 1.05, rr));
        tones.push(tone.clone().multiplyScalar(.88 + random() * .24));
      }
    }
  }
  instanced(W, new THREE.CylinderGeometry(.22, .3, 1, 6), lambert("#4a3b2e"), trunks, { cast: true, receive: false });
  instanced(W, new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns, { colors: tones });

  // пешеходный мост через пути вдали
  const bridgeMat = lambert(MATERIALS.farroof), zb = -165;
  for (const x of [-9, 15]) box(W, bridgeMat, [x - .8, x + .8], [-.3, 7.6], [zb - .8, zb + .8]);
  box(W, bridgeMat, [-40, 40], [7.2, 7.9], [zb - 1.4, zb + 1.4]);
  box(W, bridgeMat, [-40, 40], [9.8, 10.2], [zb - 1.4, zb + 1.4]);
  const truss = [];
  for (let x = -40; x < 40; x += 3) {
    for (const dz of [-1.35, 1.35]) truss.push(new THREE.Vector3(x, 7.9, zb + dz), new THREE.Vector3(x + 1.5, 9.8, zb + dz), new THREE.Vector3(x + 1.5, 9.8, zb + dz), new THREE.Vector3(x + 3, 7.9, zb + dz));
  }
  const trussMat = new THREE.LineBasicMaterial({ color: new THREE.Color(MATERIALS.farroof) });
  lineMats.push([trussMat, new THREE.Color(MATERIALS.farroof)]);
  W.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(truss), trussMat));

  // город у горизонта
  const blocks = [], blockTones = [];
  const cityTones = [MATERIALS.city, MATERIALS.city2, "#9aa5b1"].map(c => new THREE.Color(c));
  for (let i = 0; i < 160; i++) {
    const x = (random() - .5) * 2600, z = -900 - random() * 900, w = 20 + random() * 60, h = 12 + random() * 70;
    if (Math.abs(x) < 60) continue;
    blocks.push(at(x, h / 2, z, w, h, 20 + random() * 40));
    blockTones.push(cityTones[Math.floor(random() * cityTones.length)]);
  }
  instanced(W, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), blocks, { cast: false, receive: false, colors: blockTones });

  // у трёх ближайших фонарей — настоящий свет: освещает платформу и борт вагона
  const lampLights = lampZ.slice(0, 3).map(z => {
    const l = new THREE.PointLight(0xffd59a, 0, 34, 2);
    l.position.set(-2.67, PLATFORM_TOP + 4.85, z);
    W.add(l);
    return l;
  });

  return {
    group: W,
    setNight(k, light = 1) {
      lampHead.emissiveIntensity = k * 1.6;
      for (const m of lamps) m.opacity = k;
      for (const [m, peak] of glowMats) m.opacity = k * peak;
      for (const l of lampLights) l.intensity = k * 70;
      // линии (провода, фермы) не освещаются сами — темнеем их вместе с сумерками
      for (const [m, base] of lineMats) m.color.copy(base).multiplyScalar(.25 + .75 * light);
    },
  };
}
