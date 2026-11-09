// Префабы и повторы — чистая обработка данных объектов (без three.js): проверяется `node --test`.
// @ts-check
import { clone, deepMerge, rng } from "./data.js";

/**
 * Префаб + данные экземпляра: поля экземпляра заменяют поля префаба, компоненты с тем же
 * type (и id, если указан) сливаются по свойствам, новые добавляются, { type, remove: true } — убирает.
 * @param {Record<string, any>} prefab
 * @param {Record<string, any>} inst
 */
export function applyPrefab(prefab, inst) {
  const { prefab: _p, components: instComps, children: instChildren, ...rest } = inst;
  void _p;
  const out = { ...clone(prefab), ...clone(rest) };
  const comps = clone(prefab.components || []);
  for (const c of instComps || []) {
    const i = comps.findIndex((/** @type {any} */ p) => p.type === c.type && (c.id === undefined || p.id === c.id));
    if (i >= 0) comps[i] = c.remove ? { ...comps[i], remove: true } : deepMerge(comps[i], c);
    else comps.push(clone(c));
  }
  out.components = comps;
  out.children = [...clone(prefab.children || []), ...clone(instChildren || [])];
  return out;
}

/**
 * Повтор: { count, step: [dx, dy, dz], rotate: [°], jitter: [x, y, z], scaleJitter, seed, name }
 * → count копий. jitter — случайный сдвиг ±, scaleJitter — случайный масштаб ±доля,
 * name — шаблон имени ("Фонарь {i}"), по умолчанию «Имя 1», «Имя 2»…
 * @param {Record<string, any>} od
 * @returns {Record<string, any>[]}
 */
export function expandRepeat(od) {
  const r = od.repeat;
  if (!r) return [od];
  const { repeat: _r, ...base } = od;
  void _r;
  const random = rng(r.seed ?? 1);
  const out = [];
  const pos = base.position || [0, 0, 0], rot = base.rotation || [0, 0, 0];
  const sc = typeof base.scale === "number" ? [base.scale, base.scale, base.scale] : base.scale || [1, 1, 1];
  for (let i = 0; i < (r.count ?? 1); i++) {
    const j = r.jitter || [0, 0, 0], step = r.step || [0, 0, 0], rotate = r.rotate || [0, 0, 0];
    const k = 1 + (r.scaleJitter || 0) * (random() * 2 - 1);
    const rr = r.randomRotate ? r.randomRotate.map((/** @type {number} */ a) => (random() * 2 - 1) * a) : [0, 0, 0];
    out.push({
      ...clone(base),
      name: (r.name || `${base.name || "Объект"} {i}`).replace("{i}", String(i + 1)),
      position: pos.map((/** @type {number} */ v, /** @type {number} */ a) => v + step[a] * i + (j[a] || 0) * (random() * 2 - 1)),
      rotation: rot.map((/** @type {number} */ v, /** @type {number} */ a) => v + rotate[a] * i + rr[a]),
      scale: sc.map((/** @type {number} */ v) => v * k),
    });
  }
  return out;
}
