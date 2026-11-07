// Финальная сборка кадра — один полноэкранный проход:
//   1. небо (буфер пониженного разрешения) + звёзды и луна в полном разрешении, спрятанные за облаками;
//   2. поверх — сцена (её буфер с прозрачностью там, где видно небо);
//   3. осадки: дождь штрихами, снег хлопьями — несколько слоёв с параллаксом;
//   4. фильтры из STYLE.filters: экспозиция, контраст, насыщенность, тёплый/холодный тон,
//      виньетка, постеризация, дизеринг (убирает полосы на градиентах) и, если включено, зерно.
// Новый фильтр добавляется функцией в GLSL ниже и параметром в STYLE.filters.
import * as THREE from "three";
import { STYLE } from "../style.js";

const FRAGMENT = /* glsl */`
  uniform sampler2D tSky;
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform mat4 uInvProj;
  uniform mat4 uCamRot;
  uniform float uTime;
  // небо ночью
  uniform float uStars;
  uniform vec3 uMoonDir;
  uniform vec3 uSunDir;
  uniform float uMoon;           // видимость луны 0…1
  uniform vec3 uMoonColor;
  uniform vec3 uSkyTop;
  // осадки: x — дождь, y — снег, z — ветер (наклон), w — сдвиг от поворота камеры
  uniform vec4 uPrecip;
  uniform vec3 uPrecipColor;
  // фильтры
  uniform vec4 uGrade;           // экспозиция, контраст, насыщенность, теплота
  uniform vec4 uFx;              // виньетка, дизеринг, зерно, постеризация
  uniform vec3 uVignetteColor;
  varying vec2 vUv;

  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 hash33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

  vec3 rayDir(vec2 uv){
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    return normalize(mat3(uCamRot) * (p.xyz / p.w));
  }

  // звёзды: в каждой ячейке сетки направлений — не больше одной, с мягким пятном в 1–2 пикселя.
  // Положение звезды фиксировано в мире, поэтому при повороте камеры они не мерцают.
  float stars(vec3 d, float pix){
    if (d.y < .02) return 0.0;
    vec3 g = d * 90.0;
    vec3 cell = floor(g);
    vec3 r = hash33(cell);
    if (r.x > .07) return 0.0;
    vec3 star = (cell + .2 + .6 * r) / 90.0;
    float ang = length(normalize(star) - d);
    float size = pix * (.45 + .6 * r.y * r.y);
    float b = exp(-ang * ang / (size * size));
    return b * (.25 + .75 * r.z * r.z) * smoothstep(.02, .25, d.y);
  }

  // луна: шар, освещённый со стороны солнца — серп и фаза получаются сами
  vec3 moon(vec3 d, float pix){
    float R = .0145;
    vec3 m = normalize(uMoonDir);
    float c = dot(d, m);
    if (c < .99) return vec3(0.0);
    vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, m);
    vec2 p = vec2(dot(d - m * c, right), dot(d - m * c, up)) / R;
    float r2 = dot(p, p);
    float edge = 1.0 - smoothstep(1.0 - pix / R * 1.5, 1.0, sqrt(r2));
    if (edge <= 0.0) return vec3(0.0);
    vec3 n = p.x * right + p.y * up - sqrt(max(0.0, 1.0 - r2)) * m;
    float lit = smoothstep(-.04, .08, dot(n, uSunDir));
    vec3 col = uMoonColor * (.07 + .93 * lit);
    return col * edge;
  }

  float rainLayer(vec2 uv, float scale, float speed, float seed, float density){
    vec2 p = uv * vec2(scale, scale * .18);
    p.y += uTime * speed;
    p.x += p.y * uPrecip.z * .18 + uPrecip.w * scale;
    float w = fwidth(p.x) * 1.1;                 // до ветвления: производные
    vec2 cell = floor(p), f = fract(p);
    float r = hash12(cell + seed);
    if (r > density) return 0.0;
    float x = .15 + .7 * hash12(cell + seed + 3.7);
    float y0 = hash12(cell + seed + 7.1) * .5;
    float line = 1.0 - smoothstep(w * .5, w * 1.5, abs(f.x - x));
    float len = .35 + .3 * hash12(cell + seed + 1.3);
    float seg = smoothstep(y0, y0 + .08, f.y) * (1.0 - smoothstep(y0 + len - .1, y0 + len, f.y));
    return line * seg;
  }

  float snowLayer(vec2 uv, float scale, float speed, float seed, float density){
    vec2 p = uv * scale;
    p.y += uTime * speed;
    p.x += sin(uTime * .7 + p.y * .9 + seed) * .25 + uPrecip.w * scale + uTime * uPrecip.z * .05;
    float px = fwidth(p.x);                      // до ветвления: производные
    vec2 cell = floor(p), f = fract(p);
    float r = hash12(cell + seed);
    if (r > density) return 0.0;
    vec2 c = vec2(.2, .2) + .6 * vec2(hash12(cell + seed + 2.3), hash12(cell + seed + 5.9));
    float size = (.035 + .055 * hash12(cell + seed + 9.1));
    return 1.0 - smoothstep(size - px, size + px, length(f - c));
  }

  void main(){
    vec2 frag = gl_FragCoord.xy;
    vec4 sky = texture2D(tSky, vUv);
    vec3 col = sky.rgb;
    vec3 d = rayDir(vUv);
    float px = length(rayDir(vUv + vec2(1.0 / uRes.x, 0.0)) - d);       // угол одного пикселя
    if (uStars > .002 || uMoon > .002) {
      float clear = 1.0 - sky.a;
      col += vec3(.9, .93, 1.0) * stars(d, px) * uStars * clear;
      col = mix(col, max(col, moon(d, px)), uMoon * clear);
    }
    vec4 scene = texture2D(tScene, vUv);
    col = col * (1.0 - scene.a) + scene.rgb;

    // осадки поверх всего
    if (uPrecip.x > .001) {
      vec2 uv = frag / uRes.y;
      float r = rainLayer(uv, 26.0, 2.6, 1.0, .22 * uPrecip.x) * .45
              + rainLayer(uv, 48.0, 3.4, 7.0, .3 * uPrecip.x) * .32
              + rainLayer(uv, 90.0, 4.6, 13.0, .38 * uPrecip.x) * .2;
      col = mix(col, uPrecipColor, clamp(r, 0.0, 1.0) * .5);
    }
    if (uPrecip.y > .001) {
      vec2 uv = frag / uRes.y;
      float s = snowLayer(uv, 11.0, .55, 2.0, .28 * uPrecip.y) * .9
              + snowLayer(uv, 20.0, .4, 5.0, .4 * uPrecip.y) * .7
              + snowLayer(uv, 38.0, .28, 11.0, .5 * uPrecip.y) * .45;
      col = mix(col, vec3(.97, .98, 1.0), clamp(s, 0.0, 1.0) * .85);
    }

    // цветокоррекция
    col *= uGrade.x;
    col = (col - .5) * uGrade.y + .5;
    float lum = dot(col, vec3(.299, .587, .114));
    col = mix(vec3(lum), col, uGrade.z);
    col *= vec3(1.0 + uGrade.w * .06, 1.0, 1.0 - uGrade.w * .06);
    // виньетка — как прежняя CSS-виньетка: эллипс, прозрачный в середине, тёмный к краям
    vec2 e = (vUv - vec2(.5, .54)) / vec2(.78, .72);
    float v = smoothstep(.58, 1.0, length(e) * 1.0);
    col = mix(col, uVignetteColor, v * uFx.x);
    if (uFx.w > 1.0) col = floor(col * uFx.w + .5) / uFx.w;
    // дизеринг: ±½ ступени 8 бит — плавные градиенты неба без полос; зерно — по желанию
    float n = hash12(frag) + hash12(frag + 17.31) - 1.0;
    col += n * (uFx.y / 255.0 + uFx.z * .08);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class Composite {
  constructor() {
    const F = STYLE.filters;
    this.uniforms = {
      tSky: { value: null }, tScene: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() },
      uTime: { value: 0 },
      uStars: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: 0 }, uMoonColor: { value: new THREE.Vector3(.93, .95, .98) }, uSkyTop: { value: new THREE.Vector3() },
      uPrecip: { value: new THREE.Vector4() }, uPrecipColor: { value: new THREE.Vector3(.8, .84, .9) },
      uGrade: { value: new THREE.Vector4(F.exposure, F.contrast, F.saturation, F.warmth) },
      uFx: { value: new THREE.Vector4(F.vignette, F.dither, F.grain, F.posterize) },
      uVignetteColor: { value: new THREE.Vector3(...F.vignetteColor.map(c => c / 255)) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: FRAGMENT,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Перечитать STYLE.filters (например, после правки в инструменте разработчика). */
  syncStyle() {
    const F = STYLE.filters;
    this.uniforms.uGrade.value.set(F.exposure, F.contrast, F.saturation, F.warmth);
    this.uniforms.uFx.value.set(F.vignette, F.dither, F.grain, F.posterize);
    this.uniforms.uVignetteColor.value.set(...F.vignetteColor.map(c => c / 255));
  }

  render(renderer, sky, scene, camera, width, height) {
    const U = this.uniforms;
    U.tSky.value = sky;
    U.tScene.value = scene;
    U.uRes.value.set(width, height);
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamRot.value.extractRotation(camera.matrixWorld);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.ortho);
  }
}
