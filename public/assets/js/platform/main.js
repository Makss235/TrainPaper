// Вид «Платформа» в 3D (WebGL, three.js): стоим на платформе и смотрим вдоль пути.
// Справа — хвост поезда (дальний торец — конец поезда), дальше путь уходит к горизонту,
// слева над платформой — светодиодное табло. Солнце, тени, облака и ночное освещение — по времени
// суток выбранной станции; камера слегка поворачивается за курсором, небо — вместе со сценой.
import * as THREE from "three";
import { startApp } from "../lib/app.js";
import { clamp } from "../lib/color.js";
import { easeInQuad, easeOutQuad, Motion, swapper } from "../lib/motion.js";
import { noAnimation } from "../lib/settings.js";
import { initGrain } from "../lib/grain.js";
import { homography, updateBoard } from "./board.js";
import { createSky, skyDirection } from "./sky3d.js";
import { setAnisotropy } from "./textures.js";
import { createTrain } from "./train3d.js";
import { BOARD, buildWorld, TRACK } from "./world.js";

const $ = id => document.getElementById(id);
const VIEW_AZ = 250;                 // камера смотрит вдоль пути на запад-юго-запад
const EYE = 2.75;                    // глаза: 1,65 м над платформой высотой 1,1 м
const D_END = 7.2;                   // торец хвостового вагона в 7,2 м от глаз
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const srgb = (c, k = 1) => new THREE.Color().setRGB(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k, THREE.SRGBColorSpace);

/* ---------- рендерер, сцена, камера ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const canvas = renderer.domElement;
canvas.id = "gl";
$("poster").prepend(canvas);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());
initGrain();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xaabbcc, 90, 1500);
const camera = new THREE.PerspectiveCamera(50, 1, .3, 70000);
camera.rotation.order = "YXZ";

const hemi = new THREE.HemisphereLight(0xffffff, 0x777766, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0);
sun.castShadow = true;
const shadowSize = renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
sun.shadow.mapSize.set(shadowSize, shadowSize);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 400 });
sun.shadow.bias = -.0004;
sun.shadow.normalBias = .035;
sun.target.position.set(0, 1, -26);
scene.add(sun, sun.target);
const moonLight = new THREE.DirectionalLight(0x9fb4ff, 0);
scene.add(moonLight);

const world = buildWorld(scene);
const sky = createSky(scene);
const train = createTrain(scene, { cars: 6, trackX: TRACK, zRear: -D_END });

/* ---------- кадрирование: точка схода левее и выше центра, как на эскизе ---------- */

let view = null;
function layout() {
  const W = innerWidth, H = innerHeight, portrait = H > W;
  // фокусное расстояние в пикселях; на узком экране угол шире, чтобы табло и вагон помещались
  const f = portrait ? W * .74 : Math.max(W * .6, H * 1.02);
  const cx = W * (portrait ? .52 : .41), cy = H * (portrait ? .5 : .44);
  const fullW = 2 * Math.max(cx, W - cx), fullH = 2 * Math.max(cy, H - cy);
  renderer.setSize(W, H);
  camera.fov = 2 * Math.atan(fullH / 2 / f) / Math.PI * 180;
  camera.aspect = fullW / fullH;
  camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
  camera.userData.focal = f;
  camera.userData.pixelRatio = renderer.getPixelRatio();
  camera.updateProjectionMatrix();
  view = { W, H };
}
layout();
addEventListener("resize", layout);

/* ---------- табло: HTML натягивается на экран табло в 3D ---------- */

const corners = [[BOARD.x0 + .06, BOARD.y1 - .06], [BOARD.x1 - .06, BOARD.y1 - .06], [BOARD.x1 - .06, BOARD.y0 + .06], [BOARD.x0 + .06, BOARD.y0 + .06]]
  .map(([x, y]) => new THREE.Vector3(x, y, BOARD.z + .002));
const boardEl = $("board"), BOARD_H = Math.round(1200 * (BOARD.y1 - BOARD.y0 - .12) / (BOARD.x1 - BOARD.x0 - .12));
boardEl.style.height = `${BOARD_H}px`;
const tmp = new THREE.Vector3();
function placeBoard() {
  const pts = corners.map(c => {
    tmp.copy(c).project(camera);
    return [(tmp.x + 1) / 2 * view.W, (1 - tmp.y) / 2 * view.H];
  });
  boardEl.style.transform = homography(1200, BOARD_H, ...pts);
}

/* ---------- свет по времени суток ---------- */

let lastEnv = null;
function applyLight(env, celestial) {
  const t = performance.now() / 1000;
  const sunDir = sky.update(env, celestial, camera, VIEW_AZ, t);
  const alt = celestial.sun.altitude, day = clamp((alt + 4) / 14);
  // прямой свет солнца плавно нарастает после восхода и гаснет к закату — вместе с ним и тени
  // от −1,5° до +3,5° тени проявляются; в золотой час свет тёплый и сильный — длинные тени дают объём
  const direct = smoothstep(-1.5, 3.5, alt) * (.86 + .14 * smoothstep(8, 30, alt));
  sun.intensity = 3.1 * direct;
  sun.color.copy(srgb(env.sunColor.map((v, i) => v + (255 - v) * .35 * smoothstep(10, 35, alt))));
  sun.position.copy(sun.target.position).addScaledVector(sunDir.y > .01 ? sunDir : tmp.set(0, 1, 0), 160);
  // рассеянный свет неба: днём голубоватый, на закате тёплый, ночью тёмно-синий
  const skyCol = env.top.map((v, i) => v + (env.horizon[i] - v) * .55);
  // небесный свет делаем менее насыщенным, иначе платформа уходит в синеву
  const skyGray = (skyCol[0] + skyCol[1] + skyCol[2]) / 3;
  const night = clamp((-alt - 4) / 8);
  const skyLight = skyCol.map(v => Math.min(255, (v * .55 + skyGray * .45) * 1.1 + 22));
  // ночью небо над городом не чёрное: холодный рассеянный свет, чтобы читались формы
  hemi.color.copy(srgb(skyLight.map((v, i) => v + ([62, 78, 118][i] - v) * night)));
  hemi.groundColor.copy(srgb([150, 136, 116], .25 + .75 * day));
  const twilight = clamp((alt + 7) / 13);                 // сумерки ещё светлые
  hemi.intensity = .38 + .55 * twilight + .8 * day + .32 * night;
  // луна ночью даёт немного холодного света
  if (celestial.moon) {
    const md = skyDirection(celestial.moon.azimuth, Math.max(celestial.moon.altitude, 5), VIEW_AZ);
    moonLight.position.copy(sun.target.position).addScaledVector(md, 100);
    moonLight.intensity = .35 * celestial.moon.fraction * clamp((celestial.moon.altitude + 2) / 8) * clamp((-alt - 2) / 6);
  }
  scene.fog.color.copy(srgb(env.horizon, .92 + .08 * day));
  world.setNight(env.lamps, clamp((alt + 8) / 14));
  $("poster").style.setProperty("--lamps", env.lamps.toFixed(3));
  train.setNight(env.lamps);
  lastEnv = env;
}

/* ---------- поезд: прибытие из-за горизонта и отправление ---------- */

const motion = new Motion((offset, present) => train.setOffset(offset, present));
const state = { info: null, shown: null, list: [] };
const showTrain = swapper({
  motion,
  instant: () => noAnimation || document.hidden,
  firstInstant: true,
  // уходит хвостом мимо нас; приходит головой из-за горизонта и тормозит у платформы
  departDistance: () => D_END + 9,
  departMs: 9000, departEase: easeInQuad,
  arriveDistance: () => train.length + 260,
  arriveMs: 21000, arriveEase: easeOutQuad,
  pauseMs: 1800,
  show(item) {
    state.shown = item;
    train.setPlate(item?.train || null);
    updateBoard(Date.now(), item, state.list, state.info);
  },
});
document.fonts?.ready.then(() => train.setPlate(state.shown?.train || null));

/* ---------- камера за курсором и кадр ---------- */

let tx = 0, ty = 0, mx = 0, my = 0;
addEventListener("pointermove", e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; });
let started = false, lastSky = null;
(function frame() {
  mx += (tx - mx) * .05;
  my += (ty - my) * .05;
  // лёгкий поворот головы и полшага в сторону: настоящая перспектива, небо двигается вместе со сценой
  camera.position.set(mx * .09, EYE - my * .03, 0);
  camera.rotation.set(-my * .013, -mx * .024, 0);
  camera.updateMatrixWorld();
  if (lastEnv && lastSky) applyLight(lastEnv, lastSky);
  placeBoard();
  renderer.render(scene, camera);
  if (!started) { started = true; requestAnimationFrame(() => canvas.classList.add("ready")); }
  requestAnimationFrame(frame);
})();

startApp({
  name: "platform",
  sky(env, celestial) {
    lastSky = celestial;
    lastEnv = env;
  },
  env() {},
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    if (changed || stationChanged || !state.shown) return showTrain(current);
    state.shown = current;
    train.setPlate(current?.train || null);
  },
  tick(now) {
    updateBoard(now, state.shown, state.list, state.info);
  },
});
