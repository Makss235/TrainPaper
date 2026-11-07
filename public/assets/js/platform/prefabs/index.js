// Реестр префабов: тип объекта в описании сцены → функция, которая его строит.
//
//   objects: [{ type: "lamps", x: -3.56, from: -14, to: -330, step: 24 }, ...]
//
// Свой префаб: функция (params, ctx) — см. scene/context.js, что есть в ctx, — и регистрация:
//   import { registerPrefab } from "../prefabs/index.js";
//   registerPrefab("kiosk", (p, ctx) => { ctx.solid.box([p.x, p.x + 2], [1.1, 3.6], [p.z, p.z - 3], "wall"); });
// После этого { type: "kiosk", x: -3, z: -40 } можно ставить в любую сцену.
import { buildings } from "./buildings.js";
import { nature } from "./nature.js";
import { platform } from "./platform.js";
import { railway } from "./railway.js";

export const PREFABS = { ...nature, ...platform, ...railway, ...buildings };

export function registerPrefab(type, build) {
  PREFABS[type] = build;
}
