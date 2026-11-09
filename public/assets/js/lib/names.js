// @ts-check
// Названия станций из табло РЖД: «САНКТ-ПЕТЕРБУРГ-ГЛАВН.», «НИЖНИЙ НОВГОРОД МОСКОВ».

const EXPAND = {
  "ГЛАВН": "ГЛАВНЫЙ", "ЛАДОЖ": "ЛАДОЖСКИЙ", "ФИНЛЯН": "ФИНЛЯНДСКИЙ", "ФИНЛ": "ФИНЛЯНДСКИЙ",
  "БАЛТ": "БАЛТИЙСКИЙ", "ВИТЕБ": "ВИТЕБСКИЙ", "МОСКОВ": "МОСКОВСКИЙ", "ПАССАЖИРС": "ПАССАЖИРСКИЙ",
  "ЦЕНТР": "ЦЕНТРАЛЬНЫЙ", "ПАСС": "ПАСС.", "СОРТ": "СОРТ.", "ТОВ": "ТОВ.",
};
// слова, которые обозначают вокзал, а не город
const STATION_WORDS = /^(ГЛАВН\S*|ПАСС\S*|ЛАДОЖ\S*|ФИНЛ\S*|БАЛТ\S*|ВИТЕБ\S*|МОСКОВ\S*|ОКТЯБРЬСКАЯ|ЯРОСЛАВСКАЯ|КАЗАНСКАЯ|КУРСКАЯ|КИЕВСКАЯ|БЕЛОРУССКАЯ|ПАВЕЛЕЦКАЯ|РИЖСКАЯ|САВЕЛОВСКАЯ|ВК|ВОСТОЧНЫЙ|ЦЕНТР\S*|ЮЖН\S*|СЕВЕРН\S*|ГОРОД|СОРТ\S*|ТУР|ТЕРМИНАЛ|\(.*|\d+)$/;

const up = s => String(s || "").toUpperCase().replace(/Ё/g, "Е").trim();

/** Раскрывает сокращения РЖД: «САНКТ-ПЕТЕРБУРГ-ГЛАВН.» → «САНКТ-ПЕТЕРБУРГ-ГЛАВНЫЙ». */
export function expand(name) {
  return up(name)
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[А-Я]+\.?/g, word => EXPAND[word.replace(/\.$/, "")] ?? word)
    .replace(/\s+/g, " ").trim();
}

/** «САНКТ-ПЕТЕРБУРГ-ГЛАВНЫЙ» → «Санкт-Петербург-Главный», двухбуквенные сокращения остаются заглавными. */
export function title(name) {
  return expand(name).toLowerCase().replace(/(^|[\s\-(])([а-яa-z]+)/g, (m, sep, word) =>
    sep + (word.length <= 2 && /^(вк|мц|мцд)$/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)));
}

/** Город без названия вокзала: «МОСКВА ОКТЯБРЬСКАЯ» → «Москва». */
export function city(name) {
  const words = up(name).replace(/-/g, " - ").split(/\s+/).filter(Boolean);
  const kept = [];
  for (const [i, word] of words.entries()) {
    if (i > 0 && STATION_WORDS.test(word.replace(/\.$/, ""))) break;
    kept.push(word);
  }
  while (kept.length && kept[kept.length - 1] === "-") kept.pop();
  return title(kept.join(" ").replace(/ - /g, "-"));
}

/** Строки для таблички в окне: город и вокзал на разных строках, как на настоящих маршрутных досках. */
export function plateLines(name, max = 15) {
  const full = expand(name);
  if (full.length <= max) return [full];
  const cut = Math.max(full.lastIndexOf(" ", max + 1), full.lastIndexOf("-", max));
  if (cut <= 0) return [full];
  return full[cut] === "-" ? [full.slice(0, cut + 1), full.slice(cut + 1)] : [full.slice(0, cut), full.slice(cut + 1)];
}

const LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Латиница для второй строки на табличке станции: «Санкт-Петербург-Главный» → «Sankt-Peterburg-Glavny». */
export function translit(name) {
  return title(name)
    .replace(/([ыи])й(?=$|[\s-])/gi, (m, v) => (v === v.toUpperCase() ? "Y" : "y"))
    .replace(/[а-яё]/gi, ch => {
      const lower = ch.toLowerCase(), out = LAT[lower] ?? ch;
      return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
    });
}
