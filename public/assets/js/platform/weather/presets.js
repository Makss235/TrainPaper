// Погода — набор чисел, которые меняют небо, свет и осадки. Пресет = кнопка в панели настроек.
// Добавить свою погоду: новый ключ здесь (всё, что не указано, берётся из BASE) и подпись в WEATHER_LABELS.
//
// Поля:
//   cover        покрытие неба кучевыми облаками, 0…1
//   cloudOpacity непрозрачность облаков, 0…1
//   cloudDark    темнота основания облаков (тяжёлые дождевые), 0…1
//   cloudGray    облака серые, без яркой освещённой стороны, 0…1
//   cirrus       перистые облака высоко, 0…1
//   overcast     сплошная облачность: прячет солнце, луну и звёзды, 0…1
//   sun          сила прямого солнца (и теней), 0…1
//   dark         общее затемнение рассеянного света, 0…1
//   skyGray      небо уходит в серый, 0…1
//   skyDark      небо темнеет, 0…1
//   fogNear, fogFar  множители дальности дымки (меньше — гуще)
//   fogMax       добавка к предельной плотности дымки
//   rain, snow   сила осадков, 0…1
//   wet          платформа мокрая (темнее, отражает небо), 0…1
//   snowCover    снег на горизонтальных поверхностях, 0…1
//   lamps        фонари включаются днём (в сумрачную погоду), 0…1
//   wind         ветер [x, z], м/с — облака плывут, дождь косой

export const BASE = {
  cover: .35, cloudOpacity: .9, cloudDark: .1, cloudGray: 0, cirrus: .35, overcast: 0,
  sun: 1, dark: 0, skyGray: 0, skyDark: 0, fogNear: 1, fogFar: 1, fogMax: 0,
  rain: 0, snow: 0, wet: 0, snowCover: 0, lamps: 0, wind: [6, 2.5],
};

export const WEATHER = {
  clear:    { cover: .12, cloudOpacity: .75, cirrus: .5, wind: [4, 1.5] },
  partly:   {},
  cloudy:   { cover: .62, cloudOpacity: .95, cloudDark: .3, cloudGray: .25, cirrus: .1, sun: .55, dark: .05, skyGray: .2, wind: [7, 3] },
  overcast: { cover: .97, cloudOpacity: 1, cloudDark: .55, cloudGray: .9, cirrus: 0, overcast: 1, sun: .06, dark: .18,
              skyGray: .8, skyDark: .12, fogNear: .7, fogFar: .65, fogMax: .03, lamps: .15, wind: [8, 3] },
  rain:     { cover: 1, cloudOpacity: 1, cloudDark: .8, cloudGray: 1, cirrus: 0, overcast: 1, sun: 0, dark: .3,
              skyGray: .9, skyDark: .25, fogNear: .45, fogFar: .42, fogMax: .05, rain: 1, wet: 1, lamps: .45, wind: [11, 4] },
  snow:     { cover: 1, cloudOpacity: 1, cloudDark: .35, cloudGray: 1, cirrus: 0, overcast: 1, sun: .02, dark: .08,
              skyGray: .95, skyDark: .05, fogNear: .4, fogFar: .38, fogMax: .05, snow: 1, snowCover: .85, lamps: .3, wind: [3, 1] },
  fog:      { cover: .9, cloudOpacity: .7, cloudGray: 1, cirrus: 0, overcast: .9, sun: .12, dark: .1,
              skyGray: 1, skyDark: 0, fogNear: .08, fogFar: .14, fogMax: .07, wet: .3, lamps: .35, wind: [1, .5] },
};

export const WEATHER_LABELS = [
  ["clear", "Ясно"], ["partly", "Переменно"], ["cloudy", "Облачно"], ["overcast", "Пасмурно"],
  ["rain", "Дождь"], ["snow", "Снег"], ["fog", "Туман"],
];

export const weatherParams = key => ({ ...BASE, ...(WEATHER[key] || {}) });
