// Встроенные компоненты движка — регистрируются при подключении движка.
// @ts-check
import { registerComponent } from "../core/component.js";
import { Backdrop } from "./backdrop.js";
import { Camera, CameraParallax } from "./camera.js";
import { GroundGlow } from "./ground-glow.js";
import { HtmlScreen } from "./html-screen.js";
import { Light, StripeShadow } from "./lighting.js";
import { Glow, Line, Model, Primitive, Sprite } from "./visual.js";

export const BUILTIN = [Primitive, Model, Sprite, Line, Glow, Light, StripeShadow, GroundGlow, Backdrop, Camera, CameraParallax, HtmlScreen];
for (const C of BUILTIN) registerComponent(/** @type {any} */ (C));

export { Backdrop, Camera, CameraParallax, Glow, GroundGlow, HtmlScreen, Light, Line, Model, Primitive, Sprite, StripeShadow };
