import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';

async function idle(page){await expect(page.locator('#runCurrent')).toBeEnabled({timeout:120_000});await expect(page.locator('#progress')).toHaveText('');}
async function records(page){await page.locator('#showRecords').click();const event=page.waitForEvent('download');await page.locator('#exportRecords').click();const result=JSON.parse(await readFile(await(await event).path(),'utf8'));await page.locator('#closeRecords').click();return result;}
async function prepare(page){page.on('dialog',d=>d.accept());await page.goto('./');await page.locator('#autoRun').uncheck();await page.locator('#ocrEngine').selectOption('paddle');await expect(page.locator('#ocrEngine')).toBeEnabled();await page.locator('#fileInput').setInputFiles('public/images/example.png');}

test('严格CSP、按需Paddle Worker真实OCR、原始记录、编辑与TXT/DOCX',async({page,context},info)=>{
  const requests=[],errors=[],violations=[];context.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>cspViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
  await prepare(page);
  expect(requests.some(r=>/\/paddle\/|traineddata|\/ocr\/runtime\//.test(r.url))).toBe(false);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).not.toContain("'unsafe-eval'");
  await page.evaluate(()=>{window.gaps=[];let t=performance.now();window.heartbeat=setInterval(()=>{const n=performance.now();gaps.push(n-t);t=n;},25);});
  await page.locator('#runCurrent').click();await idle(page);
  await expect(page.locator('#pageWarnings')).not.toContainText('本次识别失败');
  const text=await page.locator('.segment-text').inputValue();expect(text).toContain('學而時習');expect(text.indexOf('學')).toBeLessThan(text.indexOf('有朋'));expect(text.indexOf('有朋')).toBeLessThan(text.indexOf('人不知'));
  const record=await records(page),pass=record.history[0].passes[0];
  expect(pass.engine).toBe('paddle');expect(pass.confidenceMasking).toBe(false);expect(pass.raw.items.length).toBeGreaterThan(0);expect(pass.initialization.versions).toEqual({sdk:'0.4.2',ort:'1.24.3',wasm:'1.24.3'});expect(pass.raw.runtime.recProvider).toBe('wasm');expect(pass.rawText).not.toEqual(pass.sortedRaw);
  expect(requests.some(r=>r.url.includes('/paddle/runtime/sdk-worker.js'))).toBe(true);expect(requests.some(r=>/traineddata|\/ocr\/runtime\/|\/assets\/ocr-/.test(r.url))).toBe(false);
  expect(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:4173'&&['GET','HEAD'].includes(r.method))).toBe(true);
  violations.push(...await page.evaluate(()=>cspViolations));expect(violations).toEqual([]);expect(errors).toEqual([]);
  const beat=await page.evaluate(()=>{clearInterval(heartbeat);return {maxGapMs:Math.max(...gaps),samples:gaps.length};});await info.attach('响应性观测（桌面单次，不是手机保证）',{body:JSON.stringify(beat),contentType:'application/json'});
  await page.locator('.segment-text').fill('人工𠮷□異體㑹');
  const txt=page.waitForEvent('download');await page.locator('#exportTxt').click();expect(await readFile(await(await txt).path(),'utf8')).toContain('人工𠮷□異體㑹');
  const doc=page.waitForEvent('download');await page.locator('#exportDocx').click();const zip=await JSZip.loadAsync(await readFile(await(await doc).path()));expect(await zip.file('word/document.xml').async('string')).toContain('人工𠮷□異體㑹');
  expect((await records(page)).history).toEqual(record.history);
  await page.locator('#ocrEngine').selectOption('tesseract');await expect(page.locator('#ocrEngine')).toBeEnabled();await page.locator('#threshold').fill('0');await page.locator('#runCurrent').click();await idle(page);expect((await records(page)).history.map(r=>r.settings.engine)).toEqual(['paddle','tesseract']);
});

test('Paddle模型404保留人工底稿，明确失败并可切回真实Tesseract',async({page,context})=>{
  await prepare(page);await page.locator('.segment-text').fill('保留人工𠮷□');
  await context.route('**/paddle/models/PP-OCRv5_mobile_rec.tar',r=>r.fulfill({status:404,body:'missing'}));
  await page.locator('#runCurrent').click();await idle(page);await expect(page.locator('#pageWarnings')).toContainText('HTTP 404');await expect(page.locator('.segment-text')).toHaveValue('保留人工𠮷□');
  await page.locator('#ocrEngine').selectOption('tesseract');await expect(page.locator('#ocrEngine')).toBeEnabled();await page.locator('#threshold').fill('0');await page.locator('#runCurrent').click();await idle(page);await expect(page.locator('#pageWarnings')).not.toContainText('本次识别失败');expect((await page.locator('.segment-text').inputValue()).length).toBeGreaterThan(10);
});

test('模型下载等待期间硬取消，底稿保留且重新选择引擎可用',async({page,context})=>{
  let held;await context.route('**/paddle/models/PP-OCRv5_mobile_rec.tar',r=>{held=r;});
  await prepare(page);await page.locator('.segment-text').fill('取消保留□');await page.locator('#runCurrent').click();await expect.poll(()=>Boolean(held)).toBe(true);
  const begin=Date.now();await page.locator('#stopOCR').click();await idle(page);expect(Date.now()-begin).toBeLessThan(3000);await expect(page.locator('.segment-text')).toHaveValue('取消保留□');await expect(page.locator('#engineStatus')).toHaveText('本次识别已停止');
  await held.abort().catch(()=>{});await context.unroute('**/paddle/models/PP-OCRv5_mobile_rec.tar');
  await page.locator('#runCurrent').click();await idle(page);await expect(page.locator('#pageWarnings')).not.toContainText('本次识别失败');
});

test('故障注入：Worker推理永久阻塞可硬停止，内存错误有提示且保留编辑',async({page,context})=>{
  // No simulated recognition text. Only lifecycle/failure injection.
  const worker=oom=>`self.onmessage=e=>{const m=e.data;if(m.type==='init')self.postMessage({kind:'worker-transport-response',requestId:m.requestId,status:'success',payload:{summary:{},versions:{}}});else if(m.type==='predict'){${oom?"self.postMessage({kind:'worker-transport-response',requestId:m.requestId,status:'error',error:{message:'out of memory'}});":"for(;;){}"}}};`;
  await context.route('**/paddle/runtime/sdk-worker.js',r=>r.fulfill({contentType:'text/javascript',body:worker(false)}));
  await prepare(page);await page.locator('.segment-text').fill('原稿不丢□');await page.locator('#runCurrent').click();await expect(page.locator('#progress')).toContainText('检测与识别中');
  await page.locator('#stopOCR').click();await idle(page);await expect(page.locator('.segment-text')).toHaveValue('原稿不丢□');
  await context.unroute('**/paddle/runtime/sdk-worker.js');await context.route('**/paddle/runtime/sdk-worker.js',r=>r.fulfill({contentType:'text/javascript',body:worker(true)}));
  await page.locator('#runCurrent').click();await idle(page);await expect(page.locator('#pageWarnings')).toContainText('内存分配失败');await expect(page.locator('.segment-text')).toHaveValue('原稿不丢□');await expect(page.locator('#ocrEngine')).toBeEnabled();
});

test('Paddle批量与单独分区更新保留其他栏目，触屏模拟使用手机预算',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  try{
    await prepare(page);await page.locator('#fileInput').setInputFiles('public/images/example.png');
    await page.locator('.processing-panel summary').click();await page.locator('#ocrScale').selectOption('3');await page.locator('.processing-panel summary').click();
    await page.locator('#runPending').click();await idle(page);await expect(page.locator('.page-state')).toHaveText(['待校对','待校对']);
    const data=await records(page);expect(data.history[0].passes[0].processing.mobile).toBe(true);const[w,h]=data.history[0].passes[0].workingSize;expect(w*h).toBeLessThanOrEqual(1_500_000);
    await page.locator('.segment-text').fill('正文保持𠮷□');
    // Real pointer selection; framework mouse input is sufficient for this
    // region-update assertion. Existing suite separately tests touch gestures.
    await page.locator('#regionKind').selectOption('title');await page.locator('#drawRegion').click();await page.locator('#sourceImage').scrollIntoViewIfNeeded();const b=await page.locator('#sourceImage').boundingBox();
    await page.mouse.move(b.x+b.width*.72,b.y+b.height*.04);await page.mouse.down();await page.mouse.move(b.x+b.width*.98,b.y+b.height*.95);await page.mouse.up();
    await page.locator('.region-chip').getByRole('button',{name:'单独识别区域 1',exact:true}).click();await idle(page);
    await expect(page.locator('.segment-text')).toHaveCount(2);await expect(page.locator('.segment-text').first()).toHaveValue('正文保持𠮷□');expect((await page.locator('.segment-text').nth(1).inputValue()).length).toBeGreaterThan(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();}
});

test('版本不一致拒绝加载SDK，主线程看门狗可终止卡住的推理',async({page,context})=>{
  await context.route('**/paddle/config.json',async route=>{const response=await route.fetch(),json=await response.json();json.versions.wasm='1.22.0';await route.fulfill({json});});
  await prepare(page);await page.locator('.segment-text').fill('保留底稿□');await page.locator('#runCurrent').click();await idle(page);await expect(page.locator('#pageWarnings')).toContainText('ORT 与 WASM 版本不一致');
  await context.unroute('**/paddle/config.json');
  // Failure injection, no candidate text. Accelerate only the page watchdog;
  // the actual dedicated Worker remains blocked until the page terminates it.
  await context.route('**/paddle/runtime/sdk-worker.js',r=>r.fulfill({contentType:'text/javascript',body:"self.onmessage=e=>{const m=e.data;if(m.type==='init')self.postMessage({kind:'worker-transport-response',requestId:m.requestId,status:'success',payload:{summary:{}}});else for(;;){}};"}));
  await page.clock.install();await page.locator('#runCurrent').click();await expect(page.locator('#progress')).toContainText('检测与识别中');await page.clock.fastForward(90_001);await idle(page);
  await expect(page.locator('#pageWarnings')).toContainText('识别超过90秒');await expect(page.locator('.segment-text')).toHaveValue('保留底稿□');await expect(page.locator('#ocrEngine')).toBeEnabled();
});
