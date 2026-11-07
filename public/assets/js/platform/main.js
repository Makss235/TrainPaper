// Вид «Платформа»: стоим на платформе и смотрим вдоль пути. Справа — хвост поезда, путь уходит
// к горизонту, слева над платформой — светодиодное табло.
// Небо (купол, солнце, луна, облака) рисует WebGL — только небо, плоским фоном. Всё остальное —
// стилизованная 2D-графика на canvas со своей перспективой: плоские грани в 2–3 тона, тени по
// геометрии. Камера одна на обоих, поэтому за курсором небо и сцена двигаются вместе.
import * as THREE from "three";
import { startApp } from "../lib/app.js";
import { clamp } from "../lib/color.js";
import { initGrain } from "../lib/grain.js";
import { easeInQuad, easeOutQuad, Motion, swapper } from "../lib/motion.js";
import { noAnimation } from "../lib/settings.js";
import { homography, updateBoard } from "./board.js";
import { catenaryCasters, drawCatenary, drawGantry } from "./catenary.js";
import {
  BOARD, drawBoardFrame, drawBridge, drawFence, drawGround, drawLampGlows, drawLampHeads, drawLamps,
  drawPlatform, drawTrack, drawTrees, EDGE, FENCE, fenceShadow, floorShadow, PLATFORM_TOP, staticCasters, toSide, TRACK, TRACK2,
} from "./scene2d.js";
import { createSky } from "./sky3d.js";
import { drawTrain, drawWindowSpill, setPlate, SIDE_X, sideQuads, TRAIN_LENGTH, trainCasters } from "./train2d.js";
import { corners, hull, ShadowLayer, View } from "./view2d.js";

const $ = id => document.getElementById(id);
const VIEW_AZ = 250;                 // камера смотрит вдоль пути на запад-юго-запад
const EYE = 2.75;                    // глаза: 1,65 м над платформой высотой 1,1 м
const D_END = 7.2;                   // хвост поезда в 7,2 м от глаз
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ---------- небо: WebGL, только фон ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const glCanvas = renderer.domElement;
glCanvas.id = "gl";
const skyScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, .3, 70000);
camera.rotation.order = "YXZ";
const sky = createSky(skyScene);

/* ---------- сцена: canvas 2D ---------- */

const canvas = document.createElement("canvas");
canvas.id = "scene";
const ctx = canvas.getContext("2d");
$("poster").prepend(glCanvas, canvas);
initGrain();
const v = new View();
const shadows = { ground: new ShadowLayer(), train: new ShadowLayer(), floor: new ShadowLayer() };
const CASTERS = [...staticCasters(), ...catenaryCasters(corners)];
let dpr = 1, dirty = true, trainOffset = 0, trainPresent = false;

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
  camera.updateProjectionMatrix();
  camera.userData.focal = f;
  camera.userData.pixelRatio = renderer.getPixelRatio();
  dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  Object.assign(v, { f, cx, cy, W, H });
  for (const layer of Object.values(shadows)) layer.resize(W, H, dpr);
  dirty = true;
}

/* ---------- свет по времени суток ---------- */

let env = null, celestial = null, lightKey = "";
function computeLight(sunDir) {
  const alt = celestial.sun.altitude, day = clamp((alt + 4) / 14);
  // прямой свет солнца плавно нарастает после восхода и гаснет к закату — вместе с ним тени
  const direct = smoothstep(-1.5, 3.5, alt) * (.86 + .14 * smoothstep(8, 30, alt));
  const warm = env.sunColor.map(c => c / 255);
  const sunTint = warm.map(c => c + (1 - c) * .35 * smoothstep(10, 35, alt));
  const skyCol = env.top.map((c, i) => c + (env.horizon[i] - c) * .55);
  const gray = (skyCol[0] + skyCol[1] + skyCol[2]) / 3;
  const skyLight = skyCol.map(c => c * .5 + gray * .5 + 30);
  const peak = Math.max(...skyLight);
  const night = clamp((-alt - 4) / 8), twilight = clamp((alt + 7) / 13);
  const tint = skyLight.map((c, i) => (c / peak) * (1 - night) + [.55, .63, 1][i] * night);
  const ambI = .16 + .3 * twilight + .34 * day + .05 * night;
  Object.assign(v.light, {
    L: [sunDir.x, sunDir.y, sunDir.z],
    amb: tint.map(t => t * ambI),
    sun: sunTint.map(t => t * .74 * direct),
    fog: env.horizon.map(c => c * (.92 + .08 * day)),
    lamps: env.lamps, direct,
    reflect: .12 + .72 * day,
    skyTop: env.top, skyHorizon: env.horizon,
    plateLight: ambI * .6 + env.lamps * .55,
  });
}

/** Насколько темнеет освещённая поверхность в тени — по каналам. */
function shadowTone(n) {
  const { L, amb, sun } = v.light;
  const d = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  return amb.map((a, i) => a / (a + sun[i] * d + 1e-4));
}

/* ---------- тени ---------- */

function groundShadows() {
  const g = shadows.ground.begin(), L = v.light.L;
  g.fillStyle = "#000";
  for (const c of CASTERS) {
    floorShadow(v, g, c, L, -.2, EDGE + .3, 80);
    floorShadow(v, g, c, L, -.3, -90, FENCE - .2);
  }
  shadows.ground.apply(ctx, shadowTone([0, 1, 0]));
}

/** Тени на борту поезда: от табло, фонарей, ограды и деревьев слева — когда солнце со стороны платформы. */
function trainShadows(zRear) {
  const L = v.light.L;
  if (L[0] > -.02) return;
  const g = shadows.train.begin();
  g.fillStyle = "#000";
  for (const c of CASTERS) {
    if (c[0][0] > SIDE_X) continue;
    const flat = hull(c.map(p => { const q = toSide(p, L, SIDE_X); return [q[2], q[1]]; }));
    if (flat.length < 3) continue;
    g.beginPath();
    if (v.path(g, flat.map(([z, y]) => [SIDE_X, y, z]))) g.fill();
  }
  // только там, где есть борт
  g.globalCompositeOperation = "destination-in";
  g.beginPath();
  for (const q of sideQuads(zRear)) v.path(g, q);
  g.fill();
  shadows.train.apply(ctx, shadowTone([-1, 0, 0]));
}

function floorShadows(zRear) {
  const g = shadows.floor.begin(), L = v.light.L;
  g.fillStyle = "#000";
  g.strokeStyle = "#000";
  const list = trainPresent && L[0] > 0 ? [...CASTERS, ...trainCasters(zRear)] : CASTERS;
  for (const c of list) floorShadow(v, g, c, L, PLATFORM_TOP, FENCE, EDGE + .04);
  fenceShadow(v, g, L);
  shadows.floor.apply(ctx, shadowTone([0, 1, 0]));
}

/* ---------- кадр сцены ---------- */

function drawScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  const zRear = -D_END + trainOffset;
  const sunUp = v.light.direct > .003 && v.light.L[1] > .005;

  drawGround(v, ctx);
  drawBridge(v, ctx);
  drawTrees(v, ctx, "right");
  drawTrees(v, ctx, "left");
  drawTrack(v, ctx, TRACK2);
  drawTrack(v, ctx, TRACK);
  if (sunUp) groundShadows();
  drawCatenary(v, ctx);
  drawGantry(v, ctx);
  if (trainPresent) {
    drawTrain(v, ctx, zRear);
    if (sunUp) trainShadows(zRear);
  }
  drawPlatform(v, ctx);
  if (sunUp) floorShadows(zRear);
  drawLampGlows(v, ctx);
  if (trainPresent) drawWindowSpill(v, ctx, zRear);
  drawFence(v, ctx);
  drawLamps(v, ctx);
  drawLampHeads(v, ctx);
  drawBoardFrame(v, ctx);
  placeBoard();
}

/* ---------- табло: HTML натягивается на экран табло в перспективе ---------- */

const boardCorners = [[BOARD.x0 + .06, BOARD.y1 - .06], [BOARD.x1 - .06, BOARD.y1 - .06], [BOARD.x1 - .06, BOARD.y0 + .06], [BOARD.x0 + .06, BOARD.y0 + .06]]
  .map(([x, y]) => [x, y, BOARD.z + .002]);
const boardEl = $("board"), BOARD_H = Math.round(1200 * (BOARD.y1 - BOARD.y0 - .12) / (BOARD.x1 - BOARD.x0 - .12));
boardEl.style.height = `${BOARD_H}px`;
function placeBoard() {
  const pts = boardCorners.map(p => v.screen(p));
  if (pts.every(Boolean)) boardEl.style.transform = homography(1200, BOARD_H, ...pts);
}

/* ---------- поезд: прибытие из-за горизонта и отправление ---------- */

const motion = new Motion((offset, present) => {
  trainOffset = offset;
  trainPresent = present;
  dirty = true;
});
const state = { info: null, shown: null, list: [] };
const showTrain = swapper({
  motion,
  instant: () => noAnimation || document.hidden,
  firstInstant: true,
  // уходит хвостом мимо нас; приходит электровозом из-за горизонта и тормозит у платформы
  departDistance: () => D_END + 9,
  departMs: 9000, departEase: easeInQuad,
  arriveDistance: () => TRAIN_LENGTH + 260,
  arriveMs: 21000, arriveEase: easeOutQuad,
  pauseMs: 1800,
  show(item) {
    state.shown = item;
    setPlate(item?.train || null);
    updateBoard(Date.now(), item, state.list, state.info);
    dirty = true;
  },
});

/* ---------- камера за курсором и цикл кадров ---------- */

let tx = 0, ty = 0, mx = 0, my = 0, drawnKey = "", started = false;
addEventListener("pointermove", e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; });
addEventListener("resize", layout);
layout();

(function frame() {
  mx += (tx - mx) * .05;
  my += (ty - my) * .05;
  // лёгкий поворот головы и полшага в сторону: перспектива честная, небо двигается вместе со сценой
  camera.position.set(mx * .09, EYE - my * .03, 0);
  camera.rotation.set(-my * .013, -mx * .024, 0);
  camera.updateMatrixWorld();
  v.pos = [camera.position.x, camera.position.y, camera.position.z];
  v.yaw = camera.rotation.y;
  v.pitch = camera.rotation.x;
  v.update();
  if (env && celestial) {
    const sunDir = sky.update(env, celestial, camera, VIEW_AZ, performance.now() / 1000);
    computeLight(sunDir);
    renderer.render(skyScene, camera);
    // сцену перерисовываем, только когда что-то поменялось: камера, поезд или свет
    const key = `${v.pos.map(c => c.toFixed(4))}|${v.yaw.toFixed(5)}|${v.pitch.toFixed(5)}|${trainOffset.toFixed(3)}|${trainPresent}|${lightKey}|${v.W}x${v.H}`;
    if (dirty || key !== drawnKey) {
      drawScene();
      drawnKey = key;
      dirty = false;
    }
    if (!started) { started = true; requestAnimationFrame(() => $("poster").classList.add("ready")); }
  }
  requestAnimationFrame(frame);
})();

startApp({
  name: "platform",
  sky(e, c) {
    env = e;
    celestial = c;
    lightKey = `${c.sun.altitude.toFixed(2)}|${c.sun.azimuth.toFixed(1)}|${e.lamps.toFixed(3)}`;
    $("poster").style.setProperty("--lamps", e.lamps.toFixed(3));
  },
  env() {},
  train(current, list, board, info, { changed, stationChanged }) {
    state.info = info;
    state.list = list;
    if (changed || stationChanged || !state.shown) return showTrain(current);
    state.shown = current;
    setPlate(current?.train || null);
    dirty = true;
  },
  tick(now) {
    updateBoard(now, state.shown, state.list, state.info);
  },
});
