"use strict";
import './style.css';
import { BrowserOCR } from './ocr.js';
import { inspectFile, wordImage, loadImage, splitColumns, makeProcessingPreview } from './images.js';
import { assetURL } from './assets.js';
import { exportTXT, exportDOCX } from './exporting.js';
import { formatPage, txtContent } from './transcription.js';
const $ = id => document.getElementById(id);
const kinds = {body:"正文",title:"标题",page:"页码",center:"版心",other:"其他版面信息"};
const statuses = {pending:"待处理",done:"待校对",reviewed:"已校对",error:"识别失败"};
const state = {pages:[], current:null, busy:false, adding:false, dirty:false, drawing:false, zoom:1,recognizing:false,stop:false};
const ocr = new BrowserOCR();
let toastTimer;
function toast(text, error=false) { clearTimeout(toastTimer); $("toast").textContent=text; $("toast").classList.toggle("error",error); $("toast").hidden=false; toastTimer=setTimeout(()=>$("toast").hidden=true,6500); }
function element(tag, className, text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function currentPage() { return state.pages.find(p=>p.id===state.current); }
function setDirty() { state.dirty=true; updateSummary(); }
function resetReview(page) { if(page.status==="reviewed")page.status="done"; if(page.id===state.current){ $("reviewed").checked=false; $("resultStatus").textContent=statuses[page.status]; } }
function button(text,label,action) { const b=element("button","",text); b.type="button"; b.title=label; b.setAttribute("aria-label",label); b.addEventListener("click",action); return b; }
function updateSummary() { const n=state.pages.length, reviewed=state.pages.filter(p=>p.status==="reviewed").length; $("pageCount").textContent=`${n} 页`; $("exportSummary").textContent=`${n} 张原图 · ${reviewed} 页已校对 · 按目录顺序保存编辑后的文字`; }
function renderList() {
  const list=$("pageList"); list.replaceChildren();
  state.pages.forEach((page,index)=>{
    const row=element("div",`page-item${page.id===state.current?" active":""}`);
    const thumb=element("img","page-thumb"); thumb.src=page.thumbnailURL||page.url; thumb.alt="";
    const info=element("button","page-info"); info.style.background="transparent"; info.style.textAlign="left"; info.style.padding="0";
    info.append(element("span","page-name",`${String(index+1).padStart(2,"0")}  ${page.file.name}`),element("span","page-state",page.processing?"识别中…":statuses[page.status]));
    info.title=page.file.name; info.addEventListener("click",()=>selectPage(page.id));
    const ops=element("div","page-operations");
    const up=button("↑","向前移动图片",()=>movePage(index,-1)), down=button("↓","向后移动图片",()=>movePage(index,1));
    up.disabled=state.busy||index===0; down.disabled=state.busy||index===state.pages.length-1;
    const remove=button("×","移除图片",()=>{if((page.edited||page.history?.length)&&!confirm("移除将丢失本页编辑及识别记录，请先保存。是否继续？"))return;for(const url of [page.url,page.thumbnailURL,page.processedURL])if(url)URL.revokeObjectURL(url);state.pages.splice(index,1); if(state.current===page.id)state.current=state.pages[Math.min(index,state.pages.length-1)]?.id||null;setDirty();render();});
    remove.disabled=state.busy; ops.append(up,down,remove); row.append(thumb,info,ops);list.append(row);
  }); updateSummary();
}
function movePage(index,delta) { if(state.busy)return; [state.pages[index],state.pages[index+delta]]=[state.pages[index+delta],state.pages[index]];setDirty();renderList(); }
function render() { renderList(); const has=state.pages.length>0; $("workspace").hidden=!has; $("exportBar").hidden=!has; $("dropZone").classList.toggle("compact",has); if(has)renderCurrent();else{state.current=null;$("pageList").append(element("div","list-empty","上传图片后，在这里逐页查看"));} updateControls(); }
function selectPage(id) { state.current=id;state.zoom=1;state.drawing=false; renderList();renderCurrent(); }
function renderCurrent() {
  const page=currentPage(); if(!page)return;
  state.drawing=false;$("draftRegion").hidden=true;$("drawRegion").textContent="框选区域";$("imageStage").classList.remove("drawing");
  $("currentName").textContent=page.file.name;updateImageView();
  $("resultStatus").textContent=statuses[page.status];$("reviewed").checked=page.status==="reviewed";
  $("pageWarnings").replaceChildren();page.warnings.forEach(w=>$("pageWarnings").append(element("div","",w)));
  renderEditors();renderRegions();renderDiagnostics();setZoom(state.zoom);updateControls();
}
function markEdited(page) { page.edited=true; if(page.status==="pending"||page.status==="error")page.status="done";resetReview(page);setDirty();renderList();$("resultStatus").textContent=statuses[page.status]; }
function renderEditors() {
  const page=currentPage();if(!page)return;const editors=$("segmentEditors");editors.replaceChildren();
  page.segments.forEach((segment,index)=>{
    const block=element("div","segment-block"), heading=element("div","segment-heading"), selector=element("select","segment-kind");
    selector.setAttribute("aria-label",`栏目 ${index+1} 类型`);Object.entries(kinds).forEach(([key,label])=>{const opt=element("option","",label);opt.value=key;selector.append(opt);});selector.value=segment.kind;
    selector.addEventListener("change",()=>{segment.kind=selector.value;markEdited(page);});
    const uncertain=segment.uncertain?.reduce((n,t)=>n+t.characters,0)||0;
    const note=element("span","segment-note",uncertain?`${uncertain} 个字已标□ · 识别时`:(page.status==="pending"?"可先分区，或直接识别":"可直接编辑"));
    const ops=element("div","segment-operations");
    const up=button("↑","上移栏目",()=>moveSegment(index,-1)),down=button("↓","下移栏目",()=>moveSegment(index,1));up.disabled=state.busy||index===0;down.disabled=state.busy||index===page.segments.length-1;
    const remove=button("×","删除栏目",()=>{if(segment.text&&!confirm("删除这个栏目及其文字？"))return;page.segments.splice(index,1);markEdited(page);renderEditors();renderRegions();});remove.disabled=state.busy;
    ops.append(up,down,remove);heading.append(selector,note,ops);
    const textarea=element("textarea","segment-text");textarea.value=segment.text;textarea.spellcheck=false;textarea.setAttribute("aria-label",`栏目 ${index+1} ${kinds[segment.kind]}转录文字`);textarea.placeholder="识别结果会显示在这里，也可以手工输入\n不确定的字请使用 □";textarea.maxLength=150000;textarea.disabled=state.busy;
    textarea.rows=segment.kind==="body"?13:3;textarea.addEventListener("input",()=>{segment.text=textarea.value;markEdited(page);});
    selector.disabled=state.busy;block.append(heading,textarea);editors.append(block);
  });
}
function moveSegment(index,delta) {const page=currentPage();[page.segments[index],page.segments[index+delta]]=[page.segments[index+delta],page.segments[index]];markEdited(page);renderEditors();}
function boxStyle(el,bbox) {const[x,y,w,h]=bbox;el.style.left=`${x*100}%`;el.style.top=`${y*100}%`;el.style.width=`${w*100}%`;el.style.height=`${h*100}%`;}
function renderRegions() {
  const page=currentPage();if(!page)return;$("regionOverlay").replaceChildren();$("regionsList").replaceChildren();$("uncertainOverlay").replaceChildren();
  page.regions.forEach((region,index)=>{const box=element("div","region-box");boxStyle(box,region.bbox);box.append(element("span","",`${index+1} ${kinds[region.kind]}`));$("regionOverlay").append(box);
    const chip=element("span","region-chip",`${index+1} ${kinds[region.kind]}`),remove=button("×","移除框选区域",()=>{page.regions.splice(index,1);setDirty();renderRegions();});remove.disabled=state.busy;
    const mode=element('select');mode.setAttribute('aria-label',`区域 ${index+1} 处理方式`);for(const[value,label]of [['','跟随全局'],['whole','整区'],['columns','分栏']]){const option=element('option','',label);option.value=value;mode.append(option);}mode.value=region.mode||'';mode.disabled=state.busy;mode.onchange=()=>{region.mode=mode.value||undefined;setDirty();};
    const direction=element('select');direction.setAttribute('aria-label',`区域 ${index+1} 排版`);for(const[value,label]of [['','跟随排版'],['vertical','竖排'],['horizontal','横排']]){const option=element('option','',label);option.value=value;direction.append(option);}direction.value=region.orientation||'';direction.disabled=state.busy;direction.onchange=()=>{region.orientation=direction.value||undefined;setDirty();};
    const psm=element('select');psm.setAttribute('aria-label',`区域 ${index+1} PSM`);for(const[value,label]of [['','跟随 PSM'],['5','PSM5 竖排'],['6','PSM6 单块'],['3','PSM3 自动'],['7','PSM7 单行']]){const option=element('option','',label);option.value=value;psm.append(option);}psm.value=region.psm||'';psm.disabled=state.busy;psm.onchange=()=>{region.psm=psm.value||undefined;setDirty();};
    const run=button('识别该区',`单独识别区域 ${index+1}`,()=>runPages([page],region));run.disabled=state.busy;chip.append(direction,mode,psm,run,remove);$("regionsList").append(chip);
  });
  $('columnOverlay').replaceChildren();(page.columnPreview||[]).forEach((item,index)=>{const box=element('div','column-box');boxStyle(box,item.bbox);box.append(element('span','',`列 ${item.column||index+1}`));$('columnOverlay').append(box);});
  $('detectedOverlay').replaceChildren();if($('showDetected').checked)page.segments.flatMap(s=>s.detected||[]).forEach(mark=>{const box=element('div','detected-box');boxStyle(box,mark.bbox);$('detectedOverlay').append(box);});
  if($("showUncertain").checked)page.segments.forEach(segment=>(segment.uncertain||[]).forEach(mark=>{const box=element("div","uncertain-box");boxStyle(box,mark.bbox);$("uncertainOverlay").append(box);}));
  $("regionHint").textContent=page.regions.length?`已框选 ${page.regions.length} 个区域 · 下次只识别这些区域`:"可放大查看；复杂版面建议先框选";
}
function updateControls() { const busy=state.busy||state.adding;for(const id of ["runCurrent","runPending","addFiles","sampleButton","orientation","threshold","addSegment","reviewed","drawRegion","regionKind","fileInput","autoRun","exportTxt","exportDocx","copyAll","copyCurrent","recognitionMode","languageModel","psm","columnCount","ocrScale","memoryMode","grayscale","contrast","binaryMode","binaryThreshold","previewProcessing","analyzeColumns"])$(id).disabled=busy;
  $('stopOCR').disabled=!state.recognizing||state.stop;$('showRecords').disabled=busy;
  $("runPending").disabled=busy||!state.pages.some(p=>p.status==="pending"||p.status==="error");$("runCurrent").textContent=currentPage()?.segments.some(s=>s.text)?"重新转录本页":"转录当前页";
  document.querySelectorAll(".segment-text,.segment-kind,.segment-operations button").forEach(el=>{if(busy)el.disabled=true;});
  document.querySelectorAll('.region-chip button,.region-chip select').forEach(el=>el.disabled=busy);
}
function setZoom(value) {state.zoom=Math.max(.5,Math.min(3,value));$("imageStage").style.width=`${state.zoom*100}%`;$("zoomValue").textContent=`${Math.round(state.zoom*100)}%`;}
async function addFiles(files) {
  if(state.busy||state.adding){toast("正在处理，请稍后再添加图片");return;}
  state.adding=true;updateControls();
  const added=[];let errors=[];let total=state.pages.reduce((n,p)=>n+p.file.size,0);
  for(const file of files) {
    if(state.pages.length>=20){errors.push("每批最多 20 张，请先导出当前文献");break;}
    if(total+file.size>80*1024*1024){errors.push("本批图片合计超过 80 MB，请分批处理");continue;}
    let info;try{info=await inspectFile(file);}catch(e){errors.push(`${file.name}：${e.message}`);continue;}
    const page={id:crypto.randomUUID(),file,...info,regions:[],segments:[{kind:"body",text:"",uncertain:[]}],warnings:[],status:"pending",edited:false,processing:false,history:[],columnPreview:[]};state.pages.push(page);added.push(page);total+=file.size;
  }
  state.adding=false;updateControls();
  if(added.length){state.current=added[0].id;state.zoom=1;setDirty();render();}
  if(errors.length)toast(errors.join("；"),true);
  if(added.length&&$("autoRun").checked)await runPages(added);
}
async function runPages(pages,onlyRegion=null) {
  if(state.busy||state.adding||!pages.length)return;
  if(pages.some(p=>p.edited||p.status==="reviewed")&&!confirm(onlyRegion?"重新识别会覆盖该区域的底稿，其他区域保留。是否继续？":"重新转录会覆盖所选页的人工修改；原始识别记录保留。是否继续？"))return;
  state.busy=true;state.recognizing=true;state.stop=false;state.drawing=false;updateControls();renderList();renderEditors();let failed=0;
  const options=readOptions();
  for(let i=0;i<pages.length;i++) {
    if(state.stop)break;
    const page=pages[i];page.processing=true;renderList();$("progress").textContent=`正在转录 ${i+1} / ${pages.length}`;
    try{const result=await ocr.transcribe(onlyRegion?{...page,regions:[onlyRegion]}:page,{...options,onProgress:(stage,percent)=>{
        if(state.stop)return;
        $("progress").textContent=`${i+1}/${pages.length} · ${stage} ${percent}%`;
        $("engineStatus").textContent="● 浏览器正在本地识别";$("engineStatus").classList.remove("error");
      }});
      archive(page,result);
      if(onlyRegion){const replacement=result.segments[0],existing=page.segments.findIndex(s=>s.regionId===replacement.regionId);if(existing>=0)page.segments[existing]=replacement;else{page.segments=page.segments.filter(s=>s.text||s.regionId);page.segments.push(replacement);}}
      else{page.segments=result.segments;page.edited=false;}
      page.columnPreview=result.columns;page.warnings=result.warnings;page.status="done";
    }catch(error){if(error.passes?.length)archive(page,{passes:error.passes,settings:options,partial:true});if(error.cancelled){page.warnings=['已停止本次识别，已有文字与已完成的原始输出记录保留。'];}else{failed++;if(page.status==="pending")page.status="error";page.warnings=[`本次识别失败：${error?.message||String(error||"模型未能加载。")}`,"已有转录文字已保留。请检查本站资源、内存预算，或框选更小区域后重试。"];} }finally{page.processing=false;setDirty();renderList();if(page.id===state.current)renderCurrent();}
  }
  state.busy=false;state.recognizing=false;$("progress").textContent="";$("engineStatus").textContent=state.stop?'本次识别已停止':failed?"浏览器识别有失败页":"● 浏览器本地识别已完成";$("engineStatus").classList.toggle("error",failed>0);render();toast(state.stop?'已停止；请保存已完成的识别记录':failed?`${failed} 页失败，可查看原因后重试。`:`识别完成，原始输出已记录，请逐字校对`,failed>0);
}
function snapshot() {return {title:$("projectTitle").value||"古籍转录",pages:state.pages.map(p=>({filename:p.file.name,status:p.status,segments:p.segments.map(s=>({kind:s.kind,text:s.text}))}))};}
function pageText(page) {return formatPage(page);}
async function copyText(text) {try{await navigator.clipboard.writeText(text);toast("文字已复制");}catch{const helper=element("textarea");helper.value=text;document.body.append(helper);helper.select();const ok=document.execCommand("copy");helper.remove();toast(ok?"文字已复制":"浏览器未允许复制，请选中文字后按 Ctrl+C",!ok);}}
function download(blob,name) {const url=URL.createObjectURL(blob),a=element("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportDocument(format) {
  if(state.busy||state.adding)return;const payload=snapshot(),pages=[...state.pages];state.busy=true;updateControls();renderList();renderEditors();
  const btn=$(format==="txt"?"exportTxt":"exportDocx"),old=btn.textContent;btn.disabled=true;btn.textContent="正在导出…";
  try{let blob;if(format==="txt")blob=exportTXT(payload);else{const images=[];let total=0;if($("includeImages").checked)for(const page of pages){const image=await wordImage(page);total+=image.data.byteLength;if(total>80*1024*1024)throw new Error("Word 附图超过 80 MB，请分批导出或取消附图。");images.push(image);}blob=await exportDOCX(payload,images);}const name=(payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,80)||"古籍转录");download(blob,`${name}.${format}`);toast(`已在浏览器生成 ${format==="txt"?"TXT":"Word"} 文件，请查看浏览器下载。`);}catch(error){toast(error.message,true);}finally{state.busy=false;btn.textContent=old;render();}
}
function setupDrawing() {
  const stage=$("imageStage");let start=null,pointerId=null;
  const point=e=>{const r=stage.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  const rectangle=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])];
  stage.addEventListener("pointerdown",e=>{if(!state.drawing||state.busy||e.button!==0)return;e.preventDefault();start=point(e);pointerId=e.pointerId;stage.setPointerCapture(e.pointerId);$("draftRegion").hidden=false;boxStyle($("draftRegion"),[...start,0,0]);});
  stage.addEventListener("pointermove",e=>{if(!start||e.pointerId!==pointerId)return;boxStyle($("draftRegion"),rectangle(start,point(e)));});
  stage.addEventListener("pointerup",e=>{if(!start||e.pointerId!==pointerId)return;const box=rectangle(start,point(e));start=null;$("draftRegion").hidden=true;state.drawing=false;stage.classList.remove("drawing");$("drawRegion").textContent="框选区域";
    const page=currentPage();if(box[2]<.01||box[3]<.01){toast("框选范围太小，请重新框选");return;}if(page.regions.length>=30){toast("每页最多 30 个分区",true);return;}
    page.regions.push({id:crypto.randomUUID(),kind:$("regionKind").value,bbox:box});setDirty();renderRegions();toast("区域已加入，可单独识别该区；整页重识别只处理框内内容。");});
  stage.addEventListener("pointercancel",()=>{start=null;$("draftRegion").hidden=true;});
}
function readOptions(){
  return {orientation:$('orientation').value,threshold:Number($('threshold').value),mode:$('recognitionMode').value,model:$('languageModel').value,psm:$('psm').value,columnCount:Math.max(0,Math.min(30,Math.round(Number($('columnCount').value)||0))),
    processing:{scale:Number($('ocrScale').value),memory:$('memoryMode').value,mobile:matchMedia('(max-width: 780px)').matches||(navigator.deviceMemory!==undefined&&navigator.deviceMemory<=4),grayscale:$('grayscale').checked,contrast:Number($('contrast').value),binary:$('binaryMode').value,binaryThreshold:Number($('binaryThreshold').value)}};
}
function archive(page,result){page.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),settings:result.settings,partial:!!result.partial,passes:result.passes});}
function renderDiagnostics(){
  const page=currentPage(),latest=page?.history.at(-1),target=$('diagnosticSummary');target.textContent='';if(!latest)return;
  const passes=latest.passes,chars=passes.reduce((n,p)=>n+p.detectedCharacters,0),squares=passes.reduce((n,p)=>n+p.squareCount,0),words=passes.reduce((n,p)=>n+p.wordBoxes,0),lines=passes.reduce((n,p)=>n+p.lineBoxes,0);
  target.textContent=`最近一次：${passes.length} 次区域/列识别 · 检测 ${words} 个字词框 / ${lines} 个行列框 · 原始 ${chars} 字符，其中 ${squares} 个标□。${chars?'数量不代表原图字数，查看检测框可辅助判断漏检。':'无检测结果，请先检查版面和预处理。'}`;
}
function updateImageView(){const page=currentPage();if(!page)return;if($('imageView').value==='processed'&&!page.processedURL){$('imageView').value='original';toast('请先生成处理预览');} $('sourceImage').src=$('imageView').value==='processed'?page.processedURL:page.url;}
async function prepareView(columns=false){
  if(state.busy||state.adding)return;const page=currentPage(),options=readOptions();if(!page)return;state.busy=true;updateControls();
  try{
    if(columns){const image=await loadImage(page.url);const regions=page.regions.length?page.regions:[{id:'whole-page',kind:'body',bbox:[0,0,1,1]}];page.columnPreview=regions.flatMap(r=>splitColumns(image,r.bbox,options.processing,Number(r.columnCount??options.columnCount)).map((bbox,i)=>({bbox,column:i+1,regionId:r.id,kind:r.kind})));image.src='';toast(`分栏分析得到 ${page.columnPreview.length} 个区间，请检查切线；尚未调用 OCR。`);}
    else{const url=await makeProcessingPreview(page,options.processing);if(page.processedURL)URL.revokeObjectURL(page.processedURL);page.processedURL=url;$('imageView').value='processed';toast('已生成缩略预览。实际识别按原图/分区独立制作工作图。');}
  }catch(error){toast(error.message,true);}finally{state.busy=false;renderCurrent();}
}
function renderRecordRuns(){const page=currentPage(),select=$('recordRun');select.replaceChildren();page.history.forEach((run,index)=>{const option=element('option','',`${index+1} · ${new Date(run.at).toLocaleString('zh-CN')} · ${run.partial?'中断/部分':'完成'} · ${run.passes.length} 个区域/列`);option.value=String(index);select.append(option);});select.value=String(page.history.length-1);renderRecordPasses();}
function renderRecordPasses(){const run=currentPage()?.history[Number($('recordRun').value)],select=$('recordPass');select.replaceChildren();(run?.passes||[]).forEach((pass,index)=>{const option=element('option','',`${kinds[pass.kind]} · 列 ${pass.column}/${pass.columnCount} · ${pass.model} PSM${pass.psm}`);option.value=String(index);select.append(option);});renderRecordOutput();}
function renderRecordOutput(){const run=currentPage()?.history[Number($('recordRun').value)],pass=run?.passes[Number($('recordPass').value)];$('rawOutput').value=pass?.rawText??'';$('markedOutput').value=pass?.markedText??'';$('recordProfile').textContent=pass?`${pass.model} · PSM${pass.psm} · ${pass.orientation==='vertical'?'竖排':'横排'} · 工作图 ${pass.workingSize.join('×')} · ${pass.wordBoxes} 词框 / ${pass.lineBoxes} 行列框 · ${pass.detectedCharacters} 输出字符 / ${pass.squareCount} 个□ · ${pass.memoryLimited?'按预算缩放':'未被内存预算缩小'} · ${pass.elapsedMs} 毫秒`: '尚无识别记录。';}
$("fileInput").addEventListener("change",async e=>{const files=[...e.target.files];e.target.value="";await addFiles(files);});
$("addFiles").addEventListener("click",()=>$("fileInput").click());
$("dropZone").addEventListener("click",e=>{if(!e.target.closest("button")&&!state.busy)$("fileInput").click();});
$("dropZone").addEventListener("keydown",e=>{if(e.target===$("dropZone")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();if(!state.busy)$("fileInput").click();}});
$("dropZone").addEventListener("dragover",e=>{e.preventDefault();$("dropZone").classList.add("dragover");});
$("dropZone").addEventListener("dragleave",()=>$("dropZone").classList.remove("dragover"));
$("dropZone").addEventListener("drop",e=>{e.preventDefault();$("dropZone").classList.remove("dragover");addFiles([...e.dataTransfer.files]);});
$("sampleButton").addEventListener("click",async()=>{try{const r=await fetch(assetURL("images/example.png"));if(!r.ok)throw new Error("演示图片未找到");await addFiles([new File([await r.blob()],"竖排繁体排版演示.png",{type:"image/png"})]);}catch(e){toast(e.message,true);}});
$("runCurrent").addEventListener("click",()=>runPages([currentPage()]));$("runPending").addEventListener("click",()=>runPages(state.pages.filter(p=>p.status==="pending"||p.status==="error")));
$("threshold").addEventListener("input",()=>$("thresholdValue").textContent=$("threshold").value);
$("zoomIn").addEventListener("click",()=>setZoom(state.zoom+.25));$("zoomOut").addEventListener("click",()=>setZoom(state.zoom-.25));$("showUncertain").addEventListener("change",renderRegions);
$("drawRegion").addEventListener("click",()=>{state.drawing=!state.drawing;$("imageStage").classList.toggle("drawing",state.drawing);$("drawRegion").textContent=state.drawing?"取消框选":"框选区域";$("regionHint").textContent=state.drawing?"在图片上拖动，框出需要识别的区域":"可放大查看；复杂版面建议先框选";});
$("addSegment").addEventListener("click",()=>{const page=currentPage();if(page.segments.length>=30){toast("每页最多 30 个栏目",true);return;}page.segments.push({kind:"other",text:"",uncertain:[]});markEdited(page);renderEditors();});
$("reviewed").addEventListener("change",()=>{const page=currentPage();page.status=$("reviewed").checked?"reviewed":"done";page.edited=true;setDirty();renderList();$("resultStatus").textContent=statuses[page.status];});
$("projectTitle").addEventListener("input",setDirty);$("copyCurrent").addEventListener("click",()=>copyText(pageText(currentPage())));
$("copyAll").addEventListener("click",()=>copyText(txtContent(snapshot()).replace(/^\ufeff/,"")));
$("exportTxt").addEventListener("click",()=>exportDocument("txt"));$("exportDocx").addEventListener("click",()=>exportDocument("docx"));
$("helpButton").addEventListener("click",()=>$("helpDialog").showModal());$("closeHelp").addEventListener("click",()=>$("helpDialog").close());
window.addEventListener("beforeunload",e=>{if(state.dirty&&state.pages.length){e.preventDefault();e.returnValue="";}});
setupDrawing();
$('previewProcessing').addEventListener('click',()=>prepareView(false));$('analyzeColumns').addEventListener('click',()=>prepareView(true));$('imageView').addEventListener('change',updateImageView);$('showDetected').addEventListener('change',renderRegions);
$('contrast').addEventListener('input',()=>{$('contrastValue').textContent=`${$('contrast').value}%`;});
for(const id of ['ocrScale','memoryMode','grayscale','contrast','binaryMode','binaryThreshold','columnCount'])$(id).addEventListener('change',()=>{for(const page of state.pages){if(page.processedURL)URL.revokeObjectURL(page.processedURL);page.processedURL=null;page.columnPreview=[];}if(currentPage()){$('imageView').value='original';updateImageView();renderRegions();}});
$('stopOCR').addEventListener('click',async()=>{state.stop=true;updateControls();$('progress').textContent='正在停止；若模型正在初始化，待其完成后释放。';await ocr.cancel();});
$('showRecords').addEventListener('click',()=>{renderRecordRuns();$('recordsDialog').showModal();});$('closeRecords').addEventListener('click',()=>$('recordsDialog').close());$('recordRun').addEventListener('change',renderRecordPasses);$('recordPass').addEventListener('change',renderRecordOutput);
$('copyRaw').addEventListener('click',()=>copyText($('rawOutput').value));$('exportRecords').addEventListener('click',()=>{const page=currentPage();const data={filename:page.file.name,imageSize:[page.width,page.height],note:'原始 OCR 是引擎输出，不是确认原文；未经简繁转换或上下文校正。',history:page.history};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'OCR-识别记录.json');toast('本页识别记录已下载，包含原始文本、TSV、参数及方法记录。');});
const supported=typeof WebAssembly==="object"&&typeof Worker==="function";
$("engineStatus").textContent=supported?"● 浏览器本地 OCR · 模型按需载入":"此浏览器不支持本地 OCR，仍可手工编辑";
$("engineStatus").classList.toggle("error",!supported);
