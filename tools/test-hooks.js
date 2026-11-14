// Хук загрузчика модулей для тестов: "three" и "three/addons/…" → public/vendor/three/.
// @ts-check
const VENDOR = new URL("../public/vendor/three/", import.meta.url);

/**
 * @param {string} specifier @param {any} context @param {(s: string, c: any) => any} next
 */
export async function resolve(specifier, context, next) {
  if (specifier === "three") return { url: new URL("three.module.min.js", VENDOR).href, shortCircuit: true, format: "module" };
  if (specifier.startsWith("three/addons/")) return { url: new URL(specifier.slice("three/".length), VENDOR).href, shortCircuit: true, format: "module" };
  return next(specifier, context);
}
