// Инспектор сцены — инструмент разработчика (как окна Hierarchy и Inspector в Unity, только проще).
// Подключается отдельно, в обычной работе его кода нет:
//   import("/engine/dev/inspector.js").then(m => m.startInspector(engine, { actions: { "Кнопка": () => … } }));
//
//  - дерево объектов сцены; щелчок — выбрать (объект обводится рамкой);
//  - трансформ и свойства компонентов выбранного объекта — правятся на лету (по схемам props компонентов);
//  - «Копировать объект» — JSON выбранного объекта для файла сцены; «Скачать сцену» — вся сцена в .jsonc;
//  - свободная камера: W A S D — вперёд/влево/назад/вправо, Q / E — вниз/вверх, Shift — быстрее,
//    мышь с зажатой левой кнопкой — поворот; «Камера в объект» — текущий вид как объект-камера (JSON);
//  - сетка 1 м / 10 м и оси (красная — x, синяя — z), счётчики кадров по слоям, вызовов и треугольников;
//  - время симуляции: момент, ускорение, пауза; бодрствующие update, переходы и таймеры;
//  - панели компонентов, у которых есть inspectorPanel() (состояние модулей приложения);
//  - свет: активные источники и карты теней, у выбранного источника — контур радиуса или конуса, «вкл./выкл.»;
//  - у компонента: кнопки static actions, у скрипта — «Перезагрузить скрипт» (правка файла видна без перезагрузки страницы).
// @ts-check
import * as THREE from "three";
import { getComponentClass, registerComponent } from "../core/component.js";

const CSS = `
.ei{position:absolute;z-index:40;left:10px;top:10px;bottom:10px;width:330px;display:flex;flex-direction:column;gap:6px;
  font:12px/1.35 ui-monospace,Consolas,monospace;color:#e6ebf2;pointer-events:none}
.ei>section{pointer-events:auto;background:rgba(12,16,26,.9);border-radius:10px;padding:8px 10px;overflow:auto}
.ei h4{margin:0 0 4px;font:600 12px/1.3 inherit;color:#ffb21e}
.ei button{margin:2px 3px 2px 0;padding:2px 7px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer}
.ei button.on{background:#e21a1a;border-color:#e21a1a}
.ei .tree{max-height:30vh}
.ei .row{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 4px;border-radius:4px}
.ei .row:hover{background:rgba(255,255,255,.08)} .ei .row.sel{background:rgba(226,26,26,.35)} .ei .row .t{color:#8a96a8}
.ei .props{flex:1}
.ei label{display:flex;gap:4px;align-items:center;margin:2px 0} .ei label>span{flex:0 0 92px;color:#aab4c4;overflow:hidden;text-overflow:ellipsis}
.ei input,.ei select,.ei textarea{min-width:0;flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:4px;color:inherit;font:inherit;padding:1px 4px}
.ei input[type=checkbox]{flex:0}
.ei textarea{height:3.6em;resize:vertical}
.ei .comp{margin-top:6px;border-top:1px solid rgba(255,255,255,.12);padding-top:4px}
.ei .doc{color:#8a96a8;margin:2px 0 4px}
.ei .kv{display:flex;justify-content:space-between;gap:6px} .ei .kv b{font-weight:400;color:#aab4c4}
.ei .list{max-height:18vh;overflow:auto}
`;

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter(c => c !== null && c !== undefined));
  return el;
};
const r3 = v => Math.round(v * 1000) / 1000;

export function startInspector(engine, { actions = {} } = {}) {
  document.head.append(h("style", {}, CSS));
  const root = h("div", { class: "ei" });
  engine.container.append(root);
  const status = h("div"), cams = h("div"), tree = h("section", { class: "tree" }), props = h("section", { class: "props" });
  const timeBox = h("section"), panelBox = h("section", { class: "list" });
  let selected = null, helper = null, grid = null;
  const keys = new Set();
  let dragging = false, last = null;

  const btn = (label, fn) => h("button", { onclick: e => { fn(e.target); engine.invalidate("scene", "sky"); } }, label);
  const top = h("section", {},
    h("h4", {}, "Сцена"), status,
    btn("Свободная камера", b => toggleFree(b)), btn("Сетка", b => toggleGrid(b)),
    btn("Камера в объект", () => copy(JSON.stringify(cameraObject(), null, 2), "Камера скопирована как объект")),
    btn("Скачать сцену", () => download()), btn("Кадр", () => engine.invalidate("scene", "sky", "shadow")),
    ...Object.entries(actions).map(([label, fn]) => btn(label, fn)),
    cams);
  root.append(top, timeBox, panelBox, tree, props);

  // ---------- счётчики ----------
  let lastFrames = 0, lastLayers = {};
  setInterval(() => {
    const s = engine.loop.stats, r = engine.renderer.info.render;
    const layers = Object.entries(s.layers).map(([k, v]) => `${k} ${v - (lastLayers[k] || 0)}`).join(", ");
    const L = engine.lights.stats;
    status.textContent = `${engine.scene.data?.name || "—"} · кадров/с ${s.frames - lastFrames}${layers ? ` (${layers})` : ""} · вызовов ${r.calls} · треуг. ${r.triangles}` +
      ` · свет ${L.active}/${L.total}, теней ${L.shadows + (engine.shadow.enabled ? 1 : 0)}`;
    lastFrames = s.frames; lastLayers = { ...s.layers };
    if (cams.dataset.n !== String(engine.cameras.cameras.length)) renderCams();
    renderTime();
    renderPanels();
  }, 1000);

  // ---------- время симуляции ----------
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => { const T = engine.time, d = new Date(ms + T.offsetAt(ms) * 60000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
  const timeLabel = h("div", { class: "kv" });
  timeBox.append(h("h4", {}, "Время"), timeLabel,
    ...[1, 10, 60, 1440].map(k => btn(`×${k}`, () => { engine.time.scale = k; renderTime(); })),
    btn("Пауза", () => { engine.time.paused ? engine.time.resume() : engine.time.pause(); renderTime(); }),
    btn("Сейчас", () => { engine.time.set(Date.now()); renderTime(); }),
    btn("+10 мин", () => { engine.time.set(engine.time.ms + 600000); renderTime(); }));
  function renderTime() {
    const T = engine.time, c = engine.scheduler.counts;
    timeLabel.replaceChildren(
      h("span", {}, `${clock(T.ms)} ${T.paused ? "⏸" : ""}×${T.scale}`),
      h("b", {}, `update ${c.updates} · переходов ${c.tweens} · таймеров ${T.pending}`));
  }
  engine.time.on("timeChanged", renderTime);

  // ---------- панели компонентов ----------
  // Компонент может показать своё состояние: метод inspectorPanel() → { title, rows: [[подпись, значение, объект?]] }.
  // Так модули приложения (например, своя игровая логика) видны в инспекторе, а движок о них не знает.
  function renderPanels() {
    const panels = [];
    engine.scene.root.traverse(go => {
      for (const c of go.components) if (typeof c.inspectorPanel === "function") {
        try { panels.push(c.inspectorPanel()); } catch (err) { console.warn(err); }
      }
    });
    if (!panels.length) { panelBox.style.display = "none"; return; }
    panelBox.style.display = "";
    const rows = [];
    for (const p of panels) {
      if (!p) continue;
      rows.push(h("h4", {}, p.title || "—"));
      if (!p.rows?.length) rows.push(h("div", { class: "doc" }, p.empty || "пусто"));
      for (const [label, value, target] of p.rows || []) {
        rows.push(h("div", { class: `kv${target ? " row" : ""}`, onclick: () => target && select(target) }, h("span", {}, label), h("b", {}, value ?? "")));
      }
    }
    panelBox.replaceChildren(...rows);
  }

  function renderCams() {
    cams.dataset.n = engine.cameras.cameras.length;
    cams.replaceChildren(h("div", { class: "doc" }, "Камеры:"), ...engine.cameras.list().map(c => btn(c.label, () => { engine.cameras.free = null; engine.cameras.use(c.name, 1500); })));
  }

  // ---------- дерево ----------
  function renderTree() {
    const rows = [];
    const walk = (go, depth) => {
      for (const c of go.children) {
        const types = c.components.map(x => x.type).join(", ");
        rows.push(h("div", { class: `row${c === selected ? " sel" : ""}`, style: `padding-left:${4 + depth * 12}px`, onclick: () => select(c) },
          c.active ? "" : "◌ ", c.name, " ", h("span", { class: "t" }, types)));
        walk(c, depth + 1);
      }
    };
    walk(engine.scene.root, 0);
    tree.replaceChildren(h("h4", {}, `Объекты (${rows.length})`), ...rows);
  }
  engine.on("sceneLoaded", () => { selected = null; renderTree(); renderProps(); });
  renderTree();

  // ---------- выбор и рамка ----------
  let lightHelper = null;
  function select(go) {
    selected = go;
    helper?.removeFromParent();
    helper = new THREE.BoxHelper(go.object3D, 0xffb21e);
    helper.userData.noBatch = true;
    engine.three.add(helper);
    drawLightHelper();
    renderTree();
    renderProps();
    engine.invalidate("scene");
  }

  /** Контур источника света выбранного объекта: радиус (окружность и вертикаль) или конус прожектора. */
  function drawLightHelper() {
    lightHelper?.removeFromParent();
    lightHelper = null;
    const lights = selected?.getComponents("Light") || [];
    if (!lights.length) return;
    const g = new THREE.Group();
    for (const l of lights) {
      const { position, direction } = l.world(), p = l.props, pts = [];
      const P = new THREE.Vector3(...position);
      if (p.kind === "spot") {
        const d = new THREE.Vector3(...direction), r = Math.tan(p.angle * Math.PI / 180) * p.range;
        const u = Math.abs(d.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const a = new THREE.Vector3().crossVectors(d, u).normalize(), b = new THREE.Vector3().crossVectors(d, a).normalize();
        const end = P.clone().addScaledVector(d, p.range);
        for (let i = 0; i < 32; i++) {
          const t0 = i / 32 * Math.PI * 2, t1 = (i + 1) / 32 * Math.PI * 2;
          const q0 = end.clone().addScaledVector(a, Math.cos(t0) * r).addScaledVector(b, Math.sin(t0) * r);
          const q1 = end.clone().addScaledVector(a, Math.cos(t1) * r).addScaledVector(b, Math.sin(t1) * r);
          pts.push(q0, q1);
          if (i % 8 === 0) pts.push(P, q0);
        }
      } else if (p.kind === "point") {
        for (let i = 0; i < 48; i++) {
          const t0 = i / 48 * Math.PI * 2, t1 = (i + 1) / 48 * Math.PI * 2;
          for (const [ax, ay] of [["x", "z"], ["x", "y"]]) {
            const q = (t) => { const v = P.clone(); v[ax] += Math.cos(t) * p.range; v[ay] += Math.sin(t) * p.range; return v; };
            pts.push(q(t0), q(t1));
          }
        }
      } else {
        pts.push(P, P.clone().addScaledVector(new THREE.Vector3(...direction), 6));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: l.level > 0 ? 0xffd27a : 0x6a7280, transparent: true, opacity: .8 })));
    }
    g.traverse(x => { x.userData.noBatch = true; });
    lightHelper = g;
    engine.three.add(g);
  }
  const refreshHelper = () => { if (helper && selected) { helper.setFromObject(selected.object3D); engine.invalidate("scene"); } };

  // ---------- свойства ----------
  function field(label, spec, value, onChange) {
    const t = spec.type;
    let input;
    if (t === "boolean") {
      input = h("input", { type: "checkbox", checked: !!value, onchange: e => onChange(e.target.checked) });
    } else if (t === "number") {
      input = h("input", { type: "number", step: "any", value: value ?? "", onchange: e => onChange(Number(e.target.value)) });
    } else if (t === "vec2" || t === "vec3") {
      if (value === null || value === undefined) {
        input = h("input", { placeholder: "null", onchange: e => onChange(e.target.value ? JSON.parse(e.target.value) : null) });
      } else {
        const v = [...value];
        input = h("span", { style: "display:flex;gap:3px;flex:1" }, ...v.map((x, i) => h("input", { type: "number", step: "any", value: x,
          onchange: e => { v[i] = Number(e.target.value); onChange([...v]); } })));
      }
    } else if (t === "ref" || t === "component") {
      // ссылка на объект/компонент — показываем и правим по имени
      const name = value == null ? "" : typeof value === "string" ? value : value.gameObject ? `${value.gameObject.name}#${value.type}` : value.name ?? "";
      input = h("input", { value: name, placeholder: t === "ref" ? "имя объекта" : "Объект#Компонент", onchange: e => onChange(e.target.value || null) });
    } else if (t === "enum") {
      input = h("select", { onchange: e => onChange(e.target.value) }, ...(spec.options || []).map(o => h("option", { value: o, selected: o === value }, o)));
    } else if (t === "object" || t === "array" || (t === "color" && Array.isArray(value))) {
      input = h("textarea", { onchange: e => { try { onChange(JSON.parse(e.target.value)); } catch (err) { alert(`Не JSON: ${err.message}`); } } }, JSON.stringify(value));
    } else {
      input = h("input", { value: value ?? "", onchange: e => onChange(e.target.value) });
    }
    return h("label", { title: spec.doc || "" }, h("span", {}, label), input);
  }

  /** Параметры модели (у компонента Model) — отдельными полями по схеме params из файла модели. */
  function modelParams(c) {
    const def = c.type === "Model" && c.props.model ? engine.assets.definitionSync(c.props.model) : null;
    if (!def?.params || !Object.keys(def.params).length) return [];
    const values = engine.assets.params(def, c.props.params);
    return [h("div", { class: "doc" }, `параметры модели «${def.name || c.props.model}»:`),
      ...Object.entries(def.params).map(([k, spec]) => field(`· ${k}`, spec, values[k], v => {
        c.set({ params: { ...c.props.params, [k]: v } });
        setTimeout(refreshHelper, 50);
      }))];
  }

  function renderProps() {
    if (!selected) { props.replaceChildren(h("h4", {}, "Свойства"), h("div", { class: "doc" }, "Выберите объект в списке")); return; }
    const go = selected, o = go.object3D, deg = 180 / Math.PI;
    const tr = [
      field("position", { type: "vec3" }, o.position.toArray().map(r3), v => { go.setPosition(...v); refreshHelper(); }),
      field("rotation", { type: "vec3" }, go.rotationDeg.map(r3), v => { go.setRotation(...v); go.object3D.userData.moved = true; refreshHelper(); }),
      field("scale", { type: "vec3" }, o.scale.toArray().map(r3), v => { go.setScale(...v); refreshHelper(); }),
      field("active", { type: "boolean" }, go.active, v => { go.setActive(v); engine.scene.markDirty(go); renderTree(); }),
    ];
    void deg;
    const comps = go.components.map(c => {
      const C = getComponentClass(c.type) || c.constructor;
      const actions = Object.entries(C.actions || {}).filter(([, m]) => typeof c[m] === "function")
        .map(([label, m]) => btn(label, () => { try { c[m](); } catch (err) { console.error(err); } setTimeout(() => { renderProps(); drawLightHelper(); }, 50); }));
      if (c.type === "Light") actions.push(btn(c.level > 0 ? "Выкл." : "Вкл.", () => { (c.level > 0 ? c.turnOff(.4) : c.turnOn(.4)); setTimeout(() => { renderProps(); drawLightHelper(); }, 500); }));
      if (C.source) actions.push(btn("Перезагрузить скрипт", () => reloadScript(C)));
      return h("div", { class: "comp" },
        h("h4", {}, c.type, c.key ? h("span", { class: "t" }, ` #${c.key}`) : null, " ",
          h("input", { type: "checkbox", checked: c.enabled, title: "включён", onchange: e => { c.setEnabled(e.target.checked); engine.invalidate("scene", "shadow"); } })),
        C.doc ? h("div", { class: "doc" }, C.doc) : null,
        actions.length ? h("div", {}, ...actions) : null,
        ...Object.entries(C.props || {}).map(([k, spec]) => field(k, spec, c.props[k], v => { c.set({ [k]: v }); setTimeout(() => { refreshHelper(); drawLightHelper(); }, 50); })),
        ...modelParams(c));
    });
    props.replaceChildren(h("h4", {}, go.name),
      btn("Копировать объект", () => copy(JSON.stringify(go.toJSON(), null, 2), "Объект скопирован")),
      btn("Удалить", () => { go.destroy(); selected = null; helper?.removeFromParent(); renderTree(); renderProps(); }),
      ...tr, ...comps);
  }

  // ---------- горячая перезагрузка скрипта ----------
  /** Загрузить файл скрипта заново и заменить все его экземпляры в сцене (свойства сохраняются). */
  async function reloadScript(Old) {
    const type = Old.type, url = Old.source.split("?")[0];
    let mod;
    try {
      mod = await import(`${url}?v=${Date.now()}`);
    } catch (err) {
      console.error(`Скрипт «${type}» не перезагрузился:`, err);
      return;
    }
    const C = mod.default;
    C.source = url;
    registerComponent(C, type);
    let n = 0;
    for (const c of engine.scene.components(type)) {
      const go = c.gameObject, data = c.toJSON(), key = c.key;
      const { type: _t, id: _i, ...props } = data;
      go.removeComponent(c);
      const fresh = go.addComponent(C, props);
      if (key !== undefined) fresh.key = key;
      n++;
    }
    console.info(`Скрипт «${type}» перезагружен: ${n} экз.`);
    renderProps();
  }

  // ---------- буфер обмена и файл ----------
  function copy(text, note) {
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log(note, "\n", text);
  }
  function download() {
    const blob = new Blob([JSON.stringify(engine.scene.toJSON(), null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "scene.jsonc" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function cameraObject() {
    const s = engine.cameras.snapshot();
    const lens = engine.cameras.active?.props || {};
    return { name: "Новый ракурс", position: s.position, rotation: s.rotation,
      components: [{ type: "Camera", label: "Новый ракурс", focal: lens.focal, center: lens.center }, { type: "CameraParallax" }] };
  }

  // ---------- сетка ----------
  function toggleGrid(b) {
    if (grid) { grid.removeFromParent(); grid = null; b.classList.remove("on"); return; }
    grid = new THREE.Group();
    const g1 = new THREE.GridHelper(200, 200, 0x5a6a80, 0x8899aa); g1.position.y = .01;
    const g10 = new THREE.GridHelper(1000, 100, 0x223344, 0x445566); g10.position.y = .02;
    for (const m of [g1.material, g10.material]) { m.transparent = true; m.opacity = .55; }
    grid.add(g1, g10, new THREE.AxesHelper(6));
    grid.traverse(x => { x.userData.noBatch = true; });
    engine.three.add(grid);
    b.classList.add("on");
  }

  // ---------- свободная камера ----------
  function toggleFree(b) {
    const C = engine.cameras;
    if (C.free) { C.free = null; b.classList.remove("on"); C.update(0); return; }
    const c = engine.camera;
    C.free = { position: c.position.toArray(), yaw: c.rotation.y * 180 / Math.PI, pitch: c.rotation.x * 180 / Math.PI };
    b.classList.add("on");
  }
  addEventListener("keydown", e => { if (/** @type {HTMLElement} */ (e.target)?.closest?.(".ei")) return; keys.add(e.code); if (engine.cameras.free) fly(); });
  addEventListener("keyup", e => keys.delete(e.code));
  engine.canvas.addEventListener("pointerdown", e => { if (engine.cameras.free && e.button === 0) { dragging = true; last = [e.clientX, e.clientY]; } });
  addEventListener("pointerup", () => { dragging = false; });
  addEventListener("pointermove", e => {
    const f = engine.cameras.free;
    if (!dragging || !f) return;
    f.yaw -= (e.clientX - last[0]) * .15;
    f.pitch = Math.max(-85, Math.min(85, f.pitch - (e.clientY - last[1]) * .15));
    last = [e.clientX, e.clientY];
    fly();
  });
  function fly() {
    engine.loop.animate("inspector-fly", (now, dt) => {
      const f = engine.cameras.free;
      if (!f) return false;
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 30 : 6) * dt, yaw = f.yaw * Math.PI / 180;
      const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)], right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const m = (k, v, s) => { if (keys.has(k)) for (let i = 0; i < 3; i++) f.position[i] += v[i] * s; };
      m("KeyW", fwd, speed); m("KeyS", fwd, -speed); m("KeyD", right, speed); m("KeyA", right, -speed);
      if (keys.has("KeyE")) f.position[1] += speed;
      if (keys.has("KeyQ")) f.position[1] -= speed;
      engine.cameras.update(dt);
      engine.invalidate("scene", "sky");
      return keys.size > 0 || dragging;
    });
  }
  renderProps();
  console.info("Инспектор: свободная камера — WASD/QE + мышь; объекты — слева");
  return { select, refresh: renderTree };
}
