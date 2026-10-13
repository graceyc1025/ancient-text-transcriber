"use strict";
import './style.css';
import { BrowserOCR } from './ocr.js';
import { inspectFile, wordImage } from './images.js';
import { assetURL } from './assets.js';
import { exportTXT, exportDOCX } from './exporting.js';
import { formatPage, txtContent } from './transcription.js';
const $ = id => document.getElementById(id);
const kinds = {body:"正文",title:"标题",page:"页码",center:"版心",other:"其他版面信息"};
const statuses = {pending:"待处理",done:"待校对",reviewed:"已校对",error:"识别失败"};
const state = {pages:[], current:null, busy:false, adding:false, dirty:false, drawing:false, zoom:1};
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
    const thumb=element("img","page-thumb"); thumb.src=page.url; thumb.alt="";
    const info=element("button","page-info"); info.style.background="transparent"; info.style.textAlign="left"; info.style.padding="0";
    info.append(element("span","page-name",`${String(index+1).padStart(2,"0")}  ${page.file.name}`),element("span","page-state",page.processing?"识别中…":statuses[page.status]));
    info.title=page.file.name; info.addEventListener("click",()=>selectPage(page.id));
    const ops=element("div","page-operations");
    const up=button("↑","向前移动图片",()=>movePage(index,-1)), down=button("↓","向后移动图片",()=>movePage(index,1));
    up.disabled=state.busy||index===0; down.disabled=state.busy||index===state.pages.length-1;
    const remove=button("×","移除图片",()=>{if(page.edited&&!confirm("这张图片已有人工修改。移除将丢失本页文字，是否继续？"))return; URL.revokeObjectURL(page.url); state.pages.splice(index,1); if(state.current===page.id)state.current=state.pages[Math.min(index,state.pages.length-1)]?.id||null;setDirty();render();});
    remove.disabled=state.busy; ops.append(up,down,remove); row.append(thumb,info,ops);list.append(row);
  }); updateSummary();
}
function movePage(index,delta) { if(state.busy)return; [state.pages[index],state.pages[index+delta]]=[state.pages[index+delta],state.pages[index]];setDirty();renderList(); }
function render() { renderList(); const has=state.pages.length>0; $("workspace").hidden=!has; $("exportBar").hidden=!has; $("dropZone").classList.toggle("compact",has); if(has)renderCurrent();else{state.current=null;$("pageList").append(element("div","list-empty","上传图片后，在这里逐页查看"));} updateControls(); }
function selectPage(id) { state.current=id;state.zoom=1;state.drawing=false; renderList();renderCurrent(); }
function renderCurrent() {
  const page=currentPage(); if(!page)return;
  state.drawing=false;$("draftRegion").hidden=true;$("drawRegion").textContent="框选区域";$("imageStage").classList.remove("drawing");
  $("currentName").textContent=page.file.name;$("sourceImage").src=page.url;
  $("resultStatus").textContent=statuses[page.status];$("reviewed").checked=page.status==="reviewed";
  $("pageWarnings").replaceChildren();page.warnings.forEach(w=>$("pageWarnings").append(element("div","",w)));
  renderEditors();renderRegions();setZoom(state.zoom);updateControls();
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
    const chip=element("span","region-chip",`${index+1} ${kinds[region.kind]}`),remove=button("×","移除框选区域",()=>{page.regions.splice(index,1);setDirty();renderRegions();});remove.disabled=state.busy;chip.append(remove);$("regionsList").append(chip);
  });
  if($("showUncertain").checked)page.segments.forEach(segment=>(segment.uncertain||[]).forEach(mark=>{const box=element("div","uncertain-box");boxStyle(box,mark.bbox);$("uncertainOverlay").append(box);}));
  $("regionHint").textContent=page.regions.length?`已框选 ${page.regions.length} 个区域 · 下次只识别这些区域`:"可放大查看；复杂版面建议先框选";
}
function updateControls() { const busy=state.busy||state.adding;for(const id of ["runCurrent","runPending","addFiles","sampleButton","orientation","threshold","addSegment","reviewed","drawRegion","regionKind","fileInput","autoRun","exportTxt","exportDocx","copyAll","copyCurrent"])$(id).disabled=busy;
  $("runPending").disabled=busy||!state.pages.some(p=>p.status==="pending"||p.status==="error");$("runCurrent").textContent=currentPage()?.segments.some(s=>s.text)?"重新转录本页":"转录当前页";
  document.querySelectorAll(".segment-text,.segment-kind,.segment-operations button").forEach(el=>{if(busy)el.disabled=true;});
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
    const page={id:crypto.randomUUID(),file,...info,regions:[],segments:[{kind:"body",text:"",uncertain:[]}],warnings:[],status:"pending",edited:false,processing:false};state.pages.push(page);added.push(page);total+=file.size;
  }
  state.adding=false;updateControls();
  if(added.length){state.current=added[0].id;state.zoom=1;setDirty();render();}
  if(errors.length)toast(errors.join("；"),true);
  if(added.length&&$("autoRun").checked)await runPages(added);
}
async function runPages(pages) {
  if(state.busy||state.adding||!pages.length)return;
  if(pages.some(p=>p.edited||p.status==="reviewed")&&!confirm("重新转录会覆盖所选页的人工修改和校对状态。是否继续？"))return;
  state.busy=true;state.drawing=false;updateControls();renderList();renderEditors();let failed=0;
  const orientation=$("orientation").value,threshold=Number($("threshold").value);
  for(let i=0;i<pages.length;i++) {
    const page=pages[i];page.processing=true;renderList();$("progress").textContent=`正在转录 ${i+1} / ${pages.length}`;
    try{const result=await ocr.transcribe(page,{orientation,threshold,onProgress:(stage,percent)=>{
        $("progress").textContent=`${i+1}/${pages.length} · ${stage} ${percent}%`;
        $("engineStatus").textContent="● 浏览器正在本地识别";$("engineStatus").classList.remove("error");
      }});
      page.segments=result.segments;page.warnings=result.warnings;page.status="done";page.edited=false;
    }catch(error){failed++;if(page.status==="pending")page.status="error";page.warnings=[`本次识别失败：${error?.message||String(error||"浏览器未能载入 OCR Worker，请检查网络后重试。")}`,"已有转录文字已保留。请检查浏览器内存、网站模型加载或框选范围后重试；也可以继续手工转录。"];}finally{page.processing=false;setDirty();renderList();if(page.id===state.current)renderCurrent();}
  }
  state.busy=false;$("progress").textContent="";$("engineStatus").textContent=failed?"浏览器识别有失败页":"● 浏览器本地识别已完成";$("engineStatus").classList.toggle("error",failed>0);render();toast(failed?`${pages.length-failed} 页完成，${failed} 页失败。可查看原因后重试。`:`${pages.length} 页转录完成，请逐字校对`,failed>0);
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
    page.regions.push({kind:$("regionKind").value,bbox:box});setDirty();renderRegions();toast("区域已加入。下次识别将只转录框选范围，请确保包含全部所需文字。");});
  stage.addEventListener("pointercancel",()=>{start=null;$("draftRegion").hidden=true;});
}
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
const supported=typeof WebAssembly==="object"&&typeof Worker==="function";
$("engineStatus").textContent=supported?"● 浏览器本地 OCR · 模型按需载入":"此浏览器不支持本地 OCR，仍可手工编辑";
$("engineStatus").classList.toggle("error",!supported);
