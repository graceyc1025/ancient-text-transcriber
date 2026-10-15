export function grayscale(r, g, b) { return Math.round(.299 * r + .587 * g + .114 * b); }

export function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let weight = 0, lowSum = 0, best = -1, threshold = 128;
  for (let i = 0; i < 255; i++) {
    weight += histogram[i]; lowSum += i * histogram[i];
    if (!weight || weight === gray.length) continue;
    const variance = weight * (gray.length - weight) * (lowSum / weight - (sum - lowSum) / (gray.length - weight)) ** 2;
    if (variance > best) { best = variance; threshold = i; }
  }
  return threshold;
}

export function localInk(gray, width, height, offset = 12) {
  const stride = width + 1, integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) { sum += gray[y * width + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; }
  }
  const radius = Math.max(8, Math.min(32, Math.round(height / 50))), ink = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x1 = Math.max(0, x - radius), x2 = Math.min(width, x + radius + 1), y1 = Math.max(0, y - radius), y2 = Math.min(height, y + radius + 1);
    const sum = integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
    ink[y * width + x] = gray[y * width + x] < sum / ((x2 - x1) * (y2 - y1)) - offset ? 1 : 0;
  }
  return ink;
}

export function processPixels(imageData, options = {}) {
  const { data, width, height } = imageData;
  const contrast = Math.max(50, Math.min(250, Number(options.contrast ?? 100))) / 100;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.max(0, Math.min(255, Math.round((grayscale(data[i*4], data[i*4+1], data[i*4+2]) - 128) * contrast + 128)));
  }
  let threshold = null, mask = null;
  if (options.binary === 'otsu') threshold = otsuThreshold(gray);
  if (options.binary === 'manual') threshold = Number(options.binaryThreshold ?? 160);
  if (options.binary === 'adaptive') mask = localInk(gray, width, height, Number(options.adaptiveOffset ?? 12));
  for (let i = 0; i < gray.length; i++) {
    if (options.grayscale || options.binary && options.binary !== 'none') {
      const value = mask ? (mask[i] ? 0 : 255) : threshold !== null ? (gray[i] <= threshold ? 0 : 255) : gray[i];
      data[i*4] = data[i*4+1] = data[i*4+2] = value;
    } else if (contrast !== 1) {
      for (let channel = 0; channel < 3; channel++) data[i*4+channel] = Math.max(0, Math.min(255, Math.round((data[i*4+channel]-128)*contrast+128)));
    }
    data[i*4+3] = 255;
  }
  return { imageData, threshold };
}

export function memoryBudget(mode = 'auto', mobile = false) {
  return mode === 'compact' || mode === 'auto' && mobile
    ? { maxPixels: 1_500_000, maxSide: 6000, name: '节省内存' }
    : { maxPixels: 5_000_000, maxSide: 8192, name: '标准' };
}

export function workingSize(width, height, scale, budget) {
  const requested = Math.max(.5, Math.min(3, Number(scale || 1)));
  const applied = Math.min(requested, budget.maxSide / Math.max(width, height), Math.sqrt(budget.maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * applied)), height: Math.max(1, Math.floor(height * applied)), scale: applied, limited: applied < requested - .001 };
}

// 分栏仅使用像素投影，不使用 OCR 内容或语言上下文；切线组成覆盖整区的分区。
export function columnPartitions(gray, width, height, count = 0) {
  if (count > 0) { const n=Math.min(30,Math.max(1,Math.round(count)));return Array.from({ length:n },(_,i)=>[i/n,(i+1)/n]); }
  const ink = localInk(gray, width, height), projection = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    let row = 0; for (let x = 0; x < width; x++) row += ink[y*width+x];
    if (row > width * .5) continue; // 版框横线仅不参与分栏测量，识别像素不删除。
    for (let x = 0; x < width; x++) projection[x] += ink[y*width+x];
  }
  const smooth = new Float64Array(width), radius = Math.max(1, Math.round(width / 300));
  for (let x = 0; x < width; x++) { for (let dx=-radius;dx<=radius;dx++) if(x+dx>=0&&x+dx<width)smooth[x]+=projection[x+dx];smooth[x]/=radius*2+1; }
  const max = Math.max(...smooth), cutoff = Math.max(3, height * .01, max * .14), spans = [];
  let start = null;
  for (let x = 0; x <= width; x++) {
    if (x < width && smooth[x] >= cutoff) { if(start===null)start=x; }
    else if (start !== null) { if(x-start>=Math.max(5,height*.008))spans.push([start,x]);start=null; }
  }
  // 少于两条有效带或复杂版式过多时不擅自切分；所有内容交由整区识别。
  if (spans.length < 2 || spans.length > 30) return [[0,1]];
  const cuts = [0, ...spans.slice(1).map((span,i)=>(spans[i][1]+span[0])/2/width), 1];
  return cuts.slice(0,-1).map((left,i)=>[left,cuts[i+1]]);
}
