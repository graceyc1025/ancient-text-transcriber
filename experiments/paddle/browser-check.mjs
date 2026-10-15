import{chromium}from'@playwright/test';import{spawn}from'node:child_process';import{readFile,writeFile,mkdir}from'node:fs/promises';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';
const here=fileURLToPath(new URL('./',import.meta.url)),base='http://127.0.0.1:4182/ancient-text-transcriber/experiments/paddle/';
const server=spawn(process.execPath,['serve.mjs'],{cwd:here,env:{...process.env,EXPERIMENT_PORT:'4182'},stdio:'ignore'});let browser;
try{
  let ready=false;for(let i=0;i<30;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert(ready);
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});const checks=[];
  for(const mobile of [false,true]){
    const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{}),page=await context.newPage(),requests=[],failures=[],errors=[];
    context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),method:r.method()});});context.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('#engine').selectOption('paddle');await page.locator('#sample').click();await page.waitForFunction(()=>document.querySelector('#preview').naturalWidth>0);
    await page.locator('#truth').fill('學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎');await page.locator('#reviewed').check();await page.locator('#run').click();await page.waitForFunction(()=>!document.querySelector('#run').disabled,{timeout:120000});
    assert.match(await page.locator('#status').textContent(),/运行完成/);const text=await page.locator('#output').inputValue();assert(text.includes('學而時習'));assert(text.indexOf('學')<text.indexOf('有朋'));assert(text.indexOf('有朋')<text.indexOf('人不知'));
    const event=page.waitForEvent('download');await page.locator('#download').click();const result=JSON.parse(await readFile(await(await event).path(),'utf8'));assert.equal(result.engine,'paddle');assert.equal(result.evaluation.referenceCharacters,30);assert.equal(result.passes[0].raw.runtime.recProvider,'wasm');
    assert.equal(await page.evaluate(()=>crossOriginIsolated),false);assert(requests.every(r=>new URL(r.url).origin===new URL(base).origin&&['GET','HEAD'].includes(r.method)));assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
    if(mobile)assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    checks.push({mobileEmulation:mobile,realOCR:true,projectSubpath:true,localOnlyRequests:true,crossOriginIsolationRequired:false,JSONDownload:true,rawText:result.originalText,orderedText:result.text,network:requests});await context.close();
  }
  // Real model missing: no fallback or simulated candidates.
  const context=await browser.newContext(),page=await context.newPage();await page.goto(base);await context.route('**/models/PP-OCRv5_mobile_rec.tar',r=>r.fulfill({status:404,body:'missing model'}));
  await page.locator('#engine').selectOption('paddle');await page.locator('#sample').click();await page.waitForFunction(()=>document.querySelector('#preview').naturalWidth>0);await page.locator('#run').click();await page.waitForFunction(()=>!document.querySelector('#run').disabled,{timeout:120000});assert.match(await page.locator('#status').textContent(),/未完成识别/);assert.equal(await page.locator('#output').inputValue(),'');checks.push({missingModelHonestFailure:true});await context.close();
  await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/browser-check.json',import.meta.url),JSON.stringify({browser:browser.version(),checks},null,2));console.log('3 browser checks passed: desktop, touch mobile emulation, missing-model failure');
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
