// Desktop workflow acceptance with real OCR. Modern fixture validates the tool,
// not Qing accuracy. Fault injection changes HTTP availability, never OCR text.
import{chromium}from'@playwright/test';import{spawn,spawnSync}from'node:child_process';import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import path from'node:path';import assert from'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),base='http://127.0.0.1:4184/ancient-text-transcriber/experiments/paddle/',results=path.join(here,'results');
const server=spawn(process.execPath,['serve.mjs'],{cwd:here,env:{...process.env,EXPERIMENT_PORT:'4184'},stdio:'ignore'});let browser;
const sha=x=>createHash('sha256').update(x).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let ready=false;for(let i=0;i<30;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await sleep(200);}assert(ready);
  await mkdir(results,{recursive:true});browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),requests=[],errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),method:r.method()});});
  await page.goto(base);
  // Pixel conservation, not a modern-image accuracy claim: padding and lossless
  // quarter-turn preserve every source pixel and surround it only with white.
  await page.evaluate(()=>{
    const source=document.createElement('canvas');source.width=7;source.height=11;const ctx=source.getContext('2d'),data=ctx.createImageData(7,11);
    for(let y=0;y<11;y++)for(let x=0;x<7;x++){const i=(y*7+x)*4;data.data.set([10+x*20,10+y*15,50,255],i);}ctx.putImageData(data,0,0);
    for(const name of ['padding','single-line']){
      const prepared=window.ocrExperiment.prepareColumn(source,window.ocrExperiment.columnProfile(name,'tesseract','vertical')),canvas=prepared.canvas,pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let y=0;y<11;y++)for(let x=0;x<7;x++){const dx=name==='padding'?x+7:y,dy=name==='padding'?y:13-x,a=(dy*canvas.width+dx)*4,b=(y*7+x)*4;for(let k=0;k<4;k++)if(pixels[a+k]!==data.data[b+k])throw new Error('Column transform changed a source pixel');}
      if(pixels[0]!==255||pixels[1]!==255||pixels[2]!==255)throw new Error('Padding is not white');canvas.width=0;canvas.height=0;
    }source.width=0;source.height=0;
  });
  await page.locator('#image').setInputFiles(path.join(root,'public/images/example.png'));await page.waitForFunction(()=>document.querySelector('#preview').naturalWidth===740);
  const truth=JSON.parse(await readFile(path.join(root,'tests/samples/synthetic-ground-truth.json'),'utf8')).columns_right_to_left.join('\n');
  await page.locator('#truthFile').setInputFiles({name:'modern-reviewed.txt',mimeType:'text/plain',buffer:Buffer.from(truth)});await page.waitForFunction(t=>document.querySelector('#truth').value===t,truth);
  await page.locator('#sourceNotes').fill('现代合成流程验收，不是清代样本');await page.locator('#sampleType').selectOption('synthetic');await page.locator('#reviewer').fill('fixture checked against the source image');await page.locator('#reviewed').check();
  await page.locator('#columnCuts').fill('0, 33.33333333333333, 66.66666666666667, 100');assert.equal(await page.locator('#cutsPreview span').count(),3);
  const caseEvent=page.waitForEvent('download');await page.locator('#exportCase').click();const testCase=JSON.parse(await readFile(await(await caseEvent).path(),'utf8'));assert.equal(testCase.reference.sha256,sha(truth));assert.equal(testCase.image.sha256,sha(await readFile(path.join(root,'public/images/example.png'))));
  const caseFile=path.join(results,'qa-input-case.json');await writeFile(caseFile,JSON.stringify(testCase,null,2));
  await page.locator('#runSuite').click();await page.waitForFunction(()=>!document.querySelector('#runSuite').disabled,{timeout:180000});
  const recordEvent=page.waitForEvent('download');await page.locator('#exportRecords').click();const bundle=JSON.parse(await readFile(await(await recordEvent).path(),'utf8')),record=bundle.records[0];assert.equal(record.methods.length,4);assert(record.methods.every(m=>m.status==='done'&&m.evaluation.scorable));
  assert.equal(record.case.id,testCase.id);assert(record.methods.every(m=>m.recognition.confidenceMasking===false&&m.memory.totalBrowserPeakMiB===null));
  assert.equal(testCase.settings.columnProfile,'repaired');assert(record.methods.every(m=>m.evaluation.referenceCharacters===30));assert.deepEqual(record.methods[1].recognition.passes.map(p=>p.bbox),record.methods[3].recognition.passes.map(p=>p.bbox));assert.deepEqual(record.methods[1].recognition.passes.map(p=>p.preparation.sourceSize),record.methods[3].recognition.passes.map(p=>p.preparation.sourceSize));
  assert(record.methods.filter(m=>m.mode==='columns').every(m=>m.recognition.cropAudit.fullCoverage&&m.recognition.cropAudit.overlapPixels===0));assert(record.methods[3].recognition.passes.every(p=>p.preparation.paddingPixels[0]===p.preparation.sourceSize[0]));
  assert(record.methods[0].recognition.passes[0].rawTSV);assert(record.methods[2].recognition.passes[0].raw.items.length>0);
  assert(record.methods.every(m=>m.recognition.pipelineVersion===(m.mode==='columns'?'column-input-v3':'raw-candidate-comparison-v2')));assert.equal(record.methods[2].recognition.parameters.textRecScoreThresh,0);assert.equal(record.methods[2].recognition.parameters.textDetUnclipRatio,2);assert.equal(record.methods[0].recognition.parameters.tessedit_pageseg_mode,'5');assert(record.methods[3].recognition.passes.every(p=>p.intermediate&&p.intermediate.errors.length===0));
  await writeFile(path.join(results,'qa-ui-records.json'),JSON.stringify(bundle,null,2));
  // Run the same real OCR with an unrelated reference. Recognition must remain
  // identical; the reference is used only in evaluate(), after inference.
  const independent=await page.evaluate(async testCase=>{
    const bytes=await(await fetch('./images/example.png')).blob(),file=new File([bytes],'example.png',{type:'image/png'}),copy=structuredClone(testCase);copy.reference.text='完全不同的人工标准';copy.reference.reviewed=true;
    return await window.ocrExperiment.runMethod(file,copy,{kind:'paddle',mode:'columns',id:'reference-independent',label:'reference independence'});
  },testCase);assert.equal(independent.status,'done');assert.equal(independent.recognition.text,record.methods[3].recognition.text);
  const csvEvent=page.waitForEvent('download');await page.locator('#exportCSV').click();const csv=await readFile(await(await csvEvent).path(),'utf8');assert(csv.includes('browserProcessTreePeakMiB'));assert(csv.includes('tesseract-whole'));
  await page.locator('#truth').fill('變更□');assert.equal(await page.locator('#reviewed').isChecked(),false);const unchangedEvent=page.waitForEvent('download');await page.locator('#exportRecords').click();assert.deepEqual(JSON.parse(await readFile(await(await unchangedEvent).path(),'utf8')).records[0],record);
  assert(requests.every(r=>new URL(r.url).origin===new URL(base).origin&&['GET','HEAD'].includes(r.method)));assert.deepEqual(errors,[]);await page.screenshot({path:path.join(results,'qa-desktop.png'),fullPage:true});
  // Same page snapshot, but real Paddle model is unavailable. Other methods stay.
  const isolated=await browser.newContext(),failure=await isolated.newPage();await isolated.route('**/models/PP-OCRv5_mobile_rec.tar',r=>r.fulfill({status:404,body:'missing model'}));await failure.goto(base);await failure.locator('#sample').click();await failure.waitForFunction(()=>document.querySelector('#preview').naturalWidth>0);
  await failure.locator('#truth').fill(truth);await failure.locator('#reviewed').check();await failure.locator('#runSuite').click();await failure.waitForFunction(()=>!document.querySelector('#runSuite').disabled,{timeout:180000});
  const partialEvent=failure.waitForEvent('download');await failure.locator('#exportRecords').click();const partial=JSON.parse(await readFile(await(await partialEvent).path(),'utf8')).records[0];assert.deepEqual(partial.methods.map(m=>m.status),['done','done','failed','failed']);assert(partial.methods.slice(2).every(m=>m.evaluation.CER===null));await isolated.close();await browser.close();browser=null;
  const runner=spawnSync(process.execPath,['case-benchmark.mjs','--case',caseFile,'--image',path.join(root,'public/images/example.png'),'--out',path.join(results,'qa-desktop-pss.json')],{cwd:here,encoding:'utf8',timeout:240000,maxBuffer:100000});if(runner.status!==0)throw new Error(runner.stderr||runner.stdout||'Desktop driver failed');
  const measured=JSON.parse(await readFile(path.join(results,'qa-desktop-pss.json'),'utf8'));assert(measured.methods.every(m=>m.status==='done'));assert(measured.methods.every(m=>m.memory.peak?.pssMiB>0));assert.equal(measured.case.reference.sha256,testCase.reference.sha256);
  const wrongCase=structuredClone(testCase);wrongCase.image.sha256='0'.repeat(64);const wrongFile=path.join(results,'qa-wrong-image.json');await writeFile(wrongFile,JSON.stringify(wrongCase));const wrong=spawnSync(process.execPath,['case-benchmark.mjs','--case',wrongFile,'--image',path.join(root,'public/images/example.png')],{cwd:here,encoding:'utf8',timeout:10000});assert.notEqual(wrong.status,0);assert((wrong.stderr||'').includes('Image SHA-256 mismatch'));
  await writeFile(path.join(results,'qa-summary.json'),JSON.stringify({scope:'Modern-image desktop tool validation only. No Qing ground truth exists in the repository.',fourRealMethods:true,inputHashes:true,immutableReferenceAndRawResults:true,sharedCrops:true,JSONAndCSV:true,partialFailurePreserved:true,freshDesktopProcessTreeMemory:true,networkLocalOnly:true,methods:measured.methods.map(m=>({id:m.id,status:m.status,CER:m.evaluation.CER,initializationMs:m.recognition.initialization.elapsedMs,inferenceMs:m.recognition.inferenceMs,peakPSSMiB:m.memory.peak.pssMiB}))},null,2));console.log('Desktop case workflow and 4 real isolated memory measurements passed. Not a Qing accuracy test.');
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
