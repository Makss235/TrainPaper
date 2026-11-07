// Небо: градиент от горизонта к зениту, свечение вокруг солнца, солнечный диск и облака.
// Рисуется одним полноэкранным шейдером в отдельный буфер пониженного разрешения (STYLE.quality.skyScale)
// и не чаще STYLE.quality.skyFps раз в секунду — облака плывут медленно, этого хватает.
// В альфа-канал буфера пишется плотность облаков: по ней сборка кадра прячет за облаками
// звёзды и луну (их рисует engine/composite.js в полном разрешении, чтобы они были чёткими).
//
// Облака стилизованы под общий вид: плотность — шум, но тон в два-три уровня (освещённая сторона
// и тень) со сглаженной границей. Два яруса: кучевые (1,6 км) и перистые (7 км).
// Против мерцания у горизонта: мелкие октавы шума гасятся, когда становятся мельче пикселя
// (там облако пришлось бы «рисовать» шумом, который при движении камеры рябит).
import * as THREE from "three";

export const NOISE = /* glsl */`
  // 3D simplex noise (Ashima Arts, MIT)
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  // фрактальный шум; fp — размер пикселя в единицах шума: октавы мельче пикселя плавно убираются
  float fbm(vec3 p, float fp, int oct){
    float s = 0.0, a = .5, f = 1.0;
    for (int i = 0; i < 6; i++){
      if (i >= oct) break;
      float keep = 1.0 - smoothstep(.25, .5, fp * f);
      s += a * snoise(p) * keep;
      p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; f *= 2.03;
    }
    return s;
  }
`;

const FRAGMENT = /* glsl */`
  ${NOISE}
  uniform mat4 uInvProj;
  uniform mat4 uCamRot;
  uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
  uniform float uGlow, uSunVis, uTime;
  // облака: x — покрытие 0…1, y — плотность/непрозрачность, z — темнота основания, w — перистые 0…1
  uniform vec4 uClouds;
  uniform vec3 uCloudLit, uCloudShade;
  uniform vec2 uWind;            // смещение облаков, м
  uniform float uNight;
  varying vec2 vUv;

  vec3 rayDir(vec2 uv){
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    return normalize(mat3(uCamRot) * (p.xyz / p.w));
  }

  // плотность кучевого яруса в точке плоскости (км); fp — размер пикселя в тех же единицах
  float cumulus(vec2 q, float t, float fp, int oct){
    vec2 w = vec2(snoise(vec3(q * .35, t * .5)), snoise(vec3(q * .35 + 5.2, t * .5)));
    float n = fbm(vec3(q + w * .55, t), fp, oct) * .5 + .5;
    // шум распределён вокруг 0,5 — порог от покрытия неба: 0 — чисто, 1 — сплошь
    float c = uClouds.x;
    float cov = .74 - .52 * c - .17 * c * c * c * c;
    return smoothstep(cov - .03, cov + .14, n);
  }

  void main(){
    vec3 d = rayDir(vUv);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, .62, h), .75));
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(s, 6.0) * .55 * uGlow + pow(s, 48.0) * .45) * uSunVis;
    // у самого горизонта — светлая полоса дымки
    col = mix(col, uHorizon * 1.03, (1.0 - smoothstep(0.0, .06, abs(d.y))) * .35);
    // ниже горизонта — цвет горизонта (там всё равно земля; так нет шва при наклоне камеры)
    if (d.y < 0.0) col = uHorizon;
    vec3 sky = col;

    float cloudA = 0.0;
    // точка на плоскости облаков и размер пикселя на ней — до любых ветвлений (производные)
    float dy = max(d.y, .012);
    float dist = 1.6 / dy;                                // км до плоскости кучевых облаков
    vec2 q = d.xz * dist + uWind / 1000.0;
    float fp = length(fwidth(q)) * 1.4;                   // размер пикселя в км на плоскости облаков
    float dist2 = 7.0 / dy;
    vec2 q2 = d.xz * dist2 + uWind / 600.0;
    float fp2 = length(fwidth(q2)) * 1.4;
    if (d.y > .012 && uClouds.y > .001) {
      float t = uTime * .004;
      vec2 qs = q / 2.4;
      float den = cumulus(qs, t, fp / 2.4, 5);
      // свет: насколько облако тоньше в сторону солнца — та сторона освещена
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * .09;
      float ds = cumulus(qs + toSun, t, fp / 2.4 * 2.0, 3);
      float light = clamp(.62 + (den - ds) * 2.6 - uClouds.z * .45, 0.0, 1.0);
      // два тона со сглаженной границей — облака «нарисованные», а не фото
      float aa = .07;
      float tone = smoothstep(.5 - aa, .5 + aa, light);
      tone = mix(tone, light, .35);
      float core = smoothstep(.55, 1.0, den) * uClouds.z;
      vec3 c = mix(uCloudShade, uCloudLit, tone * (1.0 - core * .5));
      // кайма у облаков рядом с солнцем
      float fwd = pow(s, 5.0);
      c += uSunColor * fwd * (1.0 - den) * .8 * uSunVis;
      // к горизонту облака уходят в дымку и становятся прозрачнее
      float far = smoothstep(3.0, 30.0, dist);
      c = mix(c, uHorizon, far * .85);
      float a = den * uClouds.y * (1.0 - smoothstep(14.0, 40.0, dist));
      col = mix(col, c, a);
      cloudA = a;

      // перистые облака: тонкие вытянутые волокна высоко
      if (uClouds.w > .01) {
        vec3 p2 = vec3(q2.x / 9.0, q2.y / 3.0, t * .6);
        float ci = fbm(p2, fp2 / 3.0, 4) * .5 + .5;
        float cir = smoothstep(.55, .85, ci) * uClouds.w * (1.0 - smoothstep(30.0, 90.0, dist2)) * .5;
        vec3 cc = mix(uCloudLit, uHorizon, smoothstep(10.0, 60.0, dist2) * .7);
        col = mix(col, cc, cir * (1.0 - a));
        cloudA = max(cloudA, cir);
      }
    }
    // за облаками солнечный диск не виден
    float disc = smoothstep(.99955, .99975, s) * uSunVis * (1.0 - cloudA * .92);
    col = mix(col, uSunColor * 1.15 + .15, disc);
    gl_FragColor = vec4(col, cloudA);
  }
`;

const srgb = c => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255);

export class SkyLayer {
  constructor() {
    this.uniforms = {
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() },
      uTop: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uGlow: { value: 0 }, uSunVis: { value: 1 }, uTime: { value: 0 },
      uClouds: { value: new THREE.Vector4(.4, .9, .2, .3) },
      uCloudLit: { value: new THREE.Vector3(1, 1, 1) }, uCloudShade: { value: new THREE.Vector3(.75, .8, .88) },
      uWind: { value: new THREE.Vector2() }, uNight: { value: 0 },
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
    this.wind = new THREE.Vector2();
  }

  /**
   * Цвета и облака: env — окружение (lib/sky.js, с поправкой на погоду), sky — солнце и луна,
   * sunDir — направление на солнце, weather — параметры погоды.
   */
  set(env, sky, sunDir, weather) {
    const U = this.uniforms, clamp = v => Math.min(1, Math.max(0, v));
    U.uTop.value.copy(srgb(env.top));
    U.uHorizon.value.copy(srgb(env.horizon));
    U.uSunDir.value.copy(sunDir);
    U.uSunColor.value.copy(srgb(env.sunColor)).multiplyScalar(.55 * clamp((sky.sun.altitude + 6) / 10));
    U.uGlow.value = env.glow + .25;
    U.uSunVis.value = clamp((sky.sun.altitude + 1.5) / 3) * (1 - weather.overcast * .9);
    // облака: днём белые с голубовато-серой тенью, на закате персиковые, ночью тёмные
    const night = clamp((-env.alt - 3) / 6), day = clamp((env.alt + 2) / 12);
    const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    let lit = mixc([255, 255, 255], [255, 186, 150], env.glow * .9);
    lit = mixc(lit, mixc(env.top, [150, 160, 196], .28), night);
    const shadeDay = env.top.map((v, i) => (v + (env.horizon[i] - v) * .5) * .5 + 255 * .3);
    const shadeDusk = [118, 96, 150].map((v, i) => v + (env.horizon[i] - v) * .35);
    let shade = mixc(shadeDay, shadeDusk, env.glow * .75);
    shade = mixc(shade, env.top.map(v => v * .8 + 6), night);
    // пасмурно: облака серые, без яркой освещённой стороны
    const gray = weather.cloudGray, heavy = weather.cloudDark;
    const dim = 1 - .55 * night;
    lit = mixc(lit, mixc([198, 202, 208], env.horizon, .3).map(v => v * (1 - .32 * heavy) * dim), gray * .85);
    shade = mixc(shade, mixc([132, 138, 147], env.horizon, .25).map(v => v * (1 - .3 * heavy) * dim), gray);
    U.uCloudLit.value.copy(srgb(lit));
    U.uCloudShade.value.copy(srgb(shade));
    U.uClouds.value.set(weather.cover, weather.cloudOpacity * (1 - .3 * night) * (.75 + .25 * day + .25 * gray), weather.cloudDark, weather.cirrus);
    U.uNight.value = night;
  }

  /** Облака плывут: dt — секунды, wind — м/с (вектор по x, z мира). */
  advance(dt, seconds, wind) {
    this.wind.x += wind[0] * dt;
    this.wind.y += wind[1] * dt;
    this.uniforms.uWind.value.copy(this.wind);
    this.uniforms.uTime.value = seconds;
  }

  render(renderer, target, camera) {
    this.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCamRot.value.extractRotation(camera.matrixWorld);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.ortho);
  }
}
