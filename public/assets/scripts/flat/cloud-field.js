// Поле облаков 2D-сцены: дочерние объекты (спрайты облаков) медленно плывут вдоль x и, дойдя до края поля,
// возвращаются с другой стороны; у краёв поля облако тает и проявляется (fade), поэтому поле может кончаться
// посреди кадра — например, чтобы облака не заходили под текст в углу.
//
// Облака привязаны к погоде движка (engine.weather):
//   - сколько их и какие: метка объекта говорит, при какой облачности облако появляется —
//     "light" — лёгкие, видны и в ясную погоду; "wisp" — перистые полоски, пока небо не затянуто;
//     "fair" — кучевые, при переменной облачности и больше;
//     "heavy" — тяжёлые, когда облачно, пасмурно, идут осадки. Чем облачнее, тем больше облаков каждого вида;
//   - цвет: в пасмурную погоду облака сереют, под дождём темнеют;
//   - скорость: по ветру погоды (в дождь плывут быстрее, в туман почти стоят);
//   - туман делает их бледнее.
// Облако появляется и исчезает плавно, а не выскакивает при смене погоды.
//
//   { "name": "Облака", "components": [{ "type": "flat/cloud-field", "speed": 0.1, "span": [-8, 46], "fade": 7 }],
//     "children": [ { "name": "Облако 1", "static": false, "tags": ["light"], "components": [{ "type": "Sprite", ... }] }, ... ] }
//
// Облака — по реальному времени (как облака движка): «сутки за минуту» их не разгоняют.
// @ts-check
import { Script } from "../../../engine/index.js";

const clamp = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** При какой облачности появляется первое и последнее облако каждого вида; третье число — при какой все они исчезают. */
const KINDS = { light: [-.1, .3, 9], wisp: [-.1, .2, .58], fair: [.22, .66, 9], heavy: [.56, .98, 9] };

export default class CloudField extends Script {
  static doc = "Облака-спрайты (дочерние объекты) плывут вдоль x; их число, цвет и скорость зависят от погоды.";
  static fps = 10;
  static realTime = true;
  static props = {
    speed: { type: "number", default: .1, doc: "Скорость при обычном ветре, м/с (знак — направление)" },
    span: { type: "vec2", default: [-40, 40], doc: "Откуда и докуда плывут (x, м): за краем облако переносится на другой" },
    fade: { type: "number", default: 0, min: 0, doc: "На скольких метрах у краёв поля облако тает и проявляется (0 — исчезает за краем кадра)" },
  };

  /** @type {{go: any, sprite: any, k: number, opacity: number, at: number, until: number, shown: number}[]} */
  clouds = [];

  start() {
    /** @type {Record<string, any[]>} */
    const byKind = { light: [], wisp: [], fair: [], heavy: [] };
    this.clouds = this.gameObject.children.map((go, i) => {
      const sprite = /** @type {any} */ (go.getComponent("Sprite"));
      const kind = /** @type {keyof typeof KINDS} */ (Object.keys(KINDS).find(k => go.tags.includes(k)) || "fair");
      // скорости почти равны — облака реже наезжают друг на друга; at — облачность, с которой облако видно (ставится ниже)
      const c = { go, sprite, k: .82 + .18 * ((i * 7) % 5) / 4, opacity: sprite?.props.opacity ?? 1, at: 0, until: 9, shown: -1 };
      byKind[kind].push(c);
      return c;
    });
    for (const [kind, list] of Object.entries(byKind)) {
      const [a, b, until] = KINDS[/** @type {keyof typeof KINDS} */ (kind)];
      list.forEach((c, i) => { c.at = a + (b - a) * (i + .5) / list.length; c.until = until; });
    }
    this.#apply(1e3);
  }

  /** Вид облаков под нынешнюю погоду. @param {number} dt */
  #apply(dt) {
    const w = this.engine.weather.state.current, [a, b] = this.props.span, f = this.props.fade;
    const cover = w.cover ?? .35, gray = w.cloudGray ?? 0, dark = w.cloudDark ?? 0;
    // пасмурно — серые, под дождём темнее; туман прячет облака в дымке
    const tone = 1 - .3 * gray - .22 * dark * gray, blue = 1 + .04 * gray;
    const haze = 1 - .55 * clamp(((w.fogMax ?? 0) - .04) / .03);
    const rate = Math.min(1, dt / 2.5);                               // появление и исчезновение — за пару секунд
    for (const c of this.clouds) {
      const want = cover >= c.at && cover < c.until ? 1 : 0;
      c.shown = c.shown < 0 ? want : c.shown + Math.sign(want - c.shown) * Math.min(Math.abs(want - c.shown), rate);
      const on = c.shown > .003;
      if (on !== c.go.active) c.go.setActive(on);
      if (!on) continue;
      const x = c.go.object3D.position.x;
      const edge = f > 0 ? smooth(0, 1, Math.min((x - a) / f, (b - x) / f)) : 1;
      c.sprite?.setOpacity(c.opacity * c.shown * edge * haze);
      c.sprite?.setColor([tone, tone, tone * blue]);
    }
  }

  /** @param {number} dt */
  update(dt) {
    const w = this.engine.weather.state.current, [a, b] = this.props.span, width = b - a;
    // ветер погоды: [скорость, порывы] м/с; обычный — около 5
    const wind = Math.max(.15, (Array.isArray(w.wind) ? w.wind[0] : 5) / 5);
    for (const c of this.clouds) {
      if (!c.go.active) continue;
      const p = c.go.object3D.position;
      p.x += this.props.speed * c.k * wind * dt;
      if (p.x > b) p.x -= width;
      if (p.x < a) p.x += width;
      c.go.object3D.updateMatrixWorld();
    }
    this.#apply(dt);
    this.engine.invalidate("scene");
  }
}
