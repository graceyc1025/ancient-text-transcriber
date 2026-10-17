import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function waitForOCR(page, count) {
  await page.waitForFunction(n => {
    const states=[...document.querySelectorAll('.page-state')].map(e=>e.textContent);
    return states.length===n && states.every(s=>['待校对','已校对','识别失败'].includes(s)) && document.querySelector('#progress').textContent==='';
  },count,{timeout:150_000});
  await expect(page.locator('.page-state')).toHaveText(Array(count).fill('待校对'));
}

test('Pages 子路径下真实本地 OCR、JPG/PNG 批量、校勘、复制、分区与导出', async ({ page, context }, testInfo) => {
  const requests = [], errors = [];
  context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('./');
  await expect(page.locator('#engineStatus')).toContainText('浏览器本地 OCR');
  await page.screenshot({ path: testInfo.outputPath('upload.png'), fullPage: true });
  const png = await readFile('public/images/example.png');
  const jpg = await page.evaluate(async () => {
    const image = new Image();image.src = './images/example.png';await image.decode();
    const canvas = document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.locator('#threshold').fill('0');
  await page.locator('#fileInput').setInputFiles([{name:'甲.png',mimeType:'image/png',buffer:png},{name:'乙.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpg,'base64')}]);
  await expect(page.locator('#pageCount')).toHaveText('2 页');
  await waitForOCR(page,2);
  const recognized = await page.locator('.segment-text').first().inputValue();
  expect(recognized).toContain('學');expect(recognized).toContain('習');expect(recognized).toContain('遠');
  expect(recognized.indexOf('學')).toBeLessThan(recognized.indexOf('遠'));
  await testInfo.attach('实际 OCR 原始输出（阈值0，不是准确率承诺）', {body:recognized,contentType:'text/plain'});
  await page.locator('.page-item').nth(1).getByRole('button',{name:'向前移动图片'}).click();
  await expect(page.locator('.page-name').first()).toContainText('乙.jpg');
  await page.locator('.page-info').nth(1).click();
  await page.locator('#zoomIn').click();await expect(page.locator('#zoomValue')).toHaveText('125%');
  await page.locator('#zoomOut').click();await expect(page.locator('#zoomValue')).toHaveText('100%');
  const edited='學𠮷□\n異體㑹';
  await page.locator('.segment-text').first().fill(edited);
  await page.locator('#addSegment').click();await page.locator('.segment-kind').nth(1).selectOption('center');await page.locator('.segment-text').nth(1).fill('卷一');
  await page.locator('#reviewed').check();await expect(page.locator('#resultStatus')).toHaveText('已校对');
  await page.locator('#copyCurrent').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(edited);
  await page.screenshot({ path: testInfo.outputPath('comparison.png'), fullPage: true });
  const txtDownload=page.waitForEvent('download');await page.locator('#exportTxt').click();const txtFile=await txtDownload;
  const txt=await readFile(await txtFile.path(),'utf8');expect(txt).toContain(edited);expect(txt).toContain('【版心】\n卷一');expect(txt.indexOf('乙.jpg')).toBeLessThan(txt.indexOf('甲.png'));
  const wordDownload=page.waitForEvent('download');await page.locator('#exportDocx').click();const wordFile=await wordDownload;
  const zip=await JSZip.loadAsync(await readFile(await wordFile.path()));const xml=await zip.file('word/document.xml').async('string');
  expect(xml).toContain('學𠮷□');expect(xml).toContain('異體㑹');expect(xml).toContain('卷一');expect((xml.match(/<w:drawing>/g)||[]).length).toBe(2);expect(xml.indexOf('乙.jpg')).toBeLessThan(xml.indexOf('甲.png'));
  await page.locator('#includeImages').uncheck();const textOnlyDownload=page.waitForEvent('download');await page.locator('#exportDocx').click();const textOnlyZip=await JSZip.loadAsync(await readFile(await (await textOnlyDownload).path()));expect(await textOnlyZip.file('word/document.xml').async('string')).not.toContain('<w:drawing>');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#regionKind').selectOption('title');await page.locator('#drawRegion').click();
  await page.locator('#sourceImage').scrollIntoViewIfNeeded();const box=await page.locator('#sourceImage').boundingBox();
  await page.mouse.move(box.x+box.width*.77,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.9,box.y+Math.min(box.height*.7,330),{steps:10});await page.mouse.up();
  await expect(page.locator('.region-chip')).toHaveCount(1);await page.locator('#threshold').fill('65');await page.locator('#runCurrent').click();
  await expect(page.locator('#progress')).toHaveText('',{timeout:150_000});await expect(page.locator('.segment-kind')).toHaveValue('title');await expect(page.locator('#reviewed')).not.toBeChecked();
  expect((await page.locator('.segment-text').inputValue()).length).toBeGreaterThan(0);
  expect(requests.some(request=>request.url.includes('chi_tra_vert.traineddata.gz'))).toBe(true);
  expect(requests.some(request=>request.url.includes('/ocr/runtime/worker.min.js'))).toBe(true);
  expect(requests.every(request=>new URL(request.url).origin==='http://127.0.0.1:4173')).toBe(true);
  expect(requests.every(request=>['GET','HEAD'].includes(request.method))).toBe(true);
  expect(requests.some(request=>request.url.includes('/api/'))).toBe(false);
  expect(requests.some(request=>request.url.includes('/paddle/'))).toBe(false);
  expect(errors).toEqual([]);
});

test('拒绝伪造 PNG，模型加载失败时保留人工底稿并支持手工导出', async ({page,context}) => {
  page.on('dialog',dialog=>dialog.accept());await page.goto('./');await page.locator('#autoRun').uncheck();
  await page.locator('#fileInput').setInputFiles({name:'坏图.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await expect(page.locator('#toast')).toContainText('文件内容不是 JPG / PNG');await expect(page.locator('#pageCount')).toHaveText('0 页');
  await page.locator('#fileInput').setInputFiles('public/images/example.png');await page.locator('.segment-text').fill('人工校勘□');
  await context.route('**/ocr/runtime/core/*.wasm.js',route=>route.abort());await page.locator('#runCurrent').click();
  await expect(page.locator('#pageWarnings')).toContainText('本次识别失败',{timeout:30_000});await expect(page.locator('.segment-text')).toHaveValue('人工校勘□');
  const download=page.waitForEvent('download');await page.locator('#exportTxt').click();expect(await readFile(await (await download).path(),'utf8')).toContain('人工校勘□');
});

test('水平繁体模型实际识别横排图，内置竖排演示入口可用', async ({page}) => {
  await page.goto('./');await page.locator('#orientation').selectOption('horizontal');await page.locator('#threshold').fill('0');
  await page.locator('#fileInput').setInputFiles('public/images/horizontal-example.png');
  await waitForOCR(page,1);
  const text=await page.locator('.segment-text').inputValue();expect(text).toContain('學');expect(text).toContain('朋');expect(text.indexOf('學')).toBeLessThan(text.indexOf('朋'));
  await page.locator('#autoRun').uncheck();await page.locator('#sampleButton').evaluate(element=>element.style.display='inline-block');await page.locator('#sampleButton').click();await expect(page.locator('#pageCount')).toHaveText('2 页');
});
