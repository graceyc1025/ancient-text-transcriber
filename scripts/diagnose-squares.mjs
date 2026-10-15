// Read-only audit of the real browser engine. OCR is never replaced or mocked.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {editOperations} from '../src/evaluation.js';

const root=fileURLToPath(new URL('../',import.meta.url)),port=5176,base=`http://127.0.0.1:${port}/ancient-text-transcriber/`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort','--base','/ancient-text-transcriber/'],{cwd:root,stdio:'ignore'});
const manifest=JSON.parse(await readFile(path.join(root,'models/manifest.json'),'utf8'));
const truth=JSON.parse(await readFile(path.join(root,'tests/samples/synthetic-ground-truth.json'),'utf8')).columns_right_to_left;
let browser;
const count=text=>({characters:Array.from(text.replace(/\s/gu,'')).length,han:(text.match(/\p{Script=Han}/gu)||[]).length,squares:(text.match(/□/g)||[]).length,replacements:(text.match(/\uFFFD/g)||[]).length});
try{
  let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert(ready,'Vite audit server did not start');
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
  const context=await browser.newContext(),page=await context.newPage();const requests=[],errors=[];
  context.on('response',r=>requests.push({url:r.url(),status:r.status()}));page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.evaluate(async()=>{const {BrowserOCR}=await import('./src/ocr.js');window.auditEngine=new BrowserOCR();window.auditProgress=[];});
  const records=[];
  const example=await readFile(path.join(root,'public/images/example.png'));
  const inputs=[{file:'public/images/example.png',bytes:example,synthetic:true},...await Promise.all(process.argv.slice(2).map(async file=>({file,bytes:await readFile(path.resolve(root,file))})))];
  for(const input of inputs){
    const cases=input.synthetic?[
      {name:'whole-cold',mode:'whole',cache:'cold'},
      {name:'whole-new-worker-warm-cache',mode:'whole',restart:true},
      {name:'auto-columns',mode:'columns'},
      ...truth.map((reference,i)=>({name:`single-column-${i+1}`,mode:'whole',bbox:[(2-i)/3,0,1/3,1],reference})),
      {name:'single-right-psm3',bbox:[2/3,0,1/3,1],psm:'3',reference:truth[0]},
      {name:'single-right-psm6',bbox:[2/3,0,1/3,1],psm:'6',reference:truth[0]},
      {name:'whole-mobile-budget',processing:{mobile:true}},
    ]:[{name:'whole',mode:'whole'},{name:'auto-columns',mode:'columns'}];
    for(const config of cases){
      const startIndex=requests.length;
      const result=await page.evaluate(async({b64,config})=>{
        const {BrowserOCR}=await import('./src/ocr.js');
        if(config.restart){await window.auditEngine.release();window.auditEngine=new BrowserOCR();}
        const engine=window.auditEngine,url=URL.createObjectURL(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]));
        const phases=[];const output=await engine.transcribe({url,regions:config.bbox?[{id:'single',kind:'body',bbox:config.bbox}]:[]},{orientation:'vertical',threshold:65,mode:config.mode||'whole',psm:config.psm||'auto',processing:{memory:'standard',scale:2,...config.processing,...(config.processing?.mobile?{memory:'auto'}:{})},onProgress:(stage,percent)=>phases.push({stage,percent})});
        const loaded=(await engine.worker.FS('readFile',['chi_tra_vert.traineddata'])).data;
        const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
        const cache=await new Promise((resolve,reject)=>{const req=indexedDB.open('keyval-store');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,r=db.transaction('keyval').objectStore('keyval').get('ancient-transcriber-tessdata-best-e12c65a9/chi_tra_vert.traineddata');r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};});
        // The output below is captured before any display or confidence masking.
        URL.revokeObjectURL(url);return {passes:output.passes,marked:output.segments.map(s=>s.text).join('\n'),loadedModelSHA256:await digest(loaded),cachedModelSHA256:await digest(cache),loadedModelBytes:loaded.byteLength,phases};
      },{b64:input.bytes.toString('base64'),config});
      const raw=result.passes.map(p=>p.rawText).join('\n'),sorted=result.passes.map(p=>p.sortedRaw).join('\n');
      const record={file:path.basename(input.file),imageSHA256:createHash('sha256').update(input.bytes).digest('hex'),method:config.name,...result,rawText:raw,sortedRaw:sorted,rawCounts:count(raw),sortedRawCounts:count(sorted),markedCounts:count(result.marked),modelRequests:requests.slice(startIndex).filter(r=>r.url.includes('.traineddata')),psm:result.passes.map(p=>p.psm),wordBoxes:result.passes.reduce((n,p)=>n+p.wordBoxes,0),lineBoxes:result.passes.reduce((n,p)=>n+p.lineBoxes,0)};
      const reference=config.reference||(input.synthetic&&!config.bbox?truth.join(''):null);
      if(reference){record.rawErrors=editOperations(reference,sorted.replace(/\s/gu,''));record.markedErrors=editOperations(reference,result.marked.replace(/\s/gu,''));}
      assert.equal(record.loadedModelSHA256,manifest.models.find(m=>m.name==='chi_tra_vert').sha256);
      assert.equal(record.cachedModelSHA256,record.loadedModelSHA256);assert.equal(record.rawCounts.replacements,0);
      assert.equal(record.rawCounts.han,record.sortedRawCounts.han,'TSV parsing lost Han characters');
      records.push(record);console.log(JSON.stringify({file:record.file,method:record.method,raw:record.rawCounts,marked:record.markedCounts,boxes:record.wordBoxes,passes:record.passes.length,rawErrors:record.rawErrors,modelRequests:record.modelRequests.length}));
    }
  }
  assert(records[0].modelRequests.some(r=>r.status===200));assert.equal(records[1].modelRequests.length,0);assert.equal(records[0].rawText,records[1].rawText);
  assert(requests.every(r=>new URL(r.url).origin===new URL(base).origin),'Unexpected third-party request');assert.deepEqual(errors,[]);
  await page.evaluate(async()=>window.auditEngine.release());await context.close();
  // Two isolated failure probes: no cached fallback, and malformed IndexedDB data.
  const probes=[];
  for(const kind of ['missing-model','invalid-cache']){
    const isolated=await browser.newContext(),probe=await isolated.newPage();await probe.goto(base);
    if(kind==='missing-model')await isolated.route('**/chi_tra_vert.traineddata.gz',route=>route.fulfill({status:404,body:'Not found'}));
    else await probe.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('keyval-store');r.onupgradeneeded=()=>r.result.createObjectStore('keyval');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('keyval','readwrite');t.objectStore('keyval').put(new Uint8Array([0,0]),'ancient-transcriber-tessdata-best-e12c65a9/chi_tra_vert.traineddata');t.oncomplete=()=>{db.close();resolve();};};}));
    const started=Date.now();console.log(`Failure probe: ${kind}`);
    const outcome=await probe.evaluate(async b64=>{
      const {BrowserOCR}=await import('./src/ocr.js'),engine=new BrowserOCR(),url=URL.createObjectURL(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]));let result;
      try{const output=await engine.transcribe({url,regions:[]},{threshold:65});result={success:true,passes:output.passes.length};}catch(e){result={success:false,message:e.message,passes:e.passes?.length||0};}finally{await engine.release();URL.revokeObjectURL(url);}return result;
    },example.toString('base64'));
    assert.equal(outcome.success,false);assert.equal(outcome.passes,0);probes.push({kind,elapsedMs:Date.now()-started,...outcome});console.log(JSON.stringify(probes.at(-1)));await isolated.close();
  }
  await mkdir(path.join(root,'test-results'),{recursive:true});const destination=process.env.OCR_DIAGNOSIS_OUTPUT||path.join(root,'test-results/square-diagnosis.json');
  await writeFile(destination,JSON.stringify({testedAt:new Date().toISOString(),source:'real browser WASM; no substituted recognition',browser:browser.version(),modelManifest:manifest,records,probes,errors},null,2));console.log(`Evidence: ${destination}`);
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
