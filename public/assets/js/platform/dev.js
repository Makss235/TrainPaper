// Инструмент разработчика сцены: /platform/?dev=1 (можно вместе с ?scene=murmansk).
// Загружается только с ?dev — в обычных обоях этого кода нет.
//
//  - свободная камера: W A S D — вперёд/влево/назад/вправо, Q / E — вниз/вверх, Shift — быстрее,
//    мышь с зажатой левой кнопкой — поворот головы;
//  - «Копировать ракурс» — кладёт в буфер обмена пресет { position, target, focal, center }
//    для cameras в файле сцены;
//  - «Сетка» — сетка 1 м / 10 м на уровне рельса и оси: красная — x (поперёк пути), синяя — z (вдоль);
//  - «Смена поезда» — текущий поезд уезжает и подходит снова (проверить анимацию прибытия);
//    «Транзит» — пустить по соседнему пути грузовой (или ?devtest=pass:путь:тип:направление);
//  - счётчики: сколько кадров нарисовано и каких слоёв, вызовы отрисовки и треугольники последнего кадра —
//    видно, что в простое кадры не рисуются вовсе.
import * as THREE from "three";
import { PassingTraffic } from "./trains/traffic.js";

export function startDev({ engine, state }) {
  const rig = engine.rig, loop = engine.loop;
  const panel = document.createElement("div");
  panel.className = "dev";
  document.getElementById("poster").append(panel);
  const keys = new Set();
  let grid = null, dragging = false, last = null;

  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { fn(b); loop.invalidate("scene", "sky"); };
    return b;
  };
  const info = document.createElement("pre");
  const status = document.createElement("div");
  const cams = document.createElement("div");
  panel.append(status, btn("Свободная камера", b => {
    if (rig.free) { rig.free = null; b.classList.remove("on"); rig.update(0); return; }
    const c = rig.camera;
    rig.free = { position: c.position.toArray(), yaw: c.rotation.y * 180 / Math.PI, pitch: c.rotation.x * 180 / Math.PI };
    b.classList.add("on");
    fly();
  }), btn("Копировать ракурс", () => {
    const text = JSON.stringify(rig.snapshot()).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ");
    navigator.clipboard?.writeText(text);
    console.log("ракурс:", text);
    info.textContent = `ракурс скопирован:\n${text}`;
  }), btn("Сетка", b => {
    if (grid) { grid.removeFromParent(); grid = null; b.classList.remove("on"); return; }
    grid = new THREE.Group();
    const g1 = new THREE.GridHelper(200, 200, 0x5a6a80, 0x8899aa); g1.position.y = .01;
    const g10 = new THREE.GridHelper(1000, 100, 0x223344, 0x445566); g10.position.y = .02;
    grid.add(g1, g10, new THREE.AxesHelper(6));
    for (const m of [g1.material, g10.material]) { m.transparent = true; m.opacity = .55; }
    engine.scene.add(grid);
    b.classList.add("on");
  }), btn("Кадр", () => loop.invalidate("scene", "sky", "shadow")),
  btn("Смена поезда", () => swap()), btn("Транзит", () => pass()), cams, info);

  function swap() {
    const b = state.board;
    if (!b) return;
    b.instant = () => false;
    b.first = false;
    b.show(b.current?.item ?? state.current ?? null);
  }
  function pass(track, type = "freight", heading = -1) {
    const tracks = [...state.world.tracks.keys()];
    const name = track || tracks.find(t => t !== state.board?.track?.name) || tracks[0];
    const t = new PassingTraffic({ engine, world: state.world, cfg: { track: name, type, heading, speed: 22, first: 0, every: [1e6, 1e6] } });
    t.start();
  }
  const test = new URLSearchParams(location.search).get("devtest");
  if (test === "swap") setTimeout(swap, 1500);
  else if (test?.startsWith("pass")) {
    const [, track, type, heading] = test.split(":");
    setTimeout(() => pass(track || undefined, type || "freight", Number(heading) || -1), 500);
  }

  const refreshCams = () => {
    cams.replaceChildren(...Object.keys(rig.presets).map(name => btn(name, () => { rig.free = null; rig.go(name, 1800); loop.animate("camera", (now, dt) => { loop.invalidate("scene", "sky"); return rig.update(dt); }); })));
  };
  refreshCams();

  // счётчики раз в секунду
  let lastFrames = 0, lastLayers = {};
  setInterval(() => {
    const s = loop.stats, r = engine.renderer.info.render;
    const perSec = s.frames - lastFrames;
    const layers = Object.entries(s.layers).map(([k, v]) => `${k} ${v - (lastLayers[k] || 0)}`).join(", ");
    lastFrames = s.frames;
    lastLayers = { ...s.layers };
    const c = rig.camera.position;
    status.innerHTML = `<b>${state.sceneDef?.name || "—"}</b> · ракурс ${rig.free ? "свободный" : rig.name}<br>` +
      `кадров/с: ${perSec}${layers ? ` (${layers})` : ""}<br>вызовов: ${r.calls}, треугольников: ${r.triangles}<br>` +
      `камера: ${[c.x, c.y, c.z].map(v => v.toFixed(2)).join(", ")}`;
    if (cams.childElementCount !== Object.keys(rig.presets).length) refreshCams();
  }, 1000);

  // свободная камера
  addEventListener("keydown", e => { keys.add(e.code); if (rig.free) fly(); });
  addEventListener("keyup", e => keys.delete(e.code));
  addEventListener("pointerdown", e => { if (rig.free && e.button === 0 && !e.target.closest(".dev, .ui")) { dragging = true; last = [e.clientX, e.clientY]; } });
  addEventListener("pointerup", () => { dragging = false; });
  addEventListener("pointermove", e => {
    if (!dragging || !rig.free) return;
    rig.free.yaw -= (e.clientX - last[0]) * .15;
    rig.free.pitch = Math.max(-85, Math.min(85, rig.free.pitch - (e.clientY - last[1]) * .15));
    last = [e.clientX, e.clientY];
    fly();
  });
  function fly() {
    loop.animate("fly", (now, dt) => {
      const f = rig.free;
      if (!f) return false;
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 30 : 6) * dt;
      const yaw = f.yaw * Math.PI / 180;
      const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)], right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const m = (k, v, s) => { if (keys.has(k)) for (let i = 0; i < 3; i++) f.position[i] += v[i] * s; };
      m("KeyW", fwd, speed); m("KeyS", fwd, -speed); m("KeyD", right, speed); m("KeyA", right, -speed);
      if (keys.has("KeyE")) f.position[1] += speed;
      if (keys.has("KeyQ")) f.position[1] -= speed;
      rig.update(dt);
      loop.invalidate("scene", "sky");
      return keys.size > 0 || dragging;
    });
  }
  console.info("TrainPaper dev: свободная камера — WASD/QE + мышь; window.trainpaper — движок и состояние");
}
