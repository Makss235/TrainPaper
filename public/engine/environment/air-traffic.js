// Самолёты в небе: время от времени высоко над сценой пролетает самолёт — маленькая светлая точка
// с тонким тающим шлейфом, ночью — мигающий огонёк. Рисуется в сборке кадра (render/composite.js) прямо на небе,
// поэтому работает при любой камере и стоит один недорогой проход, пока самолёт виден.
//
// Включается сценой: "environment": { "planes": true }  или  { "planes": { "every": [150, 420] } } — пауза между
// самолётами, секунды реального времени (случайно в диапазоне). Вручную: engine.environment.planes.launch().
//
// Самолёт летит по прямой на высоте ~10 км со скоростью ~240 м/с и проходит через ту часть неба, куда смотрит
// камера; шлейф — последние ~25 секунд пути. Всё в настоящих величинах, поэтому точка ползёт по небу неспешно,
// как настоящий самолёт на эшелоне.
// @ts-check
import * as THREE from "three";

const ALTITUDE = 10000, SPEED = 240, TRAIL_S = 26, FPS = 20;

export class AirTraffic {
  /** @param {import("../core/engine.js").Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** Пауза между самолётами [от, до], с; null — самолётов нет @type {number[] | null} */
    this.every = null;
    /** @type {{start: THREE.Vector3, velocity: THREE.Vector3, duration: number, t: number} | null} */
    this.flight = null;
    this.timer = 0;
    this.head = new THREE.Vector3();
    this.tail = new THREE.Vector3();
  }

  /** Настройка из данных сцены (environment.planes): true, { every: [от, до] } или false. @param {any} planes */
  configure(planes) {
    this.stop();
    this.every = planes ? (Array.isArray(planes.every) ? planes.every : [150, 420]) : null;
    // первый самолёт — пораньше, чтобы его не ждать по семь минут
    if (this.every) this.#schedule(.35);
  }

  /** @param {number} [k] доля обычной паузы */
  #schedule(k = 1) {
    clearTimeout(this.timer);
    if (!this.every || this.engine.options.animate === false) return;
    const [a, b] = this.every;
    this.timer = /** @type {any} */ (setTimeout(() => this.launch(), (a + Math.random() * (b - a)) * 1000 * k));
  }

  /** Пустить самолёт сейчас — через ту часть неба, куда смотрит камера. */
  launch() {
    const E = this.engine, U = E.composite.uniforms;
    if (this.flight) return;
    // куда смотрит камера по горизонтали
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(E.camera.quaternion).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    // точка наибольшего сближения: в 22–52° над горизонтом, немного в стороне от оси взгляда
    const elevation = (22 + Math.random() * 30) * Math.PI / 180, side = (Math.random() - .5) * .9;
    const distance = ALTITUDE / Math.tan(elevation);
    const closest = forward.clone().multiplyScalar(distance).addScaledVector(right, distance * side).setY(ALTITUDE);
    // курс — поперёк взгляда (слева направо или наоборот), с небольшим разворотом
    const turn = (Math.random() - .5) * 1.1, dir = Math.random() < .5 ? 1 : -1;
    const course = right.clone().multiplyScalar(dir * Math.cos(turn)).addScaledVector(forward, Math.sin(turn));
    const half = 30000;                                    // по 30 км в обе стороны от точки сближения
    this.flight = { start: closest.clone().addScaledVector(course, -half), velocity: course.multiplyScalar(SPEED), duration: 2 * half / SPEED, t: 0 };
    E.loop.animate("planes", (_now, dt) => this.#step(dt), FPS);
    void U;
  }

  /** @param {number} dt */
  #step(dt) {
    const E = this.engine, U = E.composite.uniforms, f = this.flight;
    if (!f) return false;
    f.t += dt;
    const done = f.t >= f.duration;
    this.head.copy(f.start).addScaledVector(f.velocity, f.t).normalize();
    this.tail.copy(f.start).addScaledVector(f.velocity, Math.max(0, f.t - TRAIL_S)).normalize();
    // появляется и исчезает плавно; у горизонта и в пасмурную погоду не виден
    const edge = Math.min(1, f.t / 6, (f.duration - f.t) / 6);
    const light = E.environment.light, w = E.weather.state.current;
    const visible = done ? 0 : Math.max(0, edge) * Math.min(1, Math.max(0, (this.head.y - .05) / .1)) * (1 - Math.min(1, (w.overcast ?? 0) * 1.3));
    const day = light?.day ?? 1, glow = E.environment.env?.glow ?? 0;
    U.uPlaneA.value.set(this.tail.x, this.tail.y, this.tail.z, .95 * Math.min(1, day * 1.6));     // w — сила шлейфа: ночью его не видно
    U.uPlaneB.value.set(this.head.x, this.head.y, this.head.z, visible);
    // днём шлейф белый, на закате — тёплый
    U.uPlaneColor.value.set(1, 1 - .22 * glow, 1 - .42 * glow);
    // ночной огонёк: короткая вспышка раз в 1,2 с
    U.uPlaneLight.value = (1 - Math.min(1, day * 1.6)) * (f.t % 1.2 < .14 ? 1 : .22);
    E.invalidate("composite");
    if (!done) return true;
    this.flight = null;
    this.#schedule();
    return false;
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.flight = null;
    this.engine.loop.stop("planes");
    this.engine.composite.uniforms.uPlaneB?.value.setW(0);
  }

  dispose() { this.stop(); this.every = null; }
}
