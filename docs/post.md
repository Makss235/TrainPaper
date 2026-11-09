# Пост-обработка: стек эффектов

Финальная сборка кадра (`engine/render/composite.js`) — один полноэкранный проход: небо, звёзды и луна, сцена,
осадки, затем эффекты стека `engine.post` (`engine/render/post.js`). Включённые эффекты склеиваются в один шейдер:
каждый — функция GLSL `vec3 <type>(vec3 col, vec2 uv)`, вызываются по порядку `order`. Шейдер пересобирается только
при смене набора эффектов, параметры меняются через uniforms. Изменение параметра рисует только слой `"composite"`.

## Встроенные эффекты

| `type` | Что делает | Свойства | Порядок |
|---|---|---|---|
| `grade` | экспозиция, контраст, насыщенность, теплота | `exposure`, `contrast`, `saturation`, `warmth` | 10 |
| `outline` | контуры по глубине сцены — «рисунок тушью» | `amount`, `color`, `threshold`, `width`, `fade` | 15 |
| `vignette` | виньетка | `amount`, `color` | 20 |
| `posterize` | постеризация | `levels` | 30 |
| `bloom` | ореол ярких огней (ночью) | `amount`, `threshold`, `radius`, `night` | 40 |
| `lut` | цветокоррекция по таблице 3D LUT | `texture`, `amount` | 50 |
| `grain` | плёночное зерно (`animated` — живое, ~12 кадров сборки в секунду) | `amount`, `animated` | 900 |
| `dither` | дизеринг ±½ ступени 8 бит, всегда последний | `amount` | 1000 |

По умолчанию включены `grade`, `vignette`, `posterize`, `grain`, `dither` со значениями из `style.filters`
(прежний формат стиля работает) — кадр попиксельно совпадает с прежней сборкой.

## Из кода и из сцены

```js
engine.post.add("vignette", { amount: .3 });
engine.post.set("grade", { saturation: .8 });
engine.post.remove("grain");
engine.post.list();            // эффекты по порядку
```

```jsonc
// в файле сцены, рядом с "environment"
"post": [ { "type": "grade", "contrast": 1.05 }, { "type": "vignette", "amount": 0.24 },
          { "type": "bloom", "amount": 0.45 }, { "type": "lut", "texture": "img/lut/cine.png" } ]
```

Эффекты сцены действуют, пока она загружена: следующая сцена начинает с набора по умолчанию.
`{ "type": "grain", "enabled": false }` — убрать эффект.

## LUT

Таблица — PNG-полоса N² × N: 16 плиток 16×16 (256×16) или 32 плитки 32×32 (1024×32). В плитке по горизонтали —
красный, по вертикали (сверху вниз) — зелёный, номер плитки — синий. Примеры — `assets/img/lut/identity.png`
(без изменений), `cold.png`, `cine.png` («киношная»: бирюзовые тени, тёплые света). Путь — от папки `assets/`
(`new Engine({ paths: { assets } })`).

## Свой эффект — без правки файлов движка

```js
import { PostEffect, registerPostEffect } from "/engine/index.js";

class Sepia extends PostEffect {
  static type = "sepia";                 // это и имя функции GLSL
  static order = 50;
  static props = { amount: { type: "number", default: 1, min: 0, max: 1, doc: "Сила" } };
  static glsl = `
    uniform float uSepiaAmount;
    vec3 sepia(vec3 col, vec2 uv) {
      vec3 s = vec3(dot(col, vec3(.393, .769, .189)), dot(col, vec3(.349, .686, .168)), dot(col, vec3(.272, .534, .131)));
      return mix(col, s, uSepiaAmount);
    }`;
  uniforms(p) { return { uSepiaAmount: p.amount }; }
}
registerPostEffect(Sepia);
engine.post.add("sepia", { amount: .6 });
```

- В GLSL эффекта доступны `uRes` (размер буфера), `vUv`, `hash12()`, `gl_FragCoord`.
- `uniforms(props)` возвращает значения по именам: число, массив (станет vec2/3/4), текстура или готовый
  uniform-объект `{ value }` (общий с движком, например `engine.light.uLamps`).
- Многопроходный эффект объявляет `prepare({ renderer, scene, depth, camera, width, height, sceneChanged })` —
  свои буферы и проходы до сборки (так сделан `bloom`: яркие места в 1/4 разрешения, размытие в два прохода;
  считается заново, только когда перерисована сцена). Помощник полноэкранного прохода — `FullscreenPass`.
- Анимированный эффект объявляет `static fps`: пока он включён, сборка кадра рисуется с этой частотой (I3).
