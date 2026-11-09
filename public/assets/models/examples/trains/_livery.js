// @ts-check
// Пример детальной модели (examples): ливрея на canvas. См. assets/models/index.jsonc → aliases.
// Ливреи — рисунок борта на canvas, который натягивается на кузов как текстура.
// Мелкие повторяющиеся детали (гофра, рёбра) сюда не рисуются: их делает шейдер узором без ряби.
// Окна в ливрее — только тёмный уплотнитель по контуру: само окно — проём в кузове со стеклом.
//
// Ливрея ФПК строится из тех же фигур lib/coach.js, что и вид «Вагон», — она одна на оба вида.
import * as THREE from "three";
import { CAR_L, coachShapes, RZD_LOGO } from "../../../shared/livery/coach-shapes.js";
import { MATERIALS } from "../../../shared/materials.js";

/** Холст ливреи: width × height пикселей; u, v (0…1) → пиксели. */
export function liveryCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Текстура из холста: с mip-уровнями и анизотропией — вдали не рябит. */
export function liveryTexture(canvas, anisotropy = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = anisotropy;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Логотип РЖД (официальный путь, viewBox 55,12 × 24,41) в точке x, y высотой h пикселей. */
export function drawLogo(g, x, y, h, color = MATERIALS.red) {
  const k = h / 24.41;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.fillStyle = color;
  g.fill(new Path2D(RZD_LOGO));
  g.restore();
}

/**
 * Ливрея пассажирского вагона ФПК по схеме окраски (фигуры lib/coach.js).
 * Холст охватывает u ∈ [0, CAR_L], v ∈ [0, 1] в единицах схемы (1 = высота боковины).
 */
export function paintFpk(canvas) {
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, ppu = W / CAR_L;
  const X = u => u * ppu, Y = v => (1 - v) * H;
  const color = cls => MATERIALS[cls] || "#ff00ff";
  g.clearRect(0, 0, W, H);
  g.fillStyle = MATERIALS.body;
  g.fillRect(0, 0, W, H);
  const poly = pts => {
    g.beginPath();
    pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v))));
    g.closePath();
  };
  for (const s of coachShapes({ index: 1 })) {
    if (s.kind === "logo") {
      g.save();
      if (s.clipTop) { g.beginPath(); g.rect(0, Y(s.clipTop), W, H); g.clip(); }
      g.translate(X(s.u0), Y(s.v0));
      g.scale(s.k * ppu, s.k * H);
      g.fillStyle = color(s.cls.slice(2));
      g.fill(new Path2D(RZD_LOGO));
      g.restore();
    } else if (s.kind === "window" || s.kind === "doorWindow") {
      // уплотнитель вокруг проёма: половина линии видна вокруг окна, половина уходит в откос
      const [u0, v0, u1, v1] = s.kind === "window" ? [s.u0, s.v0, s.u1, s.v1]
        : [Math.min(...s.pts.map(p => p[0])), Math.min(...s.pts.map(p => p[1])), Math.max(...s.pts.map(p => p[0])), Math.max(...s.pts.map(p => p[1]))];
      const r = s.kind === "window" ? s.r * ppu : (u1 - u0) * ppu / 2;
      g.beginPath();
      g.roundRect(X(u0), Y(v1), X(u1) - X(u0), Y(v0) - Y(v1), r);
      g.lineWidth = ppu * .026;
      g.strokeStyle = color("frame");
      g.stroke();
    } else if (s.kind === "text") {
      g.fillStyle = color(s.cls?.slice(2) || "print");
      g.font = `700 ${Math.round(s.size * H)}px "Exo 2", sans-serif`;
      g.textAlign = "center";
      g.fillText(s.text, X(s.u), Y(s.v));
      g.textAlign = "left";
    } else if (s.pts && s.cls) {
      if (s.cls === "f-roof" || s.cls === "f-roofbox") continue;          // крыша — геометрией
      if (s.pts.every(([, v]) => v <= 0)) continue;                         // низ — геометрией
      poly(s.pts);
      if (s.cls.startsWith("o-")) {
        g.fillStyle = s.cls === "o-light1" ? "rgba(255,255,255,.16)" : s.cls === "o-dark2" ? "rgba(0,0,0,.2)" : "rgba(0,0,0,.09)";
      } else {
        g.fillStyle = color(s.cls.slice(2));
      }
      g.fill();
      if (s.stroke) { g.lineWidth = s.sw * ppu; g.strokeStyle = color(s.stroke.slice(2)); g.stroke(); }
    } else if (s.line) {
      // гофра низа и рёбра — это частые полосы; на текстуре вдали они дали бы муар, поэтому
      // рисуем их бледнее и толще, а самые мелкие пропускаем
      if (s.cls === "s-corr" || s.cls === "s-ribhi") continue;
      g.beginPath();
      g.moveTo(X(s.line[0][0]), Y(s.line[0][1]));
      g.lineTo(X(s.line[1][0]), Y(s.line[1][1]));
      g.lineWidth = Math.max(2, s.w * ppu);
      g.strokeStyle = color(s.cls.slice(2).replace("-v", ""));
      g.stroke();
    }
  }
}
