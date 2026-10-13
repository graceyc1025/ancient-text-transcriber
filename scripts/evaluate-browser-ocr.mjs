import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const ground = JSON.parse(await readFile(path.join(root,'tests/samples/synthetic-ground-truth.json'),'utf8'));
const samples = [
  {file:'public/images/example.png',orientation:'vertical',reference:ground.columns_right_to_left.join(''),thresholds:[0,65]},
  {file:'public/images/horizontal-example.png',orientation:'horizontal',reference:'學而時習之不亦說乎有朋自遠方來不亦樂乎',thresholds:[65]},
  ...process.argv.slice(2).map(file=>({file,orientation:'vertical',thresholds:[65]})),
];
function distance(a,b) {
  a=Array.from(a);b=Array.from(b);let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next.push(Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1])));row=next;}
  return row[b.length];
}
const server=spawn(process.execPath,['scripts/serve-static.mjs'],{cwd:root,env:{...process.env,STATIC_TEST_PORT:'4174'},stdio:'ignore'});
let browser;
try {
  const base='http://127.0.0.1:4174/ancient-text-transcriber/';
  let ready=false;
  for(let i=0;i<30;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  if(!ready)throw new Error('静态测试服务未启动。');
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
  const context=await browser.newContext();const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
  const requests=[];context.on('request',request=>{if(/^https?:/.test(request.url()))requests.push({url:request.url(),method:request.method()});});
  const records=[];
  for(const sample of samples){
    const file=path.resolve(root,sample.file),bytes=await readFile(file);
    await page.goto(base);await page.locator('#orientation').selectOption(sample.orientation);
    for(let index=0;index<sample.thresholds.length;index++){
      const threshold=sample.thresholds[index];await page.locator('#threshold').fill(String(threshold));const start=Date.now();
      if(!index)await page.locator('#fileInput').setInputFiles(file);else await page.locator('#runCurrent').click();
      await page.waitForFunction(()=>['待校对','识别失败'].includes(document.querySelector('.page-state')?.textContent)&&document.querySelector('#progress').textContent==='',{},{timeout:150_000});
      if(await page.locator('.page-state').textContent()==='识别失败')throw new Error(await page.locator('#pageWarnings').textContent());
      const text=await page.locator('.segment-text').inputValue();
      const record={file:path.basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),orientation:sample.orientation,threshold,elapsedSeconds:(Date.now()-start)/1000,text,detectedCharacters:Array.from(text.replace(/\n/g,'')).length,squareCount:Array.from(text).filter(c=>c==='□').length};
      if(sample.reference){const errors=distance(sample.reference,text.replace(/\n/g,'')),total=Array.from(sample.reference).length;Object.assign(record,{referenceCharacters:total,editDistanceIncludingSquares:errors,characterErrorRateIncludingSquares:errors/total});}
      records.push(record);console.log(JSON.stringify(record));
    }
  }
  if(requests.some(request=>new URL(request.url).origin!=='http://127.0.0.1:4174'||!['GET','HEAD'].includes(request.method)))throw new Error('发现不符合本地处理策略的网络请求。');
  await mkdir(path.join(root,'test-results'),{recursive:true});
  await writeFile(path.join(root,'test-results/browser-sample-evaluation.json'),JSON.stringify({engine:'Tesseract.js 7.0.0, non-SIMD LSTM WASM',records,networkPolicyVerified:true},null,2));
} finally {if(browser)await browser.close();server.kill('SIGTERM');}
