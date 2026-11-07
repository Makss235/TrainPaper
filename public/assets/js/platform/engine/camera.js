// Камера и ракурсы. Ракурс (пресет) задаётся в файле сцены станции:
//
//   cameras: {
//     main: {
//       position: [0, 2.75, 0],     // где глаза: x — поперёк пути, y — высота над рельсом, z — вдоль пути
//       target: [0, 2.75, -40],     // куда смотрим (или yaw/pitch в градусах: yaw > 0 — влево)
//       focal: [.6, 1.02],          // фокусное: f = max(ширина × .6, высота × 1.02) пикселей — кадр
//                                   //   одинаково собран на любом экране; или fov: 50 (верт. угол, °)
//       center: [.41, .44],         // где на экране точка, куда смотрим (доли ширины и высоты)
//       portrait: { focal: [.74, 0], center: [.52, .5] },   // поправки для вертикального экрана
//       parallax: { shift: [.09, .03], turn: [1.4, .75], ease: 3 },  // реакция на курсор
//     },
//     wide: { ... },
//   }
//
// rig.use("main") — сразу, rig.go("wide", 2500) — плавный переход за 2,5 с.
import * as THREE from "three";

const DEG = Math.PI / 180;
const DEFAULT = {
  position: [0, 2.75, 0], yaw: 0, pitch: 0, focal: [.6, 1.02], center: [.41, .44],
  portrait: { focal: [.74, 0], center: [.52, .5] },
  parallax: { shift: [.09, .03], turn: [1.4, .75], ease: 3 },
};

/** Пресет с недостающими полями по умолчанию; target → yaw/pitch. */
export function normalizePreset(p = {}) {
  const out = { ...DEFAULT, ...p, parallax: { ...DEFAULT.parallax, ...(p.parallax || {}) } };
  out.portrait = { ...DEFAULT.portrait, ...(p.portrait || {}) };
  if (p.target) {
    const [x, y, z] = out.position, [tx, ty, tz] = p.target;
    const dx = tx - x, dy = ty - y, dz = tz - z, len = Math.hypot(dx, dy, dz) || 1;
    out.yaw = Math.atan2(-dx, -dz) / DEG;
    out.pitch = Math.asin(dy / len) / DEG;
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    camera.rotation.order = "YXZ";
    this.presets = { main: normalizePreset() };
    this.name = "main";
    this.pose = this.#pose(this.presets.main);    // текущая базовая поза (без параллакса)
    this.transition = null;
    this.pointer = [0, 0];                        // курсор −1…1
    this.smooth = [0, 0];                         // сглаженный курсор
    this.size = [1, 1];
    this.free = null;                             // свободная камера инструмента разработчика
  }

  #pose(p) {
    return { position: [...p.position], yaw: p.yaw, pitch: p.pitch, roll: p.roll || 0, preset: p };
  }

  setPresets(presets) {
    this.presets = Object.fromEntries(Object.entries(presets || {}).map(([k, v]) => [k, normalizePreset(v)]));
    if (!this.presets.main) this.presets.main = normalizePreset();
  }

  /** Сразу встать в ракурс name. */
  use(name = "main") {
    this.name = this.presets[name] ? name : "main";
    this.pose = this.#pose(this.presets[this.name]);
    this.transition = null;
    this.layout(...this.size);
  }

  /** Плавно перейти в ракурс name за ms миллисекунд. */
  go(name, ms = 2500) {
    if (!this.presets[name]) return;
    this.transition = { from: this.pose, to: this.#pose(this.presets[name]), t0: performance.now(), ms };
    this.name = name;
  }

  setPointer(x, y) {
    this.pointer = [x, y];
  }

  /** Кадрирование под размер экрана: фокусное и точка схода. */
  layout(W, H) {
    this.size = [W, H];
    const cam = this.camera, p = this.pose.preset, portrait = H > W;
    const focal = portrait ? p.portrait.focal ?? p.focal : p.focal;
    const center = portrait ? p.portrait.center ?? p.center : p.center;
    const f = p.fov ? H / 2 / Math.tan(p.fov * DEG / 2) : Math.max(W * focal[0], H * focal[1]);
    const cx = W * center[0], cy = H * center[1];
    const fullW = 2 * Math.max(cx, W - cx), fullH = 2 * Math.max(cy, H - cy);
    cam.fov = 2 * Math.atan(fullH / 2 / f) / DEG;
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
    cam.updateProjectionMatrix();
    cam.userData.focal = f;
    this.focal = f;
  }

  /**
   * Шаг анимации: dt — секунды. Возвращает true, пока камера ещё движется
   * (курсор не догнан или идёт переход) — тогда нужно перерисовывать сцену.
   */
  update(dt) {
    const cam = this.camera;
    if (this.free) {
      cam.position.set(...this.free.position);
      cam.rotation.set(this.free.pitch * DEG, this.free.yaw * DEG, 0);
      cam.updateMatrixWorld();
      return false;
    }
    let moving = false;
    if (this.transition) {
      const { from, to, t0, ms } = this.transition;
      const k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
      this.pose = {
        position: from.position.map((v, i) => lerp(v, to.position[i], e)),
        yaw: lerp(from.yaw, to.yaw, e), pitch: lerp(from.pitch, to.pitch, e), roll: lerp(from.roll, to.roll, e),
        preset: k < .5 ? from.preset : to.preset,
      };
      if (k >= 1) { this.pose = to; this.transition = null; }
      this.layout(...this.size);
      moving = true;
    }
    const par = this.pose.preset.parallax;
    const a = 1 - Math.exp(-dt * par.ease);
    for (let i = 0; i < 2; i++) {
      const d = this.pointer[i] - this.smooth[i];
      this.smooth[i] += d * a;
      if (Math.abs(d) > 4e-4) moving = true;
    }
    const [mx, my] = this.smooth, P = this.pose;
    // лёгкий поворот головы и полшага в сторону: перспектива честная, небо двигается вместе со сценой
    const yaw = P.yaw * DEG, right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    cam.position.set(
      P.position[0] + right[0] * mx * par.shift[0],
      P.position[1] - my * par.shift[1],
      P.position[2] + right[2] * mx * par.shift[0]);
    cam.rotation.set((P.pitch - my * par.turn[1]) * DEG, (P.yaw - mx * par.turn[0]) * DEG, P.roll * DEG);
    cam.updateMatrixWorld();
    return moving;
  }

  /** Текущая поза как пресет для файла сцены (инструмент разработчика). */
  snapshot() {
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = v => Math.round(v * 100) / 100;
    const pos = cam.position.toArray().map(r);
    return {
      position: pos,
      target: pos.map((v, i) => r(v + dir.getComponent(i) * 40)),
      focal: this.pose.preset.focal, center: this.pose.preset.center,
    };
  }
}
