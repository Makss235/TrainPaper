// Сборка сцены по описанию: проходим по objects, для каждого зовём префаб по type,
// склеиваем мелкие детали, отдаём движку фонари, тени-узоры и область теней.
// Ошибка в одном объекте не роняет всю сцену — объект пропускается, ошибка пишется в консоль.
import { setLamps, setPatternShadows } from "../engine/light.js";
import { PREFABS } from "../prefabs/index.js";
import { SceneContext } from "./context.js";

export class World {
  constructor(def, ctx) {
    this.def = def;
    this.ctx = ctx;
    this.group = ctx.group;
    this.tracks = ctx.tracks;
    this.boardScreen = ctx.boardScreen;
  }

  /** Отдать движку освещение сцены: фонари ближе к камере и тени оград. */
  activate(engine) {
    setLamps(this.ctx.lamps, engine.rig.pose.position);
    setPatternShadows(this.ctx.patterns);
    engine.shadow.setRegion(this.def.shadows);
  }

  setStation(info) {
    this.ctx.setStation(info);
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}

export function buildScene(def, { invalidate } = {}) {
  const ctx = new SceneContext(def, { invalidate });
  for (const obj of def.objects) {
    const build = PREFABS[obj.type];
    if (!build) {
      console.warn(`Сцена «${def.name}»: неизвестный тип объекта «${obj.type}». Есть: ${Object.keys(PREFABS).join(", ")}`);
      continue;
    }
    try {
      const result = build(obj, ctx);
      if (result?.then) {
        result.catch(error => console.error(`Сцена «${def.name}», объект «${obj.type}»:`, error));
        ctx.pending.push(result);
      }
    } catch (error) {
      console.error(`Сцена «${def.name}», объект «${obj.type}»:`, error);
    }
  }
  ctx.finish();
  return new World(def, ctx);
}
