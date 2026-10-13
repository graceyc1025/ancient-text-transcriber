export const KINDS = { body: '正文', title: '标题', page: '页码', center: '版心', other: '其他版面信息' };
export const STATUS = { pending: '尚未转录', done: '待人工校对', reviewed: '已人工校对', error: '识别失败' };

export function parseTSV(tsv, threshold, orientation = 'vertical') {
  if (typeof tsv !== 'string') throw new Error('OCR 没有返回有效的文字坐标结果，请重试。');
  // WASM GetTSVText 不附 CLI 的表头；也接受带表头的格式。
  const rows = tsv.trimEnd().split('\n');
  if (rows[0].startsWith('level\t')) rows.shift();
  if (rows[0] && (!/^[1-5]\t/.test(rows[0]) || rows[0].split('\t').length < 11)) throw new Error('OCR 返回了无效的坐标格式。');
  const lines = new Map(), boxes = new Map(), uncertain = [];
  let detectedCharacters = 0;
  for (const row of rows) {
    const values = row.replace(/\r$/, '').split('\t');
    if (values.length < 12) continue;
    const [level, page, block, paragraph, line, order, left, top, width, height, confidence] = values.slice(0, 11).map(Number);
    const key = `${page}/${block}/${paragraph}/${line}`, bbox = [left, top, width, height];
    if (level === 4) boxes.set(key, bbox);
    const text = values.slice(11).join('\t');
    if (level !== 5 || !text.trim()) continue;
    const characters = Array.from(text).length;
    detectedCharacters += characters;
    let output = text;
    if (!Number.isFinite(confidence) || confidence < threshold) {
      output = '□'.repeat(characters);
      uncertain.push({ bbox, confidence, characters });
    }
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ text: output, bbox, order });
  }
  const getBox = key => boxes.get(key) ?? lines.get(key)[0].bbox;
  const isVertical = orientation === 'vertical';
  const position = key => {
    const [x, y, w, h] = getBox(key);
    return isVertical ? [-(x + w / 2), y] : [y + h / 2, x];
  };
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
  const groups = [];
  for (const key of [...lines.keys()].sort((a, b) => compare(position(a), position(b)))) {
    const [x, y, w, h] = getBox(key);
    const center = isVertical ? x + w / 2 : y + h / 2, extent = isVertical ? w : h;
    const group = groups.find(g => Math.abs(g.center - center) <= .6 * Math.min(g.extent, extent));
    if (group) group.keys.push(key);
    else groups.push({ center, extent, keys: [key] });
  }
  const ordered = groups.flatMap(g => g.keys.sort((a, b) => getBox(a)[isVertical ? 1 : 0] - getBox(b)[isVertical ? 1 : 0]));
  const text = ordered.map(key => lines.get(key).sort((a, b) => a.order - b.order).map(word => word.text).join('')).join('\n');
  return { text, uncertain, detectedCharacters };
}

export function sortRegions(regions, orientation) {
  return [...regions].sort((a, b) => orientation === 'vertical'
    ? (b.bbox[0] + b.bbox[2] / 2) - (a.bbox[0] + a.bbox[2] / 2) || a.bbox[1] - b.bbox[1]
    : a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

export function validateRegions(regions) {
  if (!Array.isArray(regions) || regions.length > 30) throw new Error('每页最多 30 个分区。');
  for (const region of regions) {
    if (!(region.kind in KINDS) || !Array.isArray(region.bbox) || region.bbox.length !== 4 || !region.bbox.every(Number.isFinite)) throw new Error('分区数据无效。');
    const [x, y, w, h] = region.bbox;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.00001 || y + h > 1.00001) throw new Error('框选区域必须在图片内。');
  }
}

export function formatPage(page) {
  return page.segments.map(segment => `【${KINDS[segment.kind]}】\n${segment.text}`).join('\n\n');
}

export function txtContent(project) {
  const parts = [project.title, '说明：方括号内的栏目为工具标签，不属于原文；换行保留识别列序；□为待确认字。'];
  project.pages.forEach((page, index) => {
    parts.push('', `【图像 ${String(index + 1).padStart(2, '0')}】${page.filename}`, `【校对状态】${STATUS[page.status]}`, formatPage(page));
  });
  return '\ufeff' + parts.join('\n') + '\n';
}

export function validXMLText(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)) return false;
  return Array.from(text).every(char => !(char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff));
}
