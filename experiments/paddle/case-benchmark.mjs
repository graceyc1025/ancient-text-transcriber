// Desktop-only driver for an exported UI test case. No private files are served.
import {chromium} from '@playwright/test';import{readFile,writeFile,mkdir}from'node:fs/promises';import{spawn}from'node:child_process';import{createHash,randomUUID}from'node:crypto';import{fileURLToPath}from'node:url';import path from'node:path';import assert from'node:assert/strict';
import{METHODS,validateSettings,recordsCSV}from'./cases.js';import{processMemory}from'./desktop-memory.mjs';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
if(!args.includes('--case')||!args.includes('--image'))throw new Error('Usage: node case-benchmark.mjs --case input.json --image scan.png [--out results/case.json]');
const testCase=JSON.parse(await readFile(option('--case'),'utf8')),bytes=await readFile(option('--image')),hash=data=>createHash('sha256').update(data).digest('hex');
assert.equal(testCase.schema,'ancient-ocr-case-v1','Unrecognized case schema');assert.equal(hash(bytes),testCase.image?.sha256,'Image SHA-256 mismatch: wrong file');assert.equal(hash(testCase.reference?.text||''),testCase.reference?.sha256,'Reference SHA-256 mismatch');
assert(bytes.byteLength<=20*1024*1024,'Image exceeds the browser upload limit');
testCase.settings=validateSettings(testCase.settings);
const here=path.dirname(fileURLToPath(import.meta.url)),base='http://127.0.0.1:4183/ancient-text-transcriber/experiments/paddle/',destination=path.resolve(option('--out')&&args.includes('--out')?option('--out'):path.join(here,'results/desktop-case.json'));
const server=spawn(process.execPath,['serve.mjs'],{cwd:here,env:{...process.env,EXPERIMENT_PORT:'4183'},stdio:'ignore'});let browser,record={schema:'ancient-ocr-comparison-v2',id:randomUUID(),case:testCase,startedAt:new Date().toISOString(),methods:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function desktopDeadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('桌面方法运行超过180秒，结果不完整，不计CER。')),180000);})]);}finally{clearTimeout(timer);}}
try{
  let ready=false;for(let i=0;i<30;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await sleep(200);}assert(ready,'Experiment static host did not start');
  for(const method of METHODS){
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--enable-precise-memory-info']});
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),session=await browser.newBrowserCDPSession(),network=[];page.on('request',r=>{if(/^https?:/.test(r.url()))network.push({url:r.url(),method:r.method()});});
    await page.goto(base);await page.waitForFunction(()=>window.ocrExperiment);const baseline=await processMemory(session);let peak=baseline,sampling=true;
    if(!record.models)record.models=await page.evaluate(async()=>({paddle:await(await fetch('./model-status.json')).json(),tesseract:await(await fetch('./tesseract-models.json')).json()}));
    const sampler=(async()=>{while(sampling){const value=await processMemory(session);if(value.pssMiB!==null&&(peak.pssMiB===null||value.pssMiB>peak.pssMiB))peak=value;await sleep(100);}})();let result;
    try{
      result=await desktopDeadline(page.evaluate(async({b64,testCase,method})=>{
        const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],testCase.image.fileName,{type:testCase.image.mime});
        const r=await window.ocrExperiment.runMethod(file,testCase,method);return r;
      },{b64:bytes.toString('base64'),testCase,method}));
    }catch(error){result={...method,status:'failed',error:`浏览器方法未完成：${error.message}`,recognition:null,evaluation:{scorable:false,CER:null,reason:'方法未完成，不计算CER。'}};}
    finally{sampling=false;await sampler;}
    result.mainPageHeapSupplement=result.memory;result.memory={scope:'Linux Chromium process-tree PSS (fresh browser per method)',sampleIntervalMs:100,baseline,peak:peak.pssMiB===null?null:peak,after:await processMemory(session),note:'Observed samples, includes native/WASM/Worker memory. RSS sums shared pages; PSS is preferred. Unsupported platform returns null, never zero.'};
    result.network=network;assert(network.every(r=>new URL(r.url).origin===new URL(base).origin&&['GET','HEAD'].includes(r.method)),'Third-party/upload request detected');
    record.environment={browser:browser.version(),freshBrowserPerMethod:true,platform:process.platform,arch:process.arch};record.methods.push(result);
    await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(record,null,2));console.log(JSON.stringify({method:method.id,status:result.status,CER:result.evaluation?.CER,inferenceMs:result.recognition?.inferenceMs,peakPSS:result.memory.peak?.pssMiB??null}));
    await browser.close();browser=null;
  }
  record.finishedAt=new Date().toISOString();await writeFile(destination,JSON.stringify(record,null,2));await writeFile(destination.replace(/\.json$/i,'')+'.csv',recordsCSV([record]));if(record.methods.some(m=>m.status!=='done'))process.exitCode=1;
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
