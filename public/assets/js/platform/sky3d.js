// Небо в 3D: купол с градиентом и свечением вокруг солнца, солнце, луна с фазой, звёзды
// и процедурные облака. Всё в мировых координатах, поэтому двигается вместе с камерой.
import * as THREE from "three";
import { clamp } from "../lib/color.js";

const RAD = Math.PI / 180;
const srgb = (c, k = 1) => new THREE.Color().setRGB(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k, THREE.SRGBColorSpace);

/** Направление на светило в мире: камера смотрит вдоль −z на азимут viewAz. */
export function skyDirection(azimuth, altitude, viewAz) {
  const rel = (azimuth - viewAz) * RAD, alt = altitude * RAD;
  return new THREE.Vector3(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
}

const NOISE = /* glsl */`
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
  float fbm(vec3 p){
    float s=0.0, a=0.5;
    for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
    return s;
  }
`;

export function createSky(scene) {
  // купол
  const domeU = {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunGlow: { value: new THREE.Color() }, glow: { value: 0 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), new THREE.ShaderMaterial({
    uniforms: domeU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `
      uniform vec3 top, horizon, sunDir, sunGlow; uniform float glow; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(smoothstep(0.0, 0.62, h), 0.75));
        float s = max(dot(d, sunDir), 0.0);
        col += sunGlow * (pow(s, 6.0) * 0.55 * glow + pow(s, 48.0) * 0.5 + pow(s, 600.0) * 1.2);
        // у самого горизонта — светлая полоса дымки
        col = mix(col, horizon * 1.04, (1.0 - smoothstep(0.0, 0.06, abs(d.y))) * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  dome.renderOrder = -10;
  scene.add(dome);

  // звёзды
  const starPos = [];
  let seed = 3;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 1400; i++) {
    const y = .04 + rnd() * .96, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * r * 4000, y * 4000, Math.sin(a) * r * 4000);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  scene.add(stars);

  // солнце и луна — спрайты далеко по направлению на светило
  const disc = (inner, outer) => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(inner, "rgba(255,255,255,1)");
    gr.addColorStop(outer, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const spriteMat = map => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const sun = new THREE.Sprite(spriteMat(disc(.18, .3)));
  const halo = new THREE.Sprite(spriteMat(disc(.0, .15)));
  sun.renderOrder = halo.renderOrder = -8;
  scene.add(sun, halo);
  const moonCanvas = document.createElement("canvas"); moonCanvas.width = moonCanvas.height = 128;
  const moonTex = new THREE.CanvasTexture(moonCanvas); moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }));
  moon.renderOrder = -8;
  scene.add(moon);
  let moonPhase = -1;
  const drawMoon = phase => {
    const g = moonCanvas.getContext("2d");
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = "#eef1f8"; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill();
    // тень: эллипс, сдвинутый по фазе (0 — новолуние, .5 — полнолуние)
    const k = Math.cos(phase * 2 * Math.PI);
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.ellipse(64 + (phase < .5 ? -1 : 1) * 0, 64, 52, 52, 0, 0, 7);
    g.fill();
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#eef1f8";
    g.beginPath();
    g.arc(64, 64, 52, phase < .5 ? -Math.PI / 2 : Math.PI / 2, phase < .5 ? Math.PI / 2 : -Math.PI / 2);
    g.ellipse(64, 64, Math.abs(k) * 52, 52, 0, phase < .5 ? Math.PI / 2 : -Math.PI / 2, phase < .5 ? -Math.PI / 2 : Math.PI / 2, k > 0);
    g.fill();
    moonTex.needsUpdate = true;
  };

  // облака: плоскость высоко над землёй, форма — шум, медленно меняющийся во времени
  const cloudU = {
    time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() },
    lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
    sunGlow: { value: new THREE.Color() }, coverage: { value: .12 }, opacity: { value: 1 },
  };
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.ShaderMaterial({
    uniforms: cloudU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE + /* glsl */`
      uniform float time, coverage, opacity; uniform vec3 sunDir, camPos, lit, shade, horizon, sunGlow; varying vec3 vWorld;
      float density(vec2 p, float t){
        // искривление пространства даёт рваные «кучевые» края; третья координата — время: форма живёт
        vec2 q = p + 0.55 * vec2(snoise(vec3(p * 0.6, t * 0.6)), snoise(vec3(p * 0.6 + 7.3, t * 0.6)));
        float n = fbm(vec3(q, t));
        return smoothstep(coverage, coverage + 0.32, n);
      }
      void main(){
        float dist = length(vWorld.xz - camPos.xz);
        vec2 p = vWorld.xz / 2400.0 + vec2(time * 0.0016, time * 0.0007);
        float t = time * 0.004;
        float d = density(p, t);
        if (d < 0.004) discard;
        // самозатенение: насколько облако гуще в сторону солнца
        vec2 toSun = normalize(sunDir.xz + 1e-4) * 0.06;
        float ds = density(p + toSun, t);
        float light = clamp(0.62 + (d - ds) * 2.4, 0.0, 1.0);
        float core = smoothstep(0.45, 1.0, d);               // толстые ядра снизу темнее
        vec3 col = mix(shade, lit, light * (1.0 - core * 0.55));
        // кайма у облаков рядом с солнцем
        vec3 view = normalize(vWorld - camPos);
        float fwd = pow(max(dot(view, sunDir), 0.0), 5.0);
        col += sunGlow * fwd * (1.0 - d) * 0.9;
        // к горизонту — в дымку
        col = mix(col, horizon, smoothstep(2500.0, 26000.0, dist) * 0.9);
        float a = d * (1.0 - smoothstep(14000.0, 34000.0, dist)) * opacity;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  }));
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = 1800;
  clouds.renderOrder = -7;
  scene.add(clouds);

  const cumulus = createCumulus(scene);
  const up = new THREE.Vector3();
  return {
    update(env, sky, camera, viewAz, seconds) {
      const sunDir = skyDirection(sky.sun.azimuth, sky.sun.altitude, viewAz);
      domeU.top.value.copy(srgb(env.top));
      domeU.horizon.value.copy(srgb(env.horizon));
      domeU.sunDir.value.copy(sunDir);
      domeU.sunGlow.value.copy(srgb(env.sunColor, .55 * clamp((sky.sun.altitude + 6) / 10)));
      domeU.glow.value = env.glow + .25;
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      starMat.opacity = env.stars;

      const sunUp = clamp((sky.sun.altitude + 1.5) / 3);
      sun.position.copy(camera.position).addScaledVector(sunDir, 4000);
      sun.scale.setScalar(150);
      sun.material.color.copy(srgb(env.sunColor));
      sun.material.opacity = sunUp;
      halo.position.copy(sun.position);
      halo.scale.setScalar(900 + env.glow * 900);
      halo.material.color.copy(srgb(env.sunColor, .5));
      halo.material.opacity = sunUp * (.35 + env.glow * .4);

      if (sky.moon) {
        const md = skyDirection(sky.moon.azimuth, sky.moon.altitude, viewAz);
        moon.position.copy(camera.position).addScaledVector(md, 4000);
        moon.scale.setScalar(130);
        moon.material.opacity = (.3 + .7 * sky.moon.fraction) * clamp((6 - sky.sun.altitude) / 10) * clamp((sky.moon.altitude + 1) / 3);
        if (Math.abs(sky.moon.phase - moonPhase) > .01) { moonPhase = sky.moon.phase; drawMoon(moonPhase); }
      } else {
        moon.material.opacity = 0;
      }

      // облака: днём белые с голубовато-серой тенью, на закате розово-персиковые, ночью тёмные
      const night = clamp((-sky.sun.altitude - 3) / 6), day = clamp((sky.sun.altitude + 2) / 12);
      const litC = [255, 255, 255].map((v, i) => v + ([255, 186, 150][i] - v) * env.glow * .9);
      const nightLit = env.top.map((v, i) => v + ([150, 160, 196][i] - v) * .28);
      cloudU.lit.value.copy(srgb(litC.map((v, i) => v + (nightLit[i] - v) * night)));
      const shadeDay = env.top.map((v, i) => (v + (env.horizon[i] - v) * .5) * .5 + 255 * .3);
      const shadeDusk = [118, 96, 150].map((v, i) => v + (env.horizon[i] - v) * .35);
      const sh = shadeDay.map((v, i) => v + (shadeDusk[i] - v) * env.glow * .75);
      cloudU.shade.value.copy(srgb(sh.map((v, i) => v + (env.top[i] * .8 + 6 - v) * night)));
      cloudU.horizon.value.copy(srgb(env.horizon));
      cloudU.sunGlow.value.copy(srgb(env.sunColor, .45 * day + .2 * env.glow));
      cloudU.sunDir.value.copy(sunDir.y > -.2 ? sunDir : up.set(0, 1, 0));
      cloudU.camPos.value.copy(camera.position);
      cloudU.time.value = seconds;
      cloudU.opacity.value = (.45 - .2 * night) * (.6 + .4 * day);      // высокий перистый ярус — тонкий
      cumulus.update({ seconds, camera, sunDir, lit: cloudU.lit.value, shade: cloudU.shade.value,
        horizon: cloudU.horizon.value, sunGlow: cloudU.sunGlow.value, night });
      return sunDir;
    },
  };
}

/* ---------- кучевые облака: объём из мягких «клубов», форма живёт и меняется ---------- */

function puffTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  let seed = 11;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  // клуб: мягкий диск из множества мелких пятен — края получаются «ватными», а не ровным кругом
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 38, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, s = 14 + rnd() * 24;
    const gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, "rgba(255,255,255,.34)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function createCumulus(scene, count = 26, perCloud = 34) {
  let seed = 23;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const N = count * perCloud;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puffTexture() }, scale: { value: 800 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vColor; varying float vAlpha; uniform float scale;
      void main(){ vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
      void main(){ float a = texture2D(map, gl_PointCoord).a * vAlpha; if (a < .01) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -6;
  scene.add(points);

  // облако: центр основания, размер, клубы (смещение, радиус, фаза «дыхания»), жизненный цикл
  const clouds = [];
  const spawn = (cl, now, initial) => {
    const az = -.75 + rnd() * 1.7, dist = 2200 + rnd() * 8500;            // в основном там, куда смотрит камера
    cl.base = new THREE.Vector3(Math.sin(az) * dist, 950 + rnd() * 700, -Math.cos(az) * dist);
    cl.width = 500 + rnd() * 1300;
    cl.born = now - (initial ? rnd() * cl.life : 0);
    cl.life = 260 + rnd() * 420;                         // секунд: облако рождается, живёт и тает
    cl.puffs ||= [];
    for (let i = 0; i < perCloud; i++) {
      const layer = i < perCloud * .45 ? 0 : i < perCloud * .8 ? 1 : 2;
      const a = rnd() * Math.PI * 2, spread = [.55, .34, .18][layer] * (.6 + rnd() * .5);
      cl.puffs[i] = ({
        x: Math.cos(a) * spread * cl.width, z: Math.sin(a) * spread * cl.width * .6,
        y: [.05, .24, .42][layer] * cl.width * (.85 + rnd() * .3),
        r: cl.width * [.17, .21, .17][layer] * (.7 + rnd() * .6),
        phase: rnd() * Math.PI * 2, period: 40 + rnd() * 70,
      });
    }
  };
  for (let i = 0; i < count; i++) { const cl = { life: 400 }; spawn(cl, 0, true); clouds.push(cl); }

  const wind = new THREE.Vector3(5.5, 0, 2.2);           // м/с — облака плывут
  const entries = clouds.flatMap(cl => cl.puffs.map((_, q) => [cl, q]));   // клуб = (облако, номер)
  let drawOrder = entries.map((_, i) => i), lastSort = -1;
  const tmpV = new THREE.Vector3(), view = new THREE.Vector3(), c3 = new THREE.Color();
  return {
    update({ seconds, camera, sunDir, lit, shade, horizon, sunGlow, night }) {
      const state = new Map();
      for (const cl of clouds) {
        let age = (seconds - cl.born) / cl.life;
        if (age > 1 || age < 0) { spawn(cl, seconds, false); age = 0; }
        const grow = Math.sin(Math.PI * Math.min(1, Math.max(0, age))) ** .6;    // облако растёт и тает
        const cx = cl.base.x + wind.x * (seconds - cl.born), cz = cl.base.z + wind.z * (seconds - cl.born);
        const dist = Math.hypot(cx - camera.position.x, cz - camera.position.z);
        view.set(cx - camera.position.x, cl.base.y - camera.position.y, cz - camera.position.z).normalize();
        state.set(cl, { grow, cx, cz, haze: Math.min(.92, Math.max(0, (dist - 2000) / 12000)), behind: Math.max(0, view.dot(sunDir)) ** 4 });
      }
      // дальние клубы рисуем первыми: порядок пересчитываем раз в полсекунды
      if (seconds - lastSort > .5 || lastSort < 0) {
        lastSort = seconds;
        const d2 = entries.map(([cl, q]) => {
          const st = state.get(cl), p = cl.puffs[q];
          return (st.cx + p.x - camera.position.x) ** 2 + (cl.base.y + p.y - camera.position.y) ** 2 + (st.cz + p.z - camera.position.z) ** 2;
        });
        drawOrder = entries.map((_, i) => i).sort((a, b) => d2[b] - d2[a]);
      }
      drawOrder.forEach((i, k) => {
        const [cl, q] = entries[i], p = cl.puffs[q], st = state.get(cl);
        const breathe = 1 + .12 * Math.sin(seconds / p.period * Math.PI * 2 + p.phase);    // клубы «дышат»
        pos[k * 3] = st.cx + p.x; pos[k * 3 + 1] = cl.base.y + p.y * (.7 + .3 * st.grow); pos[k * 3 + 2] = st.cz + p.z;
        size[k] = p.r * 2 * breathe * st.grow;
        // освещение клуба: сторона к солнцу светлее, низ облака темнее
        tmpV.set(p.x, p.y - cl.width * .18, p.z).normalize();
        const facing = .5 + .5 * tmpV.dot(sunDir);
        const low = 1 - Math.min(1, p.y / (cl.width * .45));
        const light = Math.max(0, Math.min(1, facing * .8 + .38 - low * .62));     // верх светлый, основание — в тени
        c3.copy(shade).lerp(lit, light);
        c3.r += sunGlow.r * st.behind * .7; c3.g += sunGlow.g * st.behind * .7; c3.b += sunGlow.b * st.behind * .7;
        c3.lerp(horizon, st.haze);
        col[k * 3] = c3.r; col[k * 3 + 1] = c3.g; col[k * 3 + 2] = c3.b;
        alpha[k] = (.85 - .35 * night) * (1 - st.haze * .55);
      });
      mat.uniforms.scale.value = (camera.userData.focal || innerHeight) * (camera.userData.pixelRatio || 1);
      for (const name of ["position", "color", "size", "alpha"]) geo.attributes[name].needsUpdate = true;
    },
  };
}
