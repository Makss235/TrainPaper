// Система камер. Камеры — обычные объекты сцены с компонентом Camera (ракурсы). Движок рисует
// одной THREE-камерой, а система ставит её в позу активной камеры: позиция и поворот объекта,
// объектив (фокусное, точка схода на экране), плюс поворот за курсором (компонент CameraParallax).
//
//   engine.cameras.use("Общий план")        — сразу
//   engine.cameras.use("Общий план", 2500)  — плавно за 2,5 с
//   engine.cameras.list()                    — все камеры сцены (для панели «Ракурс»)
// @ts-check
import * as THREE from "three";

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const DEFAULT_LENS = { fov: 0, focal: [.6, 1.02], center: [.5, .5], portrait: null, near: .3, far: 6000 };

export class CameraSystem {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;
    this.camera.rotation.order = "YXZ";
    /** @type {any[]} компоненты Camera в сцене */
    this.cameras = [];
    this.active = null;
    this.blend = null;
    this.pointer = [0, 0];
    this.smooth = [0, 0];
    this.size = [1, 1];
    /** свободная камера инструмента разработчика: { position, yaw, pitch } */
    this.free = null;
    this.pose = { position: [0, 2, 0], yaw: 0, pitch: 0, lens: DEFAULT_LENS };
  }

  register(cam) {
    if (!this.cameras.includes(cam)) this.cameras.push(cam);
    if (!this.active || cam.props.main) this.use(cam);
  }

  unregister(cam) {
    this.cameras = this.cameras.filter(c => c !== cam);
    if (this.active === cam) { this.active = null; if (this.cameras[0]) this.use(this.cameras[0]); }
  }

  /** Камеры сцены: [{ name, label, camera }] */
  list() {
    return this.cameras.map(c => ({ name: c.gameObject.name, label: c.props.label || c.gameObject.name, camera: c }));
  }

  /** Поза камеры-объекта: позиция, yaw/pitch (°), объектив. */
  #poseOf(cam) {
    const o = cam.object3D;
    o.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    o.matrixWorld.decompose(p, q, new THREE.Vector3());
    const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
    return { position: p.toArray(), yaw: e.y / DEG, pitch: e.x / DEG, roll: e.z / DEG, lens: { ...DEFAULT_LENS, ...cam.props }, cam };
  }

  /**
   * Сделать камеру активной: по имени объекта, подписи или компоненту.
   * @param {string | any} which
   * @param {number} [ms] длительность плавного перехода (0 — сразу)
   */
  use(which, ms = 0) {
    const cam = typeof which === "string" ? this.cameras.find(c => c.gameObject.name === which || c.props.label === which) : which;
    if (!cam) { console.warn(`Нет камеры «${which}». Есть: ${this.list().map(c => c.name).join(", ")}`); return; }
    const to = this.#poseOf(cam);
    if (ms > 0 && this.active) this.blend = { from: this.pose, to, t0: performance.now(), ms };
    else { this.pose = to; this.blend = null; this.layout(...this.size); }
    this.active = cam;
    this.engine.events.emit("cameraChanged", cam);
    this.animate();
  }

  setPointer(x, y) {
    this.pointer = [x, y];
    this.animate();
  }

  /** Запустить анимацию камеры (сама остановится, когда камера замрёт). */
  animate() {
    const loop = this.engine.loop;
    if (loop.has("camera")) return;
    loop.animate("camera", (now, dt) => {
      const moving = this.update(dt);
      this.engine.invalidate("scene", "sky");
      return moving;
    });
  }

  /** Объектив под размер экрана: фокусное и точка схода. */
  layout(W, H) {
    this.size = [W, H];
    const cam = this.camera, lens = this.pose.lens, portrait = H > W && lens.portrait;
    const focal = (portrait && lens.portrait.focal) || lens.focal;
    const center = (portrait && lens.portrait.center) || lens.center;
    const f = lens.fov ? H / 2 / Math.tan(lens.fov * DEG / 2) : Math.max(W * focal[0], H * focal[1]);
    const cx = W * center[0], cy = H * center[1];
    const fullW = 2 * Math.max(cx, W - cx), fullH = 2 * Math.max(cy, H - cy);
    cam.fov = 2 * Math.atan(fullH / 2 / f) / DEG;
    cam.aspect = fullW / fullH;
    cam.near = lens.near;
    cam.far = lens.far;
    cam.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
    cam.updateProjectionMatrix();
    cam.userData.focal = f;
    this.focal = f;
  }

  /** Шаг: dt — секунды. true — камера ещё движется. */
  update(dt) {
    const cam = this.camera;
    if (this.free) {
      cam.position.set(...this.free.position);
      cam.rotation.set(this.free.pitch * DEG, this.free.yaw * DEG, 0);
      cam.updateMatrixWorld();
      return false;
    }
    let moving = false;
    if (this.blend) {
      const { from, to, t0, ms } = this.blend;
      const k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
      this.pose = {
        position: from.position.map((v, i) => lerp(v, to.position[i], e)),
        yaw: lerp(from.yaw, to.yaw, e), pitch: lerp(from.pitch, to.pitch, e), roll: lerp(from.roll || 0, to.roll || 0, e),
        lens: k < .5 ? from.lens : to.lens, cam: to.cam,
      };
      if (k >= 1) { this.pose = to; this.blend = null; }
      this.layout(...this.size);
      moving = true;
    } else if (this.active && this.active.object3D.userData.moved) {
      this.pose = this.#poseOf(this.active);
      this.active.object3D.userData.moved = false;
    }
    // поворот за курсором — если на камере есть CameraParallax
    const par = this.pose.cam?.gameObject.getComponent("CameraParallax");
    const P = this.pose;
    let px = 0, py = 0, tx = 0, ty = 0;
    if (par && par.enabled) {
      const a = 1 - Math.exp(-dt * par.props.ease);
      for (let i = 0; i < 2; i++) {
        const d = this.pointer[i] - this.smooth[i];
        this.smooth[i] += d * a;
        if (Math.abs(d) > 4e-4) moving = true;
      }
      [px, py] = [this.smooth[0] * par.props.shift[0], -this.smooth[1] * par.props.shift[1]];
      [tx, ty] = [-this.smooth[0] * par.props.turn[0], -this.smooth[1] * par.props.turn[1]];
    }
    const yaw = P.yaw * DEG;
    cam.position.set(P.position[0] + Math.cos(yaw) * px, P.position[1] + py, P.position[2] - Math.sin(yaw) * px);
    cam.rotation.set((P.pitch + ty) * DEG, (P.yaw + tx) * DEG, (P.roll || 0) * DEG);
    cam.updateMatrixWorld();
    return moving;
  }

  /** Поза текущей камеры как данные для файла сцены (инструмент разработчика). */
  snapshot() {
    const c = this.camera, r = v => Math.round(v * 100) / 100;
    return { position: c.position.toArray().map(r), rotation: [r(c.rotation.x / DEG), r(c.rotation.y / DEG), 0] };
  }
}
