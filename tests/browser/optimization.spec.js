import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function idle(page){await expect(page.locator('#runCurrent')).toBeEnabled({timeout:150_000});await expect(page.locator('#progress')).toHaveText('');}
async function rectangle(page,box,kind='body'){
  await page.locator('#regionKind').selectOption(kind);await page.locator('#drawRegion').click();
  await page.locator('#sourceImage').scrollIntoViewIfNeeded();const b=await page.locator('#sourceImage').boundingBox();
  await page.mouse.move(b.x+b.width*box[0],b.y+b.height*box[1]);await page.mouse.down();
  await page.mouse.move(b.x+b.width*(box[0]+box[2]),b.y+b.height*(box[1]+box[3]),{steps:8});await page.mouse.up();
}
async function records(page){await page.locator('#showRecords').click();const event=page.waitForEvent('download');await page.locator('#exportRecords').click();const data=JSON.parse(await readFile(await (await event).path(),'utf8'));await page.locator('#closeRecords').click();return data;}

test('分栏、预处理预览、独立区域更新、原始 OCR 留存与停止',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('./');await page.locator('#autoRun').uncheck();
  await page.locator('#fileInput').setInputFiles('public/images/example.png');await expect(page.locator('#sourceImage')).toBeVisible();
  const original=await page.locator('#sourceImage').getAttribute('src');await page.locator('.processing-panel summary').click();
  await page.locator('#grayscale').check();await page.locator('#binaryMode').selectOption('otsu');await page.locator('#previewProcessing').click();await idle(page);
  expect(await page.locator('#sourceImage').getAttribute('src')).not.toBe(original);await expect(page.locator('#imageView')).toHaveValue('processed');
  await page.locator('#binaryMode').selectOption('none');await expect(page.locator('#imageView')).toHaveValue('original');await expect(page.locator('#sourceImage')).toHaveAttribute('src',original);
  await page.locator('#grayscale').uncheck();await page.locator('#recognitionMode').selectOption('columns');await page.locator('#analyzeColumns').click();await idle(page);await expect(page.locator('.column-box')).toHaveCount(3);
  await page.locator('#runCurrent').click();await idle(page);const first=await records(page);
  expect(first.history).toHaveLength(1);expect(first.history[0].passes).toHaveLength(3);
  const passes=first.history[0].passes;expect(passes[0].bbox[0]).toBeGreaterThan(passes[1].bbox[0]);expect(passes[1].bbox[0]).toBeGreaterThan(passes[2].bbox[0]);
  expect(passes.reduce((n,p)=>n+p.bbox[2],0)).toBeCloseTo(1);expect(passes.every(p=>p.model==='chi_tra_vert'&&p.psm==='5'&&/^5\t/m.test(p.rawTSV))).toBe(true);
  await page.locator('#showDetected').check();expect(await page.locator('.detected-box').count()).toBeGreaterThan(10);
  await rectangle(page,[.72,.06,.22,.6],'title');await page.locator('.region-chip').getByRole('button',{name:'单独识别区域 1',exact:true}).click();await idle(page);
  await expect(page.locator('.segment-text')).toHaveCount(2);await page.locator('.segment-text').first().fill('正文人工底稿𠮷□');await page.locator('.segment-text').nth(1).fill('标题人工底稿');
  await page.getByLabel('区域 1 PSM',{exact:true}).selectOption('3');await page.locator('.region-chip').getByRole('button',{name:'单独识别区域 1',exact:true}).click();await idle(page);
  await expect(page.locator('.segment-text').first()).toHaveValue('正文人工底稿𠮷□');expect(await page.locator('.segment-text').nth(1).inputValue()).not.toBe('标题人工底稿');
  const latest=await records(page);expect(latest.history).toHaveLength(3);expect(latest.history[0]).toEqual(first.history[0]);expect(latest.history[2].passes[0].psm).toBe('3');
  await page.locator('.segment-text').nth(1).fill('停止后保留');await page.getByLabel('区域 1 PSM',{exact:true}).selectOption('5');await page.locator('.region-chip').getByRole('button',{name:'单独识别区域 1',exact:true}).click();
  await expect(page.locator('.region-chip button').first()).toBeDisabled();await page.locator('#stopOCR').click();await idle(page);
  await expect(page.locator('#engineStatus')).toHaveText('本次识别已停止');await expect(page.locator('.segment-text').nth(1)).toHaveValue('停止后保留');
  await page.screenshot({path:info.outputPath('columns-diagnostics.png'),fullPage:true});expect(errors).toEqual([]);
});

test('手机触屏模拟：真实触控框选、竖排 OCR、预算与编辑导出',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});const page=await context.newPage();
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>requests.push(r));
  try{
    await page.goto('http://127.0.0.1:4173/ancient-text-transcriber/');await page.locator('#autoRun').uncheck();await page.locator('#fileInput').setInputFiles('public/images/example.png');
    await page.locator('.processing-panel summary').click();await page.locator('#ocrScale').selectOption('3');await page.locator('.processing-panel summary').click();
    await page.locator('#drawRegion').click();await page.locator('#sourceImage').scrollIntoViewIfNeeded();const box=await page.locator('#sourceImage').boundingBox();const cdp=await context.newCDPSession(page);
    const touch=(x,y)=>[{x,y,radiusX:2,radiusY:2,force:1,id:0}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(box.x+box.width*.01,box.y+box.height*.01)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(box.x+box.width*.99,box.y+box.height*.98)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.region-chip')).toHaveCount(1);
    await page.locator('#runCurrent').click();await idle(page);expect((await page.locator('.segment-text').inputValue()).length).toBeGreaterThan(10);
    const data=await records(page);expect(data.history[0].passes[0].processing.mobile).toBe(true);expect(data.history[0].passes[0].memoryLimited).toBe(true);
    const[w,h]=data.history[0].passes[0].workingSize;expect(w*h).toBeLessThanOrEqual(1_500_000);
    await page.locator('.segment-text').fill('手機校勘𠮷□');const event=page.waitForEvent('download');await page.locator('#exportTxt').click();expect(await readFile(await(await event).path(),'utf8')).toContain('手機校勘𠮷□');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('mobile-touch.png'),fullPage:true});
    expect(requests.every(r=>new URL(r.url()).origin==='http://127.0.0.1:4173'&&['GET','HEAD'].includes(r.method()))).toBe(true);expect(errors).toEqual([]);
  }finally{await context.close();}
});
