// Загрузка своих 3D-моделей (glTF 2.0: .glb или .gltf). Загрузчик подгружается только тогда,
// когда в сцене есть модель, — без моделей он не скачивается вовсе.
//
// Как подготовить модель в Blender:
//  - единицы — метры, ось Y вверх (экспорт glTF так и делает по умолчанию);
//  - начало координат модели — там, куда её ставить (обычно у земли);
//  - материалы: важен только базовый цвет (Base Color) и, если нужна, текстура — свет, тени и дымку
//    добавит сцена; металличность и шероховатость не учитываются;
//  - материал с «glass» в имени станет стеклом окна, с «night» и Emission — светится только ночью;
//  - объект с «smooth» в имени сохранит сглаженные нормали (иначе грани плоские, в стиле сцены).
import { stylizeModel } from "./materials.js";

let loaderPromise = null;
const cache = new Map();

function loader() {
  return loaderPromise ||= import("three/addons/loaders/GLTFLoader.js").then(m => new m.GLTFLoader());
}

/** Модель по адресу url, переведённая в стиль сцены. Каждый вызов — своя копия (клон). */
export async function loadModel(url, opts = {}) {
  if (!cache.has(url)) {
    cache.set(url, loader().then(l => l.loadAsync(url)).then(gltf => stylizeModel(gltf.scene, opts)));
  }
  const root = await cache.get(url);
  return root.clone(true);
}
