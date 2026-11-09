# Как встроить движок в другой сайт

Движок (`public/engine/`) — обычные ES-модули без сборки. Единственная зависимость — three.js r160.
Он ничего не знает о TrainPaper: поезда, табло и РЖД — компоненты приложения, а не движка.

Рабочий пример — [`public/engine/examples/minimal.html`](../public/engine/examples/minimal.html):
сцена из примитивов прямо в коде, без папки моделей, с кнопками погоды и времени суток.
Откройте его через HTTP: `http://localhost:8000/engine/examples/minimal.html`.

## 1. Что скопировать

```
ваш-сайт/
├── engine/                 папка public/engine/ целиком (examples/ и dev/ — по желанию)
├── vendor/three/           three.module.min.js и addons/ (GLTFLoader нужен только для .glb)
├── models/                 ваши модели (необязательно)
├── prefabs/                ваши префабы (необязательно)
└── scenes/                 ваши сцены (или данные прямо в коде)
```

Сервер должен отдавать `.js` как `text/javascript`, а `.jsonc`, `.gltf`, `.glb` — с любым типом
(`application/json`, `model/gltf+json`, `model/gltf-binary`). Открывать страницы двойным щелчком
нельзя: ES-модули работают только по HTTP.

## 2. Подключение

```html
<div id="view" style="position: relative; height: 100vh"></div>

<script type="importmap">{ "imports": {
  "three": "/vendor/three/three.module.min.js",
  "three/addons/": "/vendor/three/addons/"
} }</script>
<script type="module">
  import { Engine } from "/engine/index.js";

  const engine = new Engine({
    container: document.getElementById("view"),            // холст заполнит контейнер целиком
    paths: { models: "/models/", prefabs: "/prefabs/", scripts: "/scripts/" },
  });
  await engine.load("/scenes/main.jsonc");                  // или объект { environment, objects }
  engine.environment.location = { lat: 55.75, lon: 37.62 };
  engine.environment.setTime(new Date());
</script>
```

Контейнеру нужен размер и `position: relative` (или `absolute`): холст встаёт в него с `position: absolute; inset: 0`.
При изменении размера окна движок подстраивается сам. Если контейнер меняет размер без изменения окна —
вызовите `engine.resize()`.

## 3. Параметры `new Engine({...})`

| Параметр | Что | По умолчанию |
|---|---|---|
| `container` | элемент, куда вставить холст | родитель `canvas` или `body` |
| `canvas` | готовый холст (тогда размер холста — ваша забота, движок его не удаляет) | создаётся сам |
| `paths.models` | папка моделей | `assets/models/` относительно страницы |
| `paths.prefabs` | папка префабов | `assets/prefabs/` |
| `paths.scripts` | папка скриптов (компоненты по соглашению, [scripts.md](scripts.md)) | `assets/scripts/` |
| `paths.assets` | корень содержимого: от него пути картинок, LUT, расписаний в данных сцены | над папкой моделей |
| `paths.manifest` | манифест моделей (адрес относительно папки моделей) или `null` — не загружать | `index.jsonc` |
| `paths.scriptsManifest` | замены имён скриптов (`index.jsonc` в папке скриптов) или `null` | `index.jsonc` |
| `palette` | именованные цвета `{ "brick": "#a5574a" }` | — |
| `quality` | качество и нагрузка (см. ниже) | `DEFAULT_QUALITY` |
| `style` | свет, дымка, фильтры (см. ниже) | `DEFAULT_STYLE` |
| `pointer` | камера поворачивается за курсором (`CameraParallax`) | `true` |
| `animate` | анимации; `false` — всё сразу и без движения (скриншоты, `prefers-reduced-motion`) | `true` |
| `batching` | склеивать неподвижные одинаковые меши | `true` |

### Качество (`quality`)

```js
new Engine({ quality: { pixelRatio: 1, msaa: 2, shadowSize: 1024, maxFps: 30, skyFps: 8 } })
```

| Ключ | Что | По умолчанию |
|---|---|---|
| `pixelRatio` | предел плотности пикселей (на 4K-экране хватает 1) | 1,5 |
| `msaa` | сглаживание краёв (0 — выкл.) | 4 |
| `skyScale` | разрешение неба относительно экрана | 0,5 |
| `shadowSize` | размер карты теней | 2048 |
| `maxFps` | потолок кадров, пока что-то движется | 60 |
| `skyFps` | как часто перерисовывать облака (0 — облака стоят) | 12 |
| `precipFps` | частота кадров осадков | 40 |
| `precipScale` | разрешение слоя осадков | 1 |
| `powerPreference` | какую видеокарту просить у браузера | `"low-power"` |

Для слабых устройств: `pixelRatio: 1, msaa: 0, shadowSize: 1024, skyFps: 6, precipFps: 24`.

### Стиль (`style`)

```js
new Engine({ style: {
  light: { sun: 0.8, ambient: { day: 0.3 } },          // сила солнца и рассеянного света
  fog: { near: 120, far: 2000 },                        // дымка
  filters: { vignette: 0, contrast: 1.08, warmth: 0.05, grain: 0.02, posterize: 0 },
} })
```

Полный список с пояснениями — `DEFAULT_STYLE` в `engine/render/style.js`. Объединяется глубоко:
указывайте только то, что меняете.

## 4. Сцена без файлов

Папки моделей и префабов не обязательны: сцену можно собрать только из встроенных компонентов
(`Primitive`, `Line`, `Light`, `Glow`, `Sprite`, `Camera`) прямо в коде — как в `minimal.html`.
Свои модели можно зарегистрировать из кода, без файлов:

```js
engine.assets.registerModel("kiosk", {
  params: { width: { type: "number", default: 2 } },
  build: (p, kit) => kit.group(
    kit.box([p.width, 2.4, 3], { pivot: "bottom", color: "#c9c2b3" }),
    kit.box([p.width + 0.3, 0.15, 3.3], { at: [0, 2.4, 0], color: "#5e646b" })),
});
await engine.instantiate({ name: "Киоск", position: [3, 0, -12], components: [{ type: "Model", model: "kiosk" }] });
```

## 5. Свои компоненты

Логику вашего сайта оформляйте компонентами — так она отделена от вида и описывается в данных сцены:

```js
import { Component, registerComponent } from "/engine/index.js";

class Spin extends Component {
  static type = "Spin";
  static props = { speed: { type: "number", default: 30, doc: "°/с" } };
  start() {
    this.animate((now, dt) => { this.object3D.rotation.y += this.props.speed * Math.PI / 180 * dt; this.gameObject.moved(); }, 30);
  }
}
registerComponent(Spin);
```

Объект, который движется, отметьте `"static": false` — его меши не будут склеиваться с соседними.
Подробно — [objects.md](objects.md#свой-компонент).

## 6. Управление из кода сайта

```js
engine.weather.set("snow");                                  // плавно за 4 с
engine.environment.setTime(Date.parse("2026-12-31T23:30:00"));
engine.environment.setSun({ azimuth: 230, altitude: -20 });  // или солнце вручную
engine.cameras.use("Общий", 2000);                           // ракурс из сцены
engine.find("Табло").setActive(false);
engine.on("frame", () => …);
```

HTML поверх сцены, привязанный к точке мира (подпись, метка): `engine.project([x, y, z])` даёт экранные
координаты; подпишитесь на `engine.on("frame", …)` и двигайте элемент. Живой HTML на плоскости в 3D —
компонент `HtmlScreen`.

## 7. Уход со страницы

```js
engine.dispose();        // остановить анимации, освободить видеопамять, убрать холст
```

Для одностраничных приложений вызывайте при уходе со страницы. Если браузер сбросил контекст WebGL
(редко, при нехватке видеопамяти), придёт событие `contextRestored` — проще всего перезагрузить
страницу или создать движок заново.

## 8. Что важно знать

- **Цвета — экранные (sRGB), как в CSS.** Движок выключает `THREE.ColorManagement` — это глобальная
  настройка three.js. Если на той же странице есть другой код на three.js, который рассчитывает на
  управление цветом, держите его в отдельной копии three.js или учитывайте это.
- **Реестр компонентов и эффектов — общий** для всех движков на странице (`registerComponent`, `registerPostEffect`).
  Палитра (`engine.palette`), пресеты погоды (`engine.weather.table`), таблица неба, часы (`engine.time`),
  материалы, свет, сцена, камеры — у каждого движка свои (пример — `engine/examples/two-engines.html`);
  два движка на одной странице работают, но каждый держит свой контекст WebGL — не больше 2–3 на страницу.
- Движок рисует **по требованию**: если вы меняете объекты three.js напрямую, вызовите
  `engine.invalidate("scene")` (или `gameObject.moved()`), иначе кадр не обновится.
- Солнце и луна (положение и фаза) считаются самим движком — внешние библиотеки не нужны.
- Инспектор (`engine/dev/inspector.js`) подключается отдельно и только когда нужен:
  `import("/engine/dev/inspector.js").then(m => m.startInspector(engine))`.

## 9. Типы и подсказки

Код размечен JSDoc, публичные типы — `engine/types.d.ts` (`ModelDefinition`, `Kit`, `ObjectData`, `SceneData`,
`EngineEvents`). В корне проекта лежит `jsconfig.json` (строгая проверка `strict`): VS Code подсказывает свойства
`Engine`, `GameObject`, `Component` и проверяет типы в файлах с `// @ts-check`; `npm run check` — то же из консоли.
Скопируйте его рядом с движком, если хотите того же в своём проекте.
