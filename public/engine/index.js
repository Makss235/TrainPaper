// Публичный API движка. Подключение (нужна importmap с "three"):
//
//   <script type="importmap">{ "imports": { "three": "/vendor/three/three.module.min.js",
//                                            "three/addons/": "/vendor/three/addons/" } }</script>
//   import { Engine } from "/engine/index.js";
//   const engine = new Engine({ container: document.getElementById("view"), paths: { models: "/models/", prefabs: "/prefabs/" } });
//   await engine.load("/scenes/station.jsonc");
//
// Подробно — docs/engine.md. Типы для подсказок (модели, скрипты, сцены) — engine/types.d.ts:
//   /** @type {import("../../../engine/index.js").ModelDefinition} */ export default { … }
// @ts-check

/** @typedef {import("./types").ModelDefinition} ModelDefinition */
/** @typedef {import("./types").Kit} Kit */
/** @typedef {import("./types").PropSpec} PropSpec */
/** @typedef {import("./types").ObjectData} ObjectData */
/** @typedef {import("./types").ComponentData} ComponentData */
/** @typedef {import("./types").SceneData} SceneData */
/** @typedef {import("./types").EngineEvents} EngineEvents */
/** @typedef {import("./types").TimeEvents} TimeEvents */
import "./components/index.js";
import "./render/effects/index.js";

export { Engine } from "./core/engine.js";
export { Scene, applyPrefab, expandRepeat } from "./core/scene.js";
export { GameObject } from "./core/game-object.js";
export { Component, registerComponent, getComponentClass, componentTypes, resolveProps } from "./core/component.js";
export { Script } from "./core/script.js";
export { SimClock, CancelledError, isCancelled } from "./core/time.js";
export { Scheduler } from "./core/scheduler.js";
export { EASING, easing } from "./core/easing.js";
export { Emitter } from "./core/events.js";
export { parseJsonc, loadData, deepMerge, parseColor, rng } from "./core/data.js";
export * from "./components/index.js";
export { Palette, rgb } from "./render/palette.js";
export { LineBatch } from "./render/lines.js";
export { GlowBatch } from "./render/glows.js";
export { SHADOW_LAYER } from "./render/shadows.js";
export { SURFACE_LAYER, markSurfaces } from "./environment/precipitation.js";
export { applyVisualFlags } from "./components/visual.js";
export { homography } from "./components/html-screen.js";
export { WEATHER, WEATHER_LABELS, BASE as WEATHER_BASE, fromWmo, wmoIntensity, mixWeather } from "./environment/weather.js";
export { DEFAULT_QUALITY, DEFAULT_STYLE } from "./render/style.js";
export { PostEffect, PostStack, FullscreenPass, registerPostEffect, getPostEffectClass, postEffectTypes } from "./render/post.js";
export * as effects from "./render/effects/index.js";
export * as geometry from "./render/geometry.js";
