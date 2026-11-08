// GLSL сцены. Пишется в стиле GLSL 1 (attribute/varying/texture2D) — three.js сам переводит
// его в GLSL 3 для WebGL 2. Цвет на выходе — уже «экранный» (sRGB), без пересчёта.
//
// Почему здесь нет шума, мерцания и муара:
//  - тени — по карте теней с аппаратным сравнением и PCF 3×3: край мягкий, но стабильный;
//  - повторяющиеся мелкие детали (швы плитки, шпалы, прутья ограды, гофра) не текстуры,
//    а формулы с честной фильтрацией по размеру пикселя (stripes): вдали они плавно сходятся
//    в средний тон, вместо того чтобы рассыпаться на рябь;
//  - граница cel-полос сглаживается по fwidth — ступенька тона без «лесенки».

/** Общие функции: шум-хэш, фильтрованные полосы, туман. */
export const COMMON = /* glsl */`
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  // Доля пикселя, покрытая полосами: полоса шириной wd (в долях периода) повторяется с периодом 1,
  // x — координата в периодах, w — ширина пикселя в тех же единицах. Это интеграл «коробкой»:
  // при w → 0 — резкие полосы, при w ≥ 1 — ровно wd (средний тон). Ряби не бывает.
  float stripeInt(float x, float wd){ return floor(x) * wd + min(fract(x), wd); }
  float stripes(float x, float wd, float w){
    w = max(w * 1.25, 1e-4);
    return (stripeInt(x + .5 * w, wd) - stripeInt(x - .5 * w, wd)) / w;
  }
  // то же, но полоса по центру периода (удобнее для швов и прутьев)
  float stripesC(float x, float wd){ return stripes(x + .5 * wd, wd, fwidth(x)); }
`;

/** Освещение: общие uniforms света (engine/light.js) и функции. */
export const LIGHTING = /* glsl */`
  #define MAX_LAMPS 8
  uniform vec3 uSunDir;          // направление НА солнце
  uniform vec3 uSun;             // цвет × сила прямого света (0 ночью)
  uniform vec3 uAmbSky;          // рассеянный свет неба (сверху)
  uniform vec3 uAmbGround;       // рассеянный свет снизу
  uniform vec3 uFogColor;
  uniform vec3 uFog;             // near, far, max
  uniform float uCeiling;
  uniform float uLamps;          // 0 днём … 1 ночью: фонари, окна, огни
  uniform vec4 uLampPos[MAX_LAMPS];   // xyz, w — радиус (0 — нет фонаря)
  uniform vec3 uLampCol[MAX_LAMPS];
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform float uWet;            // мокрая поверхность после дождя
  uniform float uSnow;           // снег на горизонтальных поверхностях
  uniform sampler2D uCoverMap;   // карта высот сверху: есть ли над точкой крыша
  uniform vec4 uCoverBox;        // x0, z0, размер, есть ли карта
  uniform vec2 uCoverRange;      // верх, низ карты по y
  // 1 — над точкой открытое небо, 0 — крыша (навес, вагон, мост). Вне карты — небо.
  float openSky(vec3 p) {
    if (uCoverBox.w < .5) return 1.0;
    vec2 uv = (p.xz - uCoverBox.xy) / uCoverBox.z;
    vec2 edge = min(uv, 1.0 - uv);
    if (min(edge.x, edge.y) < 0.0) return 1.0;
    float top = mix(uCoverRange.x, uCoverRange.y, textureLod(uCoverMap, vec2(uv.x, 1.0 - uv.y), 0.0).r);
    float covered = smoothstep(.25, .6, top - p.y);
    return 1.0 - covered * smoothstep(0.0, .06, min(edge.x, edge.y));   // у края карты — плавно
  }

  uniform highp sampler2DShadow uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform vec4 uShadowParams;    // x — включено, y — сдвиг глубины, z — сдвиг по нормали (м), w — размер текселя
  uniform vec2 uShadowFade;      // тень гаснет к краю области теней: от … до (м от камеры)

  // Тени-узоры (ограда): плоскость x = const, прутья и перила. Считаются аналитически — без карты теней,
  // поэтому тени тонких прутьев не дают муара.
  #define MAX_PATTERNS 2
  uniform vec4 uPatA[MAX_PATTERNS];   // x плоскости, y низа прутьев, y верха прутьев, шаг прутьев (0 — нет)
  uniform vec4 uPatB[MAX_PATTERNS];   // ширина прута, шаг стоек, ширина стойки, полутолщина перил
  uniform vec4 uPatC[MAX_PATTERNS];   // z от, z до, y перил 1, y перил 2

  float sunShadow(vec3 wp, vec3 n, float ndl){
    if (uShadowParams.x < .5) return 1.0;
    vec3 p = wp + n * uShadowParams.z * (1.2 - ndl);
    vec4 s = uShadowMatrix * vec4(p, 1.0);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
    float z = s.z - uShadowParams.y;
    float t = uShadowParams.w;
    // PCF 4×4: каждое чтение уже сравнивает 4 соседних текселя с билинейным весом —
    // край тени мягкий (~2 текселя) и без «лесенки» от размера текселя
    float sum = 0.0;
    for (int i = 0; i < 4; i++)
      for (int j = 0; j < 4; j++)
        sum += textureLod(uShadowMap, vec3(s.xy + (vec2(float(i), float(j)) - 1.5) * t, z), 0.0);
    float sh = sum / 16.0;
    float d = distance(wp, cameraPosition);
    return mix(sh, 1.0, smoothstep(uShadowFade.x, uShadowFade.y, d));
  }

  // Производные (fwidth) считаются без ветвлений: внутри if/continue, разных для соседних пикселей,
  // они не определены и дают крапинки на стыках.
  float patternShadow(vec3 wp){
    float lit = 1.0;
    for (int i = 0; i < MAX_PATTERNS; i++){
      vec4 A = uPatA[i], B = uPatB[i], C = uPatC[i];
      if (A.w <= 0.0) continue;                          // одинаково для всех пикселей — можно
      float sx = abs(uSunDir.x) < 1e-3 ? 1e-3 : uSunDir.x;
      float t = (A.x - wp.x) / sx;                       // до плоскости ограды вдоль луча на солнце
      vec3 h = wp + uSunDir * t;
      float bars = stripesC(h.z / A.w, B.x / A.w);
      float posts = stripesC(h.z / B.y, B.z / B.y);
      float fw = fwidth(h.y);
      float inBars = step(A.y, h.y) * step(h.y, A.z);
      float inPosts = step(A.y - .02, h.y) * step(h.y, C.w + .1);
      float rail1 = 1.0 - smoothstep(B.w, B.w + fw, abs(h.y - C.z));
      float rail2 = 1.0 - smoothstep(B.w, B.w + fw, abs(h.y - C.w));
      float cover = max(max(bars * inBars, posts * inPosts), max(rail1, rail2));
      cover *= step(0.0, t) * step(h.z, C.x) * step(C.y, h.z);
      lit *= 1.0 - cover;
    }
    return lit;
  }

  // точечные источники: w — радиус; w > 0 — горит только ночью (× uLamps), w < 0 — всегда
  vec3 lampLight(vec3 wp, vec3 n){
    vec3 sum = vec3(0.0);
    for (int i = 0; i < MAX_LAMPS; i++){
      vec4 L = uLampPos[i];
      if (L.w == 0.0) continue;
      float range = abs(L.w);
      vec3 d = L.xyz - wp;
      float dist = length(d);
      float att = clamp(1.0 - dist / range, 0.0, 1.0);
      att = att * att * (3.0 - 2.0 * att);               // мягкий край светового пятна
      float k = L.w > 0.0 ? uLamps : 1.0;
      sum += uLampCol[i] * att * k * (.3 + .7 * max(dot(n, d / max(dist, 1e-3)), 0.0));
    }
    return sum;
  }

  vec3 softCeiling(vec3 k){ return mix(k, 1.0 + (k - 1.0) * uCeiling, step(1.0, k)); }

  vec3 applyFog(vec3 col, vec3 wp, float haze){
    float d = distance(wp, cameraPosition);
    float f = smoothstep(uFog.x, uFog.y, d) * uFog.z * haze;
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

export const TOON_VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  void main(){
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 w = modelMatrix * p;
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    vColor = vec3(1.0);
    #ifdef USE_COLOR
      vColor = color;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vColor *= instanceColor;
    #endif
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/**
 * Cel-материал. Включается определениями (defines):
 *  USE_MAP — текстура (ливрея), TOON — две полосы тона для гладких тел (деревья),
 *  GLASS — стекло окна (днём отражает небо, ночью светится изнутри), RECEIVE — принимает тени,
 *  PATTERN_SHADOWS — принимает тени-узоры ограды, PAT_TILES/PAT_SLEEPERS/PAT_STRIPES — узоры поверхности,
 *  WET, SNOW — поверхность мокнет / покрывается снегом, ALPHA_STRIPES — прозрачность по узору (ограда).
 */
export const TOON_FRAGMENT = /* glsl */`
  ${COMMON}
  ${LIGHTING}
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uExtra;
  uniform float uHaze;
  uniform vec3 uEmissive;
  uniform vec3 uEmissiveNight;
  uniform vec3 uLitNight;        // подсветка изнутри ночью: добавка к освещённости (табличка, вывеска)
  uniform float uGlassShade;     // стекло: доля затемнения (0 — прозрачное, 1 — тёмная шторка)
  #ifdef USE_MAP
    uniform sampler2D uMap;
  #endif
  #if defined(PAT_TILES) || defined(PAT_SLEEPERS) || defined(PAT_STRIPES) || defined(ALPHA_STRIPES)
    uniform vec4 uPat;        // параметры узора (см. materials.js)
    uniform vec3 uPatColor;   // цвет линий узора
  #endif
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;

  void main(){
    vec3 base = uColor * vColor;
    float alpha = uOpacity;
    #ifdef USE_MAP
      vec4 tex = texture2D(uMap, vUv);
      base *= tex.rgb;
      alpha *= tex.a;
    #endif

    #ifdef PAT_TILES
      // швы плитки: uPat = шаг по x, шаг по z, ширина шва, дальность исчезновения
      float gx = stripesC(vWorld.x / uPat.x, uPat.z / uPat.x);
      float gz = stripesC(vWorld.z / uPat.y, uPat.z / uPat.y);
      float seams = 1.0 - (1.0 - gx) * (1.0 - gz);
      seams *= 1.0 - smoothstep(uPat.w * .6, uPat.w, distance(vWorld, cameraPosition));
      base = mix(base, uPatColor, seams * .85);
    #endif
    #ifdef PAT_SLEEPERS
      // шпалы в координатах поверхности (uv в метрах: u — поперёк пути от оси, v — вдоль):
      // узор едет вместе с объектом. uPat = —, полудлина шпалы, шаг, ширина шпалы
      float inX = 1.0 - smoothstep(uPat.y - fwidth(vUv.x), uPat.y, abs(vUv.x));
      float sl = stripesC(vUv.y / uPat.z, uPat.w / uPat.z) * inX;
      base = mix(base, uPatColor, sl);
    #endif
    #ifdef PAT_STRIPES
      // полосы по координате поверхности u (гофра, рёбра, гармошка) — едут вместе с вагоном.
      // uPat = шаг, ширина (в единицах u), сила, —
      float st = stripesC(vUv.x / uPat.x, uPat.y / uPat.x);
      base = mix(base, uPatColor, st * uPat.z);
    #endif
    #ifdef ALPHA_STRIPES
      // прутья ограды: прозрачность по узору, вдали — ровная полупрозрачная лента
      alpha *= stripesC(vWorld.z / uPat.x, uPat.y / uPat.x);
      base = uPatColor;
    #endif

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float ndl = dot(n, uSunDir);
    float d = max(ndl, 0.0);
    #ifdef TOON
      // гладкое тело в два тона: граница света сглажена на ширину пикселя
      float aa = fwidth(ndl) * 1.5 + .02;
      d = smoothstep(.18 - aa, .18 + aa, ndl) * .82;
    #endif
    float sh = 1.0;
    #ifdef RECEIVE
      if (d > 0.0) sh = sunShadow(vWorld, n, d);
    #endif
    #ifdef PATTERN_SHADOWS
      sh *= mix(1.0, patternShadow(vWorld), step(0.0001, d));
    #endif

    vec3 amb = mix(uAmbGround, uAmbSky, n.y * .5 + .5);
    vec3 k = amb + uSun * d * sh + uExtra + lampLight(vWorld, n) + uLitNight * uLamps;

    #ifdef SNOW
      // снег ложится на то, что смотрит вверх
      float cover = uSnow * smoothstep(.55, .85, n.y) * openSky(vWorld);
      base = mix(base, vec3(.93, .95, .97), cover);
    #endif
    vec3 col = base * softCeiling(k);
    #ifdef WET
      // мокрая поверхность темнее и под скользящим взглядом отражает небо
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
      float wet = uWet * mix(1.0, openSky(vWorld), smoothstep(.5, .8, n.y));   // стены мокнут и под карнизом
      col = mix(col, col * .78, wet);
      col = mix(col, uSkyHorizon * (.55 + .45 * k.g), wet * fres * .55);
    #endif

    #ifdef GLASS
      // стекло: днём отражение неба (верх светлее) и косой блик; ночью — тёплый свет купе.
      // vUv — координаты внутри окна 0…1
      vec3 sky = mix(uSkyHorizon * .82, uSkyTop, smoothstep(.0, 1.0, vUv.y));
      vec3 day = sky * (.62 + .38 * clamp(uAmbSky.g * 1.6, 0.0, 1.0));
      vec3 night = mix(vec3(1.0, .85, .58), vec3(.95, .74, .45), vUv.y);
      vec3 glass = mix(day, night * 1.02, uLamps);
      // затемнение («шторка»): у склеенных стёкол — в красном канале цвета вершин, иначе — uGlassShade
      float shade = uGlassShade;
      #ifdef USE_COLOR
        shade = max(shade, vColor.r);
      #endif
      glass = mix(glass, glass * .42, shade);
      float diag = vUv.x * 1.2 - vUv.y * .5;
      float glint = stripes(diag * 2.2 + .3, .18, fwidth(diag * 2.2)) * (1.0 - uLamps) * (1.0 - shade);
      col = glass + glint * .16;
    #endif

    col += uEmissive + uEmissiveNight * uLamps;
    col = applyFog(col, vWorld, uHaze);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;
