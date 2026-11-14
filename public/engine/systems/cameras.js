// Система камер. Камеры — обычные объекты сцены с компонентом Camera (ракурсы). Движок рисует
// одной THREE-камерой, а система ставит её в позу активной камеры: позиция и поворот объекта,
// объектив (фокусное, точка схода на экране), плюс движение за курсором (компонент CameraParallax).
// Объектив бывает перспективным и ортографическим (Camera.projection): второй — плоская картинка без перспективы,
// «2D». Между камерами одной проекции переход — пролёт; между перспективной и ортографической — растворение
// (engine.dissolve): прежний кадр тает поверх нового. Промежуточной «полуперспективы» нет — она только корёжит картинку.
//
//   engine.cameras.use("Общий план")        — сразу
//   engine.cameras.use("Общий план", 2500)  — плавно за 2,5 с
//   engine.cameras.list()                    — все камеры сцены (для панели «Ракурс»)
// @ts-check
import * as THREE from "three";

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
/** @type {Record<string, any>} */
const DEFAULT_LENS = { projection: "perspective", fov: 0, focal: [.6, 1.02], size: [16, 9], center: [.5, .5], portrait: null, near: .3, far: 6000 };
/** Сколько длится растворение между перспективной и ортографической камерами, мс (не дольше запрошенного перехода). */
const DISSOLVE_MS = 900;
const NO_PARALLAX = { shift: [0, 0], turn: [0, 0], layers: [0, 0], focus: 40, ease: 3 };
/** Плоский ли объектив (у перехода — как у его концов: они всегда одной проекции). @param {any} lens @returns {boolean} */
const isOrtho = lens => (lens.mix ? isOrtho(lens.mix[1]) : lens.projection === "orthographic");
/** Кратчайший поворот от угла a к b, ° (350 → 10 — это +20, а не −340). */
const turnTo = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

/** Поворот и сдвиг за курсором у камеры (нет компонента или он выключен — нули). @param {any} cam */
function parallaxOf(cam) {
  const par = cam?.gameObject?.getComponent("CameraParallax");
  return par && par.enabled ? { shift: par.props.shift, turn: par.props.turn, layers: par.props.layers, focus: par.props.focus, ease: par.props.ease } : NO_PARALLAX;
}

/**
 * Объектив под размер экрана:
 *   f — фокусное, пиксели (у ортографического — только для неба: каким объективом показать небосвод за плоской сценой);
 *   ppm — пикселей на метр (у ортографического); cx, cy — точка на экране, куда смотрит ось камеры.
 * Объектив посреди перехода — { mix: [a, b, e] } (оба — одной проекции): масштаб меняется плавно (в логарифме —
 * зум идёт ровно), точка схода и плоскости отсечения — линейно.
 * @param {any} lens @param {number} W @param {number} H
 * @returns {{f: number, ppm: number, cx: number, cy: number, near: number, far: number, ortho: boolean}}
 */
function resolveLens(lens, W, H) {
  if (lens.mix) {
    const [la, lb, e] = lens.mix, a = resolveLens(la, W, H), b = resolveLens(lb, W, H);
    const log = (/** @type {number} */ x, /** @type {number} */ y) => Math.exp(lerp(Math.log(x), Math.log(y), e));
    return { f: log(a.f, b.f), ppm: log(a.ppm, b.ppm), cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e),
      near: lerp(a.near, b.near, e), far: lerp(a.far, b.far, e), ortho: b.ortho };
  }
  const portrait = H > W && lens.portrait;
  const focal = (portrait && lens.portrait.focal) || lens.focal;
  const center = (portrait && lens.portrait.center) || lens.center;
  const size = (portrait && lens.portrait.size) || lens.size;
  const f = lens.fov ? H / 2 / Math.tan(lens.fov * DEG / 2) : Math.max(W * focal[0], H * focal[1]);
  // ортографический кадр вмещает не больше size[0] м по ширине и size[1] м по высоте — собран одинаково на любом экране
  return { f, ppm: Math.max(W / size[0], H / size[1]), cx: W * center[0], cy: H * center[1], near: lens.near, far: lens.far,
    ortho: lens.projection === "orthographic" };
}

/**
 * Матрица проекции объектива: перспективная (фокусное f, точка схода cx, cy) или ортографическая (ppm пикселей на метр).
 * @param {THREE.Matrix4} out @param {{f: number, ppm: number, cx: number, cy: number, near: number, far: number, ortho: boolean}} o
 * @param {number} W @param {number} H @param {boolean} [ortho]
 */
function projection(out, o, W, H, ortho = o.ortho) {
  const { f, ppm, cx, cy, near, far } = o, d = far - near;
  return ortho
    ? out.set(
      2 * ppm / W, 0, 0, 2 * cx / W - 1,
      0, 2 * ppm / H, 0, 1 - 2 * cy / H,
      0, 0, -2 / d, -(far + near) / d,
      0, 0, 0, 1)
    : out.set(
      2 * f / W, 0, 1 - 2 * cx / W, 0,
      0, 2 * f / H, 2 * cy / H - 1, 0,
      0, 0, -(far + near) / d, -2 * far * near / d,
      0, 0, -1, 0);
}

export class CameraSystem {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;
    this.camera.rotation.order = "YXZ";
    /** @type {any[]} компоненты Camera в сцене */
    this.cameras = [];
    this.active = null;
    /** @type {{from: any, to: any, e: number, k: number} | null} */
    this.blend = null;
    /** @type {AbortController | null} */
    this.blendAbort = null;
    this.pointer = [0, 0];
    this.smooth = [0, 0];
    this.size = [1, 1];
    /** свободная камера инструмента разработчика: { position, yaw, pitch } */
    this.free = null;
    /** @type {any} поза: позиция, углы (°), объектив и параллакс — у перехода всё это смешано из двух камер */
    this.pose = { position: [0, 2, 0], yaw: 0, pitch: 0, roll: 0, lens: DEFAULT_LENS, par: NO_PARALLAX };
    /** Проекция объектива без параллакса слоёв (его добавляет update) и проекция для лучей неба */
    this.baseProjection = new THREE.Matrix4();
    this.skyProjection = new THREE.Matrix4();
  }

  register(cam) {
    if (!this.cameras.includes(cam)) this.cameras.push(cam);
    if (!this.active || cam.props.main) this.use(cam);
  }

  unregister(cam) {
    this.cameras = this.cameras.filter(c => c !== cam);
    if (this.active !== cam) return;
    this.active = null;
    // переход к удалённой камере теряет смысл; поза остаётся прежней, пока не появится новая камера
    this.blendAbort?.abort();
    this.blendAbort = null;
    this.blend = null;
    // сцена удаляется целиком — замену искать незачем (её камеры тоже сейчас исчезнут)
    if (this.cameras[0] && !this.engine.scene.clearing) this.use(this.cameras[0]);
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
    return { position: p.toArray(), yaw: e.y / DEG, pitch: e.x / DEG, roll: e.z / DEG, lens: { ...DEFAULT_LENS, ...cam.props }, par: parallaxOf(cam), cam };
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
    const smooth = ms > 0 && this.active && this.engine.options.animate !== false;
    if (smooth && isOrtho(this.pose.lens) !== isOrtho(to.lens)) {
      // перспектива ↔ плоская картинка: пролёт между ними невозможен без уродливой «полуперспективы» —
      // камера переключается сразу, а кадр меняется растворением
      this.engine.dissolve(() => this.use(cam, 0), Math.min(ms, DISSOLVE_MS));
      return;
    }
    this.blendAbort?.abort();
    this.blendAbort = null;
    if (smooth) {
      // плавный переход — по реальному времени (engine.tween), поза считается в update(). Всё, что отличает
      // камеры, — место, поворот, объектив, параллакс — переходит плавно: ничего не переключается скачком.
      // Начало — текущая поза (и посреди другого перехода тоже): новый переход продолжает движение с того же места.
      const ac = (this.blendAbort = new AbortController());
      const blend = (this.blend = { from: this.pose, to, e: 0, k: 0 });
      this.engine.tween({ duration: ms / 1000, ease: "inOutCubic", signal: ac.signal,
        onUpdate: (/** @type {number} */ e, /** @type {number} */ k) => { if (this.blend === blend) { blend.e = e; blend.k = k; } this.animate(); } })
        .catch(() => {});
    } else { this.pose = to; this.blend = null; this.layout(...this.size); }
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
    const cam = this.camera, optics = resolveLens(this.pose.lens, W, H), { f, near, far } = optics;
    // матрица проекции собирается здесь целиком (перспективная или ортографическая);
    // camera.updateProjectionMatrix() движок не вызывает — он затёр бы её обычной перспективной
    projection(this.baseProjection, optics, W, H);
    this.#skew(0, 0, 0);
    // небу нужны направления лучей: у плоской картинки все лучи параллельны, поэтому небосвод за сценой
    // показывается перспективным объективом с тем же центром (фокусное f)
    cam.userData.skyProjectionInverse = projection(this.skyProjection, optics, W, H, false).invert();
    cam.userData.ortho = optics.ortho ? 1 : 0;
    cam.fov = 2 * Math.atan(H / 2 / f) / DEG;
    cam.aspect = W / H;
    cam.near = near;
    cam.far = far;
    cam.userData.focal = f;
    this.focal = f;
  }

  /**
   * Параллакс слоёв: проекция со сдвигом, растущим к зрителю, — предмет на глубине d смещается на k·(focus − d) метров.
   * Грани, обращённые к камере, при этом только сдвигаются (не поворачиваются и не сжимаются), как слои в 2D-параллаксе;
   * глубина focus и небо остаются на месте. В матрице это сдвиг столбцов: P' = P · S.
   * @param {number} kx @param {number} ky  смещение на метр глубины по горизонтали и вертикали (в осях камеры)
   * @param {number} focus  глубина, которая не двигается, м
   */
  #skew(kx, ky, focus) {
    const cam = this.camera, e = cam.projectionMatrix.copy(this.baseProjection).elements;
    if (kx || ky) {
      // в осях камеры (z = −глубина): x' = x + kx·(focus + z), y' = y + ky·(focus + z)
      for (let r = 0; r < 4; r++) {
        const k = kx * e[r] + ky * e[4 + r];
        e[8 + r] += k;
        e[12 + r] += focus * k;
      }
    }
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
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
      const { from, to, e, k } = this.blend;
      this.pose = {
        position: from.position.map((v, i) => lerp(v, to.position[i], e)),
        yaw: turnTo(from.yaw, to.yaw, e), pitch: lerp(from.pitch, to.pitch, e), roll: turnTo(from.roll || 0, to.roll || 0, e),
        lens: { mix: [from.lens, to.lens, e] },
        par: { shift: from.par.shift.map((v, i) => lerp(v, to.par.shift[i], e)), turn: from.par.turn.map((v, i) => lerp(v, to.par.turn[i], e)),
          layers: from.par.layers.map((v, i) => lerp(v, to.par.layers[i], e)), focus: lerp(from.par.focus, to.par.focus, e), ease: lerp(from.par.ease, to.par.ease, e) },
        cam: to.cam,
      };
      if (k >= 1) { this.pose = to; this.blend = null; }
      this.layout(...this.size);
      moving = true;
    } else {
      if (this.active && this.active.object3D.userData.moved) {
        this.pose = this.#poseOf(this.active);
        this.active.object3D.userData.moved = false;
      }
      if (this.pose.cam) this.pose.par = parallaxOf(this.pose.cam);        // CameraParallax могли включить или поменять на ходу
    }
    // движение за курсором (CameraParallax): сдвиг и поворот камеры, сдвиг слоёв; у перехода между камерами — смесь их настроек
    const P = this.pose, par = P.par;
    const active = par.shift[0] || par.shift[1] || par.turn[0] || par.turn[1] || par.layers[0] || par.layers[1];
    const a = 1 - Math.exp(-dt * par.ease);
    for (let i = 0; i < 2; i++) {
      const d = this.pointer[i] - this.smooth[i];
      this.smooth[i] += d * a;
      if (active && Math.abs(d) > 4e-4) moving = true;
    }
    const px = this.smooth[0] * par.shift[0], py = -this.smooth[1] * par.shift[1];
    const tx = -this.smooth[0] * par.turn[0], ty = -this.smooth[1] * par.turn[1];
    const yaw = P.yaw * DEG;
    cam.position.set(P.position[0] + Math.cos(yaw) * px, P.position[1] + py, P.position[2] - Math.sin(yaw) * px);
    cam.rotation.set((P.pitch + ty) * DEG, (P.yaw + tx) * DEG, (P.roll || 0) * DEG);
    cam.updateMatrixWorld();
    // курсор вправо — слои уходят влево, ближние сильнее; курсор вниз — слои вверх
    this.#skew(-this.smooth[0] * par.layers[0], this.smooth[1] * par.layers[1], par.focus);
    return moving;
  }

  /** Поза текущей камеры как данные для файла сцены (инструмент разработчика). */
  snapshot() {
    const c = this.camera, r = v => Math.round(v * 100) / 100;
    return { position: c.position.toArray().map(r), rotation: [r(c.rotation.x / DEG), r(c.rotation.y / DEG), 0] };
  }
}
