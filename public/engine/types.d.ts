// Публичные типы движка — для подсказок в VS Code (проект без сборки: JS + JSDoc, D4).
//
// Модель:   /** @type {import("../../../engine/index.js").ModelDefinition} */
//           export default { name: "Фонарь", params: { … }, build(p, kit) { … } };     — подсказки по kit.*
// Скрипт:   export default class extends Script { … }                                  — this.props, this.engine.*, this.time
// Сцена:    /** @type {import("…/engine/index.js").SceneData} */ const data = { objects: [ … ] };
import type { createKit } from "./assets/kit.js";
import type { Component, PropSpec as ComponentPropSpec } from "./core/component.js";
import type { Engine } from "./core/engine.js";
import type { GameObject } from "./core/game-object.js";
import type { TweenOptions } from "./core/scheduler.js";

export type { Component, Engine, GameObject, TweenOptions };

/** Описание свойства компонента или параметра модели: проверка данных, инспектор, документация. */
export type PropSpec = ComponentPropSpec;

/** Набор для построения JS-моделей — второй аргумент build(params, kit) (engine/assets/kit.js). */
export type Kit = ReturnType<typeof createKit>;

/** JS-модель: модуль assets/models/<имя>.js экспортирует по умолчанию такое описание. */
export interface ModelDefinition<P extends Record<string, any> = Record<string, any>> {
  /** Имя для инспектора */
  name?: string;
  /** Параметры модели (как props компонента): значения приходят в build */
  params?: Record<string, PropSpec>;
  /** Данные для логики (размеры, точки огней) — объект или функция от параметров */
  meta?: Record<string, any> | ((params: P) => Record<string, any>);
  /** Построить геометрию: вернуть THREE.Object3D. Модель — только представление: без таймеров, событий, fetch (I4). */
  build(params: P, kit: Kit): any;
}

/** Компонент в данных объекта: { "type": "Light", "range": 11 }. */
export interface ComponentData {
  type: string;
  /** Метка, чтобы различать два компонента одного типа (и менять их в экземпляре префаба) */
  id?: string;
  /** В экземпляре префаба: убрать этот компонент */
  remove?: boolean;
  [prop: string]: any;
}

/** Повтор объекта со сдвигом (core/prefab.js expandRepeat). */
export interface RepeatData {
  count?: number;
  step?: number[];
  rotate?: number[];
  jitter?: number[];
  scaleJitter?: number;
  randomRotate?: number[];
  seed?: number;
  /** Шаблон имени: "Фонарь {i}" */
  name?: string;
}

/** Объект сцены в данных (JSONC). */
export interface ObjectData {
  name?: string;
  /** Префаб за основу: assets/prefabs/<имя>.jsonc */
  prefab?: string;
  /** Метры */
  position?: number[];
  /** Градусы, порядок YXZ */
  rotation?: number[];
  scale?: number | number[];
  tags?: string[];
  active?: boolean;
  /** Неподвижный: меши можно склеивать (по умолчанию да) */
  static?: boolean;
  components?: ComponentData[];
  children?: ObjectData[];
  repeat?: RepeatData;
}

/** Окружение сцены ("environment"). */
export interface EnvironmentData {
  /** Куда по компасу смотрит ось −z сцены, ° */
  azimuth?: number;
  /** [широта, долгота] */
  location?: [number, number];
  /** Погода по умолчанию (ключ пресета) и её сила 0…1,5 */
  weather?: string;
  weatherIntensity?: number;
  /** Область теней от солнца и их вид */
  shadows?: { x?: number[]; y?: number[]; z?: number[]; softness?: number; strength?: number };
  fog?: { near?: number; far?: number; max?: number };
  /** Множители к солнцу и рассеянному свету по времени суток */
  sun?: { intensity?: number; color?: string | number[] };
  ambient?: { intensity?: number; tint?: string | number[] };
  /** Своя таблица неба: [[высота солнца°, "#зенит", "#горизонт"], ...] */
  sky?: [number, string, string][];
}

/** Эффект пост-обработки в данных сцены ("post"). */
export interface PostEffectData {
  type: string;
  enabled?: boolean;
  [prop: string]: any;
}

/** Сцена (JSONC-файл или объект для engine.load). */
export interface SceneData {
  name?: string;
  environment?: EnvironmentData;
  post?: PostEffectData[];
  objects: ObjectData[];
}

/** События движка (engine.on(имя, fn)): имя → аргументы обработчика. */
export interface EngineEvents {
  sceneLoaded: [scene: Engine["scene"]];
  environment: [info: { env: any; celestial: any; light: any }];
  cameraChanged: [camera: Component];
  frame: [layers: Set<string>];
  contextRestored: [];
}

/** События часов (engine.time.on). */
export interface TimeEvents {
  timeChanged: [e: { reason: "set" | "scale" | "pause" | "resume"; ms: number; scale: number; paused: boolean; delta?: number }];
}
