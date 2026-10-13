import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportDOCX, exportTXT } from '../src/exporting.js';

const project = {title:'清代校勘',pages:[{filename:'乙.png',status:'reviewed',segments:[{kind:'body',text:'學𠮷□\n異體㑹'}]},{filename:'甲.png',status:'done',segments:[{kind:'center',text:'卷一'}]}]};
// 两个不同色的真实 PNG，测试图片与文字在 Word 中的配对，不模拟 OCR。
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const png2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYd0AAAAASUVORK5CYII=', 'base64');

test('浏览器 TXT Blob 保留 BOM 和原文字', async () => {
  const blob = exportTXT(project), bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,3)], [239,187,191]); assert.ok((await blob.text()).includes('學𠮷□\n異體㑹'));
});
test('DOCX 可解压，页序、Unicode、两张附图及栏目正确', async () => {
  const blob = await exportDOCX(project,[{data:png1,width:1,height:1},{data:png2,width:1,height:1}]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.indexOf('乙.png') < xml.indexOf('學𠮷□') && xml.indexOf('學𠮷□') < xml.indexOf('甲.png')); assert.ok(xml.includes('異體㑹') && xml.includes('卷一'));
  assert.equal((xml.match(/<w:drawing>/g)||[]).length,2);
  const images = Object.values(zip.files).filter(f=>!f.dir && f.name.startsWith('word/media/') && f.name.endsWith('.png'));
  assert.equal(images.length,2); assert.ok(Buffer.from(await images[0].async('uint8array')).equals(png1)); assert.ok(Buffer.from(await images[1].async('uint8array')).equals(png2));
});
test('DOCX 支持不附图，并拒绝数量不符或非法文字', async () => {
  const blob=await exportDOCX(project), zip=await JSZip.loadAsync(await blob.arrayBuffer());assert.ok(!(await zip.file('word/document.xml').async('string')).includes('<w:drawing>'));
  await assert.rejects(()=>exportDOCX(project,[{data:png1,width:1,height:1}]));
  const broken=structuredClone(project);broken.pages[0].segments[0].text='字\0字';await assert.rejects(()=>exportDOCX(broken));
});
