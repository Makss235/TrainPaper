// Плёночное зерно поверх сцены. Тайл шума рисуется один раз на canvas: SVG-фильтр turbulence
// в фоне пересчитывался бы при каждой перерисовке неба и съедал половину кадров.

export function initGrain(node = document.getElementById("grain"), size = 256) {
  if (!node) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    let seed = 1234567;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // светлые и тёмные крапинки с разной прозрачностью: обычное наложение без mix-blend-mode,
      // которое на каждом кадре заставляло бы перерисовывать весь экран под зерном
      const v = ((seed >> 16) & 0xff) * .6 + ((seed >> 8) & 0xff) * .4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 128 ? 255 : 0;
      img.data[i + 3] = Math.abs(v - 128) * .36;
    }
    ctx.putImageData(img, 0, 0);
    node.style.backgroundImage = `url(${canvas.toDataURL("image/png")})`;
    node.style.backgroundSize = `${size}px ${size}px`;
  } catch {
    /* без зерна тоже хорошо */
  }
}
