// Вагон или локомотив из своей 3D-модели (glTF/GLB, например из Blender).
//
//   import { modelCar } from "./cars/model.js";
//   registerCar("sapsan-head", modelCar({
//     name: "Сапсан, головной", url: "../assets/models/sapsan-head.glb",
//     length: 25.5,            // длина кузова, м
//     gap: .6,                 // промежуток до следующего вагона, м
//     offset: [0, 0, 0],       // сдвиг модели, если её начало координат не у торца z = 0
//     rotation: [0, 0, 0],     // поворот модели, ° (если в Blender она смотрела не вдоль +z)
//     headLights: true,        // у вагона кабина (тогда не ставится заглушка перехода и т. п.)
//   }));
//
// Оси модели: z — вдоль вагона от торца 0 (хвостовой) до length (передний), x — поперёк, y — вверх,
// 0 — головка рельса. Модель грузится в фоне: пока её нет, вагон пустой; когда загрузится — сцена
// перерисуется сама. Материалы переводятся в стиль сцены (см. engine/assets.js).
import * as THREE from "three";
import { loadModel } from "../../engine/assets.js";
import { transform } from "../../engine/geometry.js";
import { castShadow } from "../../engine/shadows.js";

export function modelCar({ name, url, length, gap = .64, offset = [0, 0, 0], rotation = [0, 0, 0], scale = 1, ...rest }) {
  return {
    name, length, gap, ...rest,
    build() {
      const group = new THREE.Group();
      loadModel(url).then(model => {
        model.applyMatrix4(transform(offset, rotation, scale));
        castShadow(model);
        group.add(model);
        dispatchEvent(new Event("trainpaper:invalidate"));        // main.js перерисует сцену и тени
      }).catch(error => console.error(`Модель вагона «${name}» (${url}):`, error));
      return group;
    },
  };
}
