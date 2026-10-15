import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import{cpus,totalmem}from'node:os';
import{fileURLToPath}from'node:url';import path from'node:path';import assert from'node:assert/strict';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),base='http://127.0.0.1:4181/ancient-text-transcriber/experiments/paddle/';
const server=spawn(process.execPath,['serve.mjs'],{cwd:here,env:{...process.env,EXPERIMENT_PORT:'4181'},stdio:'ignore'});
const truth=JSON.parse(await readFile(path.join(root,'tests/samples/synthetic-ground-truth.json'),'utf8')).columns_right_to_left;
const inputs=[{file:'public/images/example.png',orientation:'vertical',reference:truth.join(''),kind:'modern-synthetic'},
  {file:'public/images/horizontal-example.png',orientation:'horizontal',reference:truth.slice(0,2).join(''),kind:'modern-synthetic'},
  ...process.argv.slice(2).map(file=>({file:path.resolve(process.cwd(),file),orientation:'vertical',reference:null,kind:'unannotated-scan'}))];
const records=[];let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function memory(session){
  try{const {processInfo}=await session.send('SystemInfo.getProcessInfo');let pss=0,rss=0,privateKB=0;
    for(const process of processInfo){const text=await readFile(`/proc/${process.id}/smaps_rollup`,'utf8'),n=key=>Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`,'m'))?.[1]||0);pss+=n('Pss');rss+=n('Rss');privateKB+=n('Private_Clean')+n('Private_Dirty');}
    return {pssMiB:pss/1024,rssMiB:rss/1024,privateMiB:privateKB/1024,processes:processInfo.length};
  }catch(error){return {unavailable:error.message};}
}
try{
  let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await sleep(200);}assert(ready,'Experiment static host unavailable');
  for(const input of inputs){
    const data=await readFile(path.resolve(root,input.file));
    const profiles=[{kind:'tesseract',mode:'whole',tesseractScale:2},{kind:'tesseract',mode:'whole',tesseractScale:1},{kind:'paddle',mode:'whole'}];
    if(input.file.endsWith('/example.png'))profiles.push({kind:'tesseract',mode:'columns',tesseractScale:2},{kind:'tesseract',mode:'columns',tesseractScale:1},{kind:'paddle',mode:'columns'});
    for(const profile of profiles){
      if(process.env.BENCHMARK_PROFILE&&`${path.basename(input.file)}:${profile.kind}:${profile.mode}:${profile.tesseractScale||1}`!==process.env.BENCHMARK_PROFILE)continue;
      browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--enable-precise-memory-info']});
      const session=await browser.newBrowserCDPSession(),context=await browser.newContext(),page=await context.newPage(),requests=[],errors=[],responses=[];
      context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),method:r.method()});});
      context.on('response',r=>{if(/^https?:/.test(r.url()))responses.push({url:r.url(),status:r.status()});});page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.waitForFunction(()=>window.ocrExperiment);
      const baseline=await memory(session);let peak={...baseline},sampling=true;
      const sampler=(async()=>{while(sampling){const now=await memory(session);if(now.pssMiB>(peak.pssMiB||0))peak=now;await sleep(100);}})();
      const record={file:path.basename(input.file),imageSHA256:createHash('sha256').update(data).digest('hex'),sampleKind:input.kind,reference:input.reference,profile:{...profile,orientation:input.orientation},browser:browser.version(),crossOriginIsolated:await page.evaluate(()=>crossOriginIsolated),baselineMemory:baseline,memorySampling:'Linux Chromium process-tree PSS, 100ms interval; includes native/WASM/renderer/worker memory; observed peak, not hardware maximum',runs:[]};
      try{
        record.initialization=await page.evaluate(({kind,orientation})=>window.ocrExperiment.initialize(kind,orientation),{kind:profile.kind,orientation:input.orientation});record.loadedMemory=await memory(session);
        for(let repeat=0;repeat<3;repeat++){
          const output=await page.evaluate(async({b64,options,reference})=>{const blob=new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]);const result=await window.ocrExperiment.recognize(blob,options);result.evaluation=reference?window.ocrExperiment.score(reference,result.text):null;result.nativeOrderEvaluation=reference?window.ocrExperiment.score(reference,result.originalText):null;return result;},{b64:data.toString('base64'),options:{...profile,orientation:input.orientation},reference:input.reference});
          record.runs.push(output);
        }
        record.success=true;
      }catch(error){record.success=false;record.error=error.message;}
      finally{sampling=false;await sampler;record.peakMemory=peak;record.finalMemory=await memory(session);record.network=requests;record.failedResponses=responses.filter(r=>r.status>=400);record.pageErrors=errors;}
      assert(requests.every(r=>new URL(r.url).origin===new URL(base).origin&&['GET','HEAD'].includes(r.method)),'Third-party or upload request detected');
      records.push(record);console.log(JSON.stringify({file:record.file,profile:record.profile,success:record.success,error:record.error,runs:record.runs.map(r=>({text:r.text,ms:r.inferenceMs,evaluation:r.evaluation})),baselinePSS:baseline.pssMiB,peakPSS:peak.pssMiB}));
      await browser.close();browser=null;
    }
  }
  assert(records.length>0,'No selected benchmark cases executed');
  await mkdir(path.join(here,'results'),{recursive:true});await writeFile(process.env.PADDLE_BENCHMARK_OUTPUT||path.join(here,'results/comparison.json'),JSON.stringify({testedAt:new Date().toISOString(),host:{cpus:cpus().length,cpuModel:cpus()[0]?.model,totalMemoryMiB:totalmem()/1024**2},models:JSON.parse(await readFile(path.join(here,'models.json'),'utf8')),records},null,2));
  if(records.some(r=>!r.success))process.exitCode=1;
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
