import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTSV, sortRegions, txtContent, validXMLText, validateRegions } from '../src/transcription.js';
import { assetURL } from '../src/assets.js';

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
const line = (block, x, y, text, confidence = 95) => `4\t1\t${block}\t1\t1\t0\t${x}\t${y}\t20\t30\t-1\t\n5\t1\t${block}\t1\t1\t1\t${x}\t${y}\t20\t30\t${confidence}\t${text}\n`;

test('竖排按右至左，同列碎片按上至下，保留原有标点', () => {
  const result = parseTSV(header + line(1, 80, 60, '下。') + line(2, 78, 10, '上') + line(3, 20, 10, '左'), 65);
  assert.equal(result.text, '上\n下。\n左');
});
test('低置信度整组逐字替换，Unicode 扩展字不重复计数', () => {
  const result = parseTSV(header + line(1, 80, 10, '學𠮷', 20), 65);
  assert.equal(result.text, '□□'); assert.equal(result.detectedCharacters, 2); assert.equal(result.uncertain[0].characters, 2);
});
test('横排阅读顺序与繁体、标点原样保留', () => {
  assert.equal(parseTSV(header + line(1, 80, 10, '異體，') + line(2, 10, 10, '學') + line(3, 10, 80, '遠'), 0, 'horizontal').text, '學\n異體，\n遠');
});
test('没有检测字时返回空结果，有效 TSV 必须存在', () => {
  assert.equal(parseTSV(header, 65).text, ''); assert.throws(() => parseTSV(null, 65)); assert.throws(() => parseTSV('garbage',65));
});
test('接受真实 WASM GetTSVText 不带 CLI 表头的输出', () => {
  assert.equal(parseTSV(line(1,80,10,'繁體'),65).text,'繁體');
});
test('框选验证及分区顺序不更改原数组', () => {
  const regions = [{ kind: 'body', bbox: [0, 0, .4, 1] }, { kind: 'title', bbox: [.6, 0, .4, 1] }];
  validateRegions(regions); assert.equal(sortRegions(regions, 'vertical')[0].kind, 'title'); assert.equal(regions[0].kind, 'body');
  for (const bbox of [[0,0,-1,1], [.8,0,.4,1], [NaN,0,.5,1]]) assert.throws(() => validateRegions([{kind:'body',bbox}]));
});
test('TXT 保留最终页序、异体字、编辑内容和校对状态', () => {
  const text = txtContent({title:'研究',pages:[{filename:'乙.png',status:'reviewed',segments:[{kind:'center',text:'異體㑹□\n學'}]},{filename:'甲.png',status:'pending',segments:[]}]});
  assert.ok(text.startsWith('\ufeff')); assert.ok(text.indexOf('乙.png') < text.indexOf('甲.png')); assert.ok(text.includes('異體㑹□\n學')); assert.ok(text.includes('尚未转录')); assert.ok(text.includes('已人工校对'));
});
test('Word 不默默丢弃控制字符，保留合法 Unicode 扩展字', () => {
  assert.ok(validXMLText('學𠮷□\n')); assert.equal(validXMLText('字\0字'),false); assert.equal(validXMLText('\ud800'), false);
});
test('Worker、模型和样例 URL 在 Pages 子路径或域名根均正确', () => {
  for (const base of ['https://user.github.io/ancient-text-transcriber/', 'https://example.org/']) {
    assert.equal(assetURL('ocr/runtime/worker.min.js','./',base),base+'ocr/runtime/worker.min.js');
    assert.equal(assetURL('ocr/tessdata/chi_tra_vert.traineddata.gz','./',base),base+'ocr/tessdata/chi_tra_vert.traineddata.gz');
  }
});
