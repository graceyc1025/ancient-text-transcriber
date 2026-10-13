// 真实浏览器前后对照。旧源码由 git archive 放到临时目录，不切换正式分支或创建 worktree。
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm} from 'node:fs/promises';
import{existsSync}from'node:fs';import{spawn,spawnSync}from'node:child_process';import{tmpdir}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
import{parseTSV}from'../src/transcription.js';import{editOperations,orderInversions}from'../src/evaluation.js';
const root=fileURLToPath(new URL('../',import.meta.url)),baseRef=process.env.OCR_BASE_REF||'e323b56';
const temporary=await mkdtemp(path.join(tmpdir(),'ancient-ocr-baseline-'));
const archive=spawnSync('git',['archive',baseRef],{cwd:root,maxBuffer:40*1024*1024});if(archive.status)throw new Error('无法取得已部署基线提交');
const extract=spawnSync('tar',['-x','-C',temporary],{input:archive.stdout});if(extract.status)throw new Error('无法解压基线');
await symlink(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
for(const directory of [root,temporary]){const prep=spawnSync(process.execPath,['scripts/prepare-runtime.mjs'],{cwd:directory});if(prep.status)throw new Error('模型或运行库未准备完整');}
const servers=[root,temporary].map((directory,i)=>spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),directory,'--host','127.0.0.1','--port',String(5174+i),'--strictPort'],{cwd:directory,stdio:'ignore'}));
const ground=JSON.parse(await readFile(path.join(root,'tests/samples/synthetic-ground-truth.json'),'utf8')).columns_right_to_left.join('');
const inputs=[{file:'public/images/example.png',reference:ground,synthetic:true},...process.argv.slice(2).map(file=>({file}))];
let browser;
try{
  for(const port of [5174,5175]){let ready=false;for(let i=0;i<40;i++){try{if((await fetch(`http://127.0.0.1:${port}/`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('对照静态服务未启动');}
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
  const records=[];
  for(const input of inputs){
    const bytes=await readFile(path.resolve(root,input.file)),name=path.basename(input.file),methods=[{label:'before-whole',before:true,mode:'whole',bbox:[0,0,1,1]},
      {label:'after-whole',mode:'whole',bbox:[0,0,1,1]}, {label:'after-auto-columns',mode:'columns',bbox:[0,0,1,1]},
      {label:'after-model-tra',mode:'whole',model:'chi_tra',bbox:[0,0,1,1]}];
    if(input.synthetic)methods.push({label:'after-3-columns-gray',mode:'columns',columnCount:3,bbox:[0,0,1,1],processing:{grayscale:true,contrast:120}});
    if(name==='page_2.png')methods.push(
      {label:'body-4-columns-gray',mode:'columns',columnCount:4,bbox:[.035,.15,.38,.78],processing:{grayscale:true,contrast:120}},
      {label:'body-4-columns-adaptive',mode:'columns',columnCount:4,bbox:[.035,.15,.38,.78],processing:{grayscale:true,binary:'adaptive'}},
      ...['3','5','6','7'].map(psm=>({label:`single-column-psm${psm}`,mode:'whole',psm,bbox:[.32,.15,.095,.78]})));
    for(const method of methods){
      const page=await browser.newPage();await page.goto(`http://127.0.0.1:${method.before?5175:5174}/`);
      const result=await page.evaluate(async({b64,method})=>{
        const {BrowserOCR}=await import('/src/ocr.js'),{loadImage}=await import('/src/images.js');
        const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'})),image=await loadImage(url),engine=new BrowserOCR();
        const page={url,regions:[{id:'region',kind:'body',bbox:method.bbox}]};let observed=[];
        if(method.before){const get=engine.getWorker.bind(engine);engine.getWorker=async(...args)=>{const worker=await get(...args),recognize=worker.recognize.bind(worker);worker.recognize=async(canvas,...args)=>{const size=[canvas.width,canvas.height],out=await recognize(canvas,...args);observed.push({bbox:method.bbox,model:engine.language,psm:'5',workingSize:size,rawText:out.data.text,rawTSV:out.data.tsv});return out;};return worker;};}
        const start=performance.now();const output=await engine.transcribe(page,{orientation:'vertical',threshold:65,mode:method.mode,columnCount:method.columnCount||0,psm:method.psm||'auto',model:method.model||'auto',processing:{scale:2,memory:'standard',mobile:false,grayscale:false,contrast:100,binary:'none',...method.processing}});
        const result={passes:output.passes||observed,marked:output.segments.map(s=>s.text).join('\n'),elapsedMs:Math.round(performance.now()-start)};
        await engine.release();image.src='';URL.revokeObjectURL(url);return result;
      },{b64:bytes.toString('base64'),method});
      const raw=result.passes.map(p=>parseTSV(p.rawTSV,0,'vertical').text).join('\n'),wordBoxes=result.passes.reduce((n,p)=>n+p.rawTSV.split('\n').filter(r=>r.startsWith('5\t')).length,0);
      const record={file:name,sha256:createHash('sha256').update(bytes).digest('hex'),method:method.label,model:method.model||'chi_tra_vert',psm:method.psm||'5',passes:result.passes.length,workingSizes:result.passes.map(p=>p.workingSize),wordBoxes,outputCharacters:Array.from(raw.replace(/\n/g,'')).length,squares:Array.from(result.marked).filter(c=>c==='□').length,elapsedMs:result.elapsedMs,rawText:raw,marked:result.marked};
      if(input.reference){record.rawErrors=editOperations(input.reference,raw.replace(/\n/g,''));record.markedErrors=editOperations(input.reference,result.marked.replace(/\n/g,''));const centers=[599.5,399.5,199.5].map(x=>x/740),sequence=[];
        for(const pass of result.passes)for(const line of parseTSV(pass.rawTSV,0,'vertical').orderedLines){const cx=pass.bbox[0]+(line.bbox[0]+line.bbox[2]/2)/pass.workingSize[0]*pass.bbox[2],distances=centers.map(x=>Math.abs(x-cx)),min=Math.min(...distances);if(min<.12)sequence.push(distances.indexOf(min));}
        record.columnOrderInversions=orderInversions(sequence);
      }
      records.push(record);console.log(JSON.stringify({...record,rawText:undefined,marked:undefined}));await page.close();
    }
  }
  await mkdir(path.join(root,'test-results'),{recursive:true});await writeFile(path.join(root,'test-results/ocr-before-after.json'),JSON.stringify({baselineCommit:baseRef,records},null,2));
}finally{if(browser)await browser.close();for(const server of servers)server.kill('SIGTERM');await rm(temporary,{recursive:true,force:true});}
