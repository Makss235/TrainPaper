# Движок

Небольшой 3D-движок на three.js r160 для «живых иллюстраций»: сцена из объектов с компонентами
(как в Unity, но проще), рисование только при изменениях, cel-стиль без шума, время суток по
координатам, погода и осадки в мире. Без сборки: обычные ES-модули. О проекте, в котором работает, ничего не знает.

```js
import { Engine } from "/engine/index.js";          // нужна importmap с "three"
const engine = new Engine({ container: document.getElementById("view"), paths: { models: "/models/", prefabs: "/prefabs/" } });
await engine.load("/scenes/main.jsonc");             // или объект { environment, objects: [...] }
engine.environment.setTime(new Date());
engine.weather.set("rain");
```

Пример без единого файла моделей — [`examples/minimal.html`](examples/minimal.html).

| | |
|---|---|
| `index.js` | публичный API — импортируйте всё отсюда |
| `core/` | Engine, Scene, GameObject, Component, цикл кадров, загрузка данных |
| `components/` | Primitive, Model, Sprite, Line, Glow, Light, StripeShadow, Camera, CameraParallax, HtmlScreen |
| `systems/` | камеры (ракурсы, переходы, параллакс) и свет фонарей |
| `assets/` | модели (JS и glTF), префабы, `kit` для построения моделей |
| `render/` | cel-шейдер и материалы, тени, тонкие линии, ореолы, сборка кадра, стиль, палитра |
| `environment/` | солнце и луна, небо и облака, погода, осадки |
| `dev/` | инспектор сцены (подключается отдельно) |

Документация (папка `docs/` репозитория):
[engine.md](../../docs/engine.md) — как устроен ·
[objects.md](../../docs/objects.md) — объекты и компоненты ·
[models.md](../../docs/models.md) — модели ·
[embedding.md](../../docs/embedding.md) — встраивание.
