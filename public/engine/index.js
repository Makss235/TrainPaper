// Публичный API движка. Подключение (нужна importmap с "three"):
//
//   <script type="importmap">{ "imports": { "three": "/vendor/three/three.module.min.js",
//                                            "three/addons/": "/vendor/three/addons/" } }</script>
//   import { Engine } from "/engine/index.js";
//   const engine = new Engine({ container: document.getElementById("view"), paths: { models: "/models/", prefabs: "/prefabs/" } });
//   await engine.load("/scenes/station.jsonc");
//
// Подробно — docs/engine.md.
// @ts-check
import "./components/index.js";

export { Engine } from "./core/engine.js";
export { Scene, applyPrefab, expandRepeat } from "./core/scene.js";
export { GameObject } from "./core/game-object.js";
export { Component, registerComponent, getComponentClass, componentTypes } from "./core/component.js";
export { parseJsonc, loadData, deepMerge, parseColor, rng } from "./core/data.js";
export * from "./components/index.js";
export { definePalette, PALETTE, rgb } from "./render/palette.js";
export { LineBatch } from "./render/lines.js";
export { GlowBatch } from "./render/glows.js";
export { SHADOW_LAYER } from "./render/shadows.js";
export { SURFACE_LAYER, markSurfaces } from "./environment/precipitation.js";
export { applyVisualFlags } from "./components/visual.js";
export { homography } from "./components/html-screen.js";
export { WEATHER, WEATHER_LABELS, BASE as WEATHER_BASE, fromWmo } from "./environment/weather.js";
export { DEFAULT_QUALITY, DEFAULT_STYLE } from "./render/style.js";
export * as geometry from "./render/geometry.js";
