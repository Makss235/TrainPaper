# Скрипты, время и поведение

Как объектам сцены «жить»: часы симуляции, `update(dt)`, плавные переходы `tween()`, таймеры и корутины,
события, скрипты из файлов. Всё это не держит кадров в простое: движок рисует, только пока что-то
действительно меняется (инвариант I3).

| Что | Когда брать | Время |
|---|---|---|
| `update(dt)` | постоянное поведение (мигание, вращение, движение) | симуляции (`static realTime = true` — реальное) |
| `this.tween({...})` | разовый плавный переход с промисом | симуляции (`realTime: true` — реальное) |
| `this.wait / every / at / after / until` | таймеры и корутины «по расписанию» | симуляции |
| `engine.tween({...})` | переходы систем и интерфейса (камера, погода) | реальное |

Пример — на странице `public/engine/examples/minimal.html` (мигалка-скрипт, вертушка с `update`, кнопки ×1/×60/×1440).

---

## 1. Часы симуляции — `engine.time`

Время суток, расписание, движение поездов и таймеры скриптов идут по одним часам. Чисто визуальное —
облака, осадки, переходы камеры и погоды — по реальному времени.

```js
engine.time.now            // Date — момент симуляции
engine.time.ms             // то же в миллисекундах
engine.time.scale = 1440   // «сутки за минуту»: солнце, таймеры, поезда — в 1440 раз быстрее; облака — как обычно
engine.time.set(new Date("2026-11-08T05:30:00+03:00"))
engine.time.pause(); engine.time.resume();
engine.time.utcOffset = 180                  // часовой пояс для at("ЧЧ:ММ"), минуты к UTC (null — местный)
engine.time.on("timeChanged", ({ reason }) => { /* "set" | "scale" | "pause" | "resume" */ });
```

Часы не тикают сами: момент вычисляется по запросу, `sim = simBase + (realNow − realBase) × scale`.
Таймеры лежат в очереди по времени симуляции, и на ближайший ставится **один** настоящий `setTimeout`
(через `(due − sim) / scale`). Поэтому таймер «через 10 минут» в простое не рисует ни одного кадра.

В «Платформе» режимы времени суток управляют этими часами (`lib/app.js`): «сутки за минуту» — `scale = 1440`,
«рассвет», «день», «закат», «ночь» — плавный перевод часов к нужному моменту (дальше часы идут как обычно).

## 2. Компонент с `update(dt)`

```js
import { Component, registerComponent } from "../engine/index.js";

class Blinker extends Component {
  static type = "Blinker";
  static fps = 4;                       // не чаще 4 раз в секунду (по умолчанию — частота кадров)
  static order = 0;                     // порядок вызова среди компонентов (меньше — раньше)
  static props = { period: { type: "number", default: 1, min: .1, doc: "Период, с" } };
  t = 0;
  update(dt) {                          // dt — секунды симуляции
    this.t += dt;
    this.object3D.visible = this.t % this.props.period < this.props.period / 2;
    this.invalidate();                  // изменили object3D напрямую — попросить кадр
  }
}
registerComponent(Blinker);
```

- `update` вызывается, только если он объявлен в классе, компонент включён, объект активен и `start()` уже был.
- `this.sleep()` — перестать вызывать (стоящий поезд, погасший фонарь), `this.wake()` — снова. Выключение объекта
  или компонента и удаление усыпляют сами.
- Пока нет ни одного бодрствующего `update` и `tween`, цикл спит. На паузе часов `update` не вызывается
  (кроме `static realTime = true`).
- `setPosition`, `setRotation`, `moved()` сами просят кадр; если меняете `object3D` напрямую — `this.invalidate()`.

## 3. Плавные переходы — `tween`

```js
await this.tween({ from: 0, to: 1, duration: 2, ease: "inOutCubic", onUpdate: v => { this.object3D.scale.setScalar(v); this.invalidate(); } });
await this.tween({ from: [0, 0, 0], to: [5, 0, -3], duration: 1.5, realTime: true, onUpdate: p => this.gameObject.setPosition(...p) });
```

`ease`: `linear`, `inQuad`, `outQuad`, `inOutQuad`, `inCubic`, `outCubic`, `inOutCubic`, `smoothstep` (по умолчанию)
или своя функция. Переход снимается вместе с компонентом (промис отклоняется `CancelledError`, движок его не выводит).
Кадры рисуются, только пока переход идёт. `engine.tween({...})` — то же для кода вне компонентов (по реальному времени).

## 4. Таймеры и корутины

```js
async start() {
  await this.wait(30);                          // 30 с симуляции
  const stop = this.every(60, () => this.check());   // каждую минуту; stop() — снять
  this.at("14:05", () => this.depart());        // ближайшие 14:05 по часам (пояс engine.time.utcOffset)
  this.after(5, () => this.log("прошло 5 с"));
  await this.until("06:00");                    // корутина ждёт момента
}
```

- `async start()` разрешён; необработанная ошибка выводится с именем объекта и компонента.
- `this.signal` (`AbortSignal`) срабатывает при удалении компонента: все его таймеры снимаются, ожидания
  отклоняются `CancelledError` — цикл `while (true) { …; await this.wait(1); }` останавливается сам.
- Перевели часы (`time.set`) — `wait/every/after` сохраняют оставшееся время, `at/until` срабатывают, если их момент прошёл.
- `every` не «догоняет» пропущенные срабатывания, если часы ушли далеко вперёд — вызывается один раз.

## 5. События и поиск

```js
this.emit("doorOpened", { car: 3 });                     // событие своего объекта
this.emit("doorOpened", data, { bubble: true });         // поднимается к родителям
this.on("doorOpened", data => …);                        // своего объекта
this.on(otherObject, "built", train => …);               // другого объекта
this.on(this.engine, "sceneLoaded", () => …);            // движка
this.on(this.time, "timeChanged", e => …);               // часов
go.send("depart", 40);                                    // вызвать метод у всех компонентов объекта (SendMessage)

go.getComponent("Track"); go.getComponent(Track);        // по имени или классу
go.getComponentInParent("Train"); go.getComponentInChildren("Light"); go.getComponentsInChildren(Glow);
engine.scene.findComponent("TrainManager"); engine.scene.components("StopPoint");
```

Подписки через `this.on` снимаются сами при удалении компонента.

## 6. Скрипты из файлов

Пользовательский компонент — файл в `assets/scripts/`. Подключается по соглашению, как модель:
неизвестный `type` → замена из `assets/scripts/index.jsonc` → файл `assets/scripts/<type>.js`.
В `main.js` ничего прописывать не нужно.

```jsonc
{ "name": "Мигалка", "components": [ { "type": "examples/blink", "period": 0.8 } ] }
```

```js
// assets/scripts/examples/blink.js
import { Script } from "../../../engine/index.js";
export default class extends Script {
  static props = { period: { type: "number", default: 1, min: .1, doc: "Период, с" } };
  static actions = { "Мигнуть сейчас": "toggle" };        // кнопки в инспекторе
  async start() {
    while (true) { this.toggle(); await this.wait(this.props.period / 2); }
  }
  toggle() { this.gameObject.setActive(!this.gameObject.active); }
}
```

- Скрипты загружаются до создания объектов (`Scene.resolve` → `preload`), поэтому `instantiate` остаётся синхронным.
- Опечатка в `type` — одно понятное сообщение со списком похожих имён («Может быть: examples/blink?»);
  объект остаётся без этого компонента, сцена грузится.
- Путь к папке — `new Engine({ paths: { scripts: "/assets/scripts/" } })`.
- `Script` — тонкий наследник `Component`: категория «Скрипт» в инспекторе, `static type` — путь файла.

### Что есть у любого компонента

| | |
|---|---|
| `this.engine`, `this.gameObject`, `this.object3D`, `this.props`, `this.time` | движок, объект, трансформ, свойства, часы |
| `this.wait/until/after/every/at/tween` | время (см. выше) |
| `this.find(name)` | объект сцены по имени или пути «Платформа/Фонарь 3» |
| `await this.spawn(data \| "prefab", { parent, position, name })` | создать объект |
| `this.destroyObject(go)` | удалить объект (по умолчанию свой) |
| `this.on / emit` | события |
| `this.log / warn` | сообщение с именем объекта |
| `this.sleep / wake` | сон `update` |
| `this.set(patch)` | поменять свойства (проверка, `onChange`, кадр) |

## 7. Свойства-ссылки

```js
static props = {
  track: { type: "ref", default: null, doc: "Путь" },                                   // имя/путь объекта → GameObject
  stop:  { type: "component", component: "StopPoint", default: null },                   // "Платформа 1" или "Платформа 1#StopPoint"
};
start() { this.props.track.getComponent("Track"); }
```

Ссылки раскрываются перед `start()`; в `toJSON()` (копирование из инспектора) пишутся обратно именем.
Объекта нет — предупреждение и `null`.

## 8. Инспектор и горячая перезагрузка

`?dev=1` (или `startInspector(engine)`): у компонента — кнопки из `static actions`, у скрипта —
«Перезагрузить скрипт»: файл загружается заново (`import(url + "?v=…")`), все его экземпляры в сцене заменяются
с сохранением свойств — правка видна без перезагрузки страницы. Панель «Время» — момент, ускорение, пауза,
сколько бодрствует `update`, переходов и таймеров. Компонент может показать своё состояние в инспекторе:
метод `inspectorPanel()` → `{ title, rows: [[подпись, значение, объект?]] }`.
