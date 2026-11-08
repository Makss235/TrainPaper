// Встроенные компоненты движка — регистрируются при подключении движка.
// @ts-check
import { registerComponent } from "../core/component.js";
import { Camera, CameraParallax } from "./camera.js";
import { HtmlScreen } from "./html-screen.js";
import { Light, StripeShadow } from "./lighting.js";
import { Glow, Line, Model, Primitive, Sprite } from "./visual.js";

export const BUILTIN = [Primitive, Model, Sprite, Line, Glow, Light, StripeShadow, Camera, CameraParallax, HtmlScreen];
for (const C of BUILTIN) registerComponent(/** @type {any} */ (C));

export { Camera, CameraParallax, Glow, HtmlScreen, Light, Line, Model, Primitive, Sprite, StripeShadow };
