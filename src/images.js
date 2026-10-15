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
    const canvas=document.createElement('canvas'), ratio=Math.min(1,120/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const result={ url, thumbnailURL:blob?URL.createObjectURL(blob):url,width:image.naturalWidth,height:image.naturalHeight };
    canvas.width=0;canvas.height=0;image.src='';return result;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function cropCanvas(image, bbox, processing = null) {
  const [x, y, w, h] = bbox;
  const left = Math.round(x * image.naturalWidth), top = Math.round(y * image.naturalHeight);
  const width = Math.round((x + w) * image.naturalWidth) - left, height = Math.round((y + h) * image.naturalHeight) - top;
  if (width < 5 || height < 5) throw new Error('框选区域太小，请重新框选。');
  const factor = Math.min(2, 2400 / Math.max(width, height));
  const size = processing ? workingSize(width, height, processing.scale, processing.preview?{maxPixels:1_000_000,maxSide:1400}:memoryBudget(processing.memory, processing.mobile)) : {width:Math.round(width*factor),height:Math.round(height*factor),limited:factor<1};
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1,size.width); canvas.height = Math.max(1,size.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法创建图像画布，请更换较新的浏览器。');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
  let threshold=null;
  if(processing && (processing.grayscale || processing.binary!=='none' || Number(processing.contrast)!==100)) {
    const output=processPixels(context.getImageData(0,0,canvas.width,canvas.height),processing);context.putImageData(output.imageData,0,0);threshold=output.threshold;
  }
  return { canvas, bounds: [left / image.naturalWidth, top / image.naturalHeight, width / image.naturalWidth, height / image.naturalHeight], resized: size.limited, threshold };
}

export function splitColumns(image,bbox,processing={},count=0) {
  const [x,y,w,h]=bbox, width=Math.max(1,Math.round(image.naturalWidth*w)),height=Math.max(1,Math.round(image.naturalHeight*h));
  const ratio=Math.min(1,1000/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,x*image.naturalWidth,y*image.naturalHeight,width,height,0,0,canvas.width,canvas.height);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height);
  if(processing.grayscale||processing.binary&&processing.binary!=='none'||Number(processing.contrast??100)!==100)processPixels(data,processing);
  const gray=new Uint8Array(canvas.width*canvas.height);for(let i=0;i<gray.length;i++)gray[i]=grayscale(data.data[i*4],data.data[i*4+1],data.data[i*4+2]);
  const partitions=columnPartitions(gray,canvas.width,canvas.height,count);canvas.width=0;canvas.height=0;
  return partitions.map(([left,right])=>[x+left*w,y,(right-left)*w,h]).reverse();
}

export async function makeProcessingPreview(page,processing) {
  const image=await loadImage(page.url),{canvas}=cropCanvas(image,[0,0,1,1],{...processing,scale:1,preview:true});
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=0;canvas.height=0;image.src='';
  if(!blob)throw new Error('无法生成预处理预览，请减少图片大小。');
  return URL.createObjectURL(blob);
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
  const result={ data:new Uint8Array(await blob.arrayBuffer()),width:image.naturalWidth,height:image.naturalHeight };image.src='';return result;
}
import { processPixels, memoryBudget, workingSize, grayscale, columnPartitions } from './processing.js';
