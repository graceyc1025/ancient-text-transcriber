export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 25_000_000;

export async function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法打开，请确认是完整的 JPG 或 PNG。'));
    image.src = source;
  });
}

export async function inspectFile(file) {
  if (!/\.(jpe?g|png)$/i.test(file.name)) throw new Error('只支持 JPG / PNG。');
  if (file.name.length > 255) throw new Error('文件名超过 255 字符，请先缩短。');
  if (file.size > MAX_FILE_BYTES) throw new Error('超过 20 MB，请缩小或分批。');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new Error('文件内容不是 JPG / PNG，不能只修改扩展名。');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error('超过 2500 万像素，请缩小或分区。');
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function cropCanvas(image, bbox) {
  const [x, y, w, h] = bbox;
  const left = Math.round(x * image.naturalWidth), top = Math.round(y * image.naturalHeight);
  const width = Math.round((x + w) * image.naturalWidth) - left, height = Math.round((y + h) * image.naturalHeight) - top;
  if (width < 5 || height < 5) throw new Error('框选区域太小，请重新框选。');
  const factor = Math.min(2, 2400 / Math.max(width, height));
  const scale = factor > 1 ? factor : Math.min(1, factor);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法创建图像画布，请更换较新的浏览器。');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return { canvas, bounds: [left / image.naturalWidth, top / image.naturalHeight, width / image.naturalWidth, height / image.naturalHeight], resized: scale < 1 };
}

export async function wordImage(page) {
  const image = await loadImage(page.url);
  const scale = Math.min(1, 3000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0; canvas.height = 0;
  if (!blob) throw new Error('浏览器无法生成 Word 附图，请取消附图或减少图片数量。');
  return { data: new Uint8Array(await blob.arrayBuffer()), width: image.naturalWidth, height: image.naturalHeight };
}
