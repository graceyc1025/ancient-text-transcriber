import {initialize,recognize,release,score} from './engine.js';
import {inspectFile} from '../../src/images.js';
import {makeCase,validateSettings,recordsCSV,sha256} from './cases.js';
import {columnBoxes} from './evaluation.js';
import {runSuite,runMethod,newRecord} from './suite.js';
import {prepareColumn,columnProfile} from './columns.js';
import './style.css';
const $=id=>document.getElementById(id),state={selected:null,preview:null,thumbnail:null,records:[],busy:false,stop:false,imported:null,last:null};
const el=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
function download(value,name,type='application/json'){const link=el('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function settings(){return validateSettings({orientation:$('orientation').value,columnCount:Number($('columnCount').value),columnCuts:$('columnCuts').value,imageScale:Number($('imageScale').value),whitespace:$('whitespace').value,columnProfile:$('columnProfile').value});}
function dirtyInput(){if(state.busy)return;state.last=null;$('download').disabled=true;$('inputNote').textContent='输入已变更；已有记录的图片、标准、参数和原始输出保持原样。新运行会创建新记录。';$('output').value='';$('details').textContent='';renderCuts();}
function renderCuts(){const target=$('cutsPreview');target.replaceChildren();if(!state.selected)return;try{for(const[ i,box]of settings().columnBoxes.entries()){const span=el('span',String(i+1));span.style.left=`${box[0]*100}%`;span.style.width=`${box[2]*100}%`;target.append(span);}}catch(error){$('inputNote').textContent=error.message;}}
function busy(value){state.busy=value;document.querySelectorAll('input,select,textarea,button').forEach(item=>{if(!item.readOnly)item.disabled=value;});$('stopSuite').disabled=!value;$('download').disabled=value||!state.last;for(const id of ['exportRecords','exportCSV'])$(id).disabled=value||!state.records.length;}
async function setImage(file){const info=await inspectFile(file);for(const url of [state.preview,state.thumbnail])if(url)URL.revokeObjectURL(url);state.preview=info.url;state.thumbnail=info.thumbnailURL;state.selected=file;$('preview').src=info.url;$('reviewed').checked=false;dirtyInput();}
async function loadInput(action,label){if(state.busy)return;busy(true);$('stopSuite').disabled=true;let success=false;try{await action();success=true;}catch(error){$('status').textContent=`${label}未载入：${error.message}`;if(label==='图片')$('image').value='';}finally{busy(false);if(success)dirtyInput();}}
async function snapshot(){if(!state.selected)throw new Error('请先选择图片。');const file=state.selected,reference=$('truth').value,options=settings(),metadata={reviewed:$('reviewed').checked,reviewer:$('reviewer').value,source:$('sourceNotes').value,sampleType:$('sampleType').value,importedFile:state.imported},key=JSON.stringify({reference,options,metadata});if(state.caseFile===file&&state.caseKey===key)return structuredClone(state.caseSnapshot);const result=await makeCase(file,reference,options,metadata);state.caseFile=file;state.caseKey=key;state.caseSnapshot=result;return structuredClone(result);}
function rawArea(label,text){const block=el('label',label),area=el('textarea');area.readOnly=true;area.rows=5;area.value=text||'';block.append(area);return block;}
function renderRecords(){
  const container=$('suiteResults');container.replaceChildren();
  for(const wrapper of state.records){const record=wrapper.record;if(!record)continue;const section=el('details');section.open=wrapper===state.records.at(-1);section.className='case-record';
    section.append(el('summary',`${record.case.image.fileName} · ${record.case.id} · ${record.methods.length}种方法`));
    section.append(el('p',`图片SHA-256 ${record.case.image.sha256}；标准SHA-256 ${record.case.reference.sha256}；${record.case.reference.reviewed?'用户已声明逐字校对':'标准未确认'}；样本 ${record.case.metadata.sampleType}`));
    section.append(el('p',record.case.metadata.source||'来源尚未填写，不据此认定为清代文献。'));
    const inputDownload=el('button','保存此记录的输入清单'),recordDownload=el('button','保存此记录JSON');inputDownload.onclick=()=>download(record.case,`ocr-case-${record.case.id}.json`);recordDownload.onclick=()=>download({schema:'ancient-ocr-records-v2',records:[record]},`ocr-record-${record.id}.json`);section.append(inputDownload,recordDownload);
    const image=el('img');image.src=wrapper.url;image.alt='此记录对应的原图';image.className='case-image';section.append(image);
    const truth=el('details');truth.append(el('summary','本次标准文本快照'),rawArea('标准（当前输入修改不会影响此记录）',record.case.reference.text));section.append(truth);
    const table=el('table'),head=el('tr');for(const text of ['方法','状态','CER / 错漏多','初始化 / 识别 / 总时ms','内存记录'])head.append(el('th',text));table.append(head);
    for(const method of record.methods){const row=el('tr'),e=method.evaluation,rec=method.recognition;row.append(el('td',method.label),el('td',({pending:'待运行',running:'运行中',done:'完成',failed:'失败','not-run':'未运行'})[method.status]));
      row.append(el('td',e?.scorable?`${(e.CER*100).toFixed(2)}% · ${e.substitutions}/${e.deletions}/${e.insertions}`:e?.reason||'未计分'));
      row.append(el('td',method.wallMs!==undefined?`${Math.round(rec?.initialization?.elapsedMs||0)} / ${rec?Math.round(rec.inferenceMs):'—'} / ${Math.round(method.wallMs)}`:'—'));
      const heap=method.memory?.after?.usedBytes;row.append(el('td',method.memory?`${heap===null?'JS堆不可用':`主页面JS堆 ${(heap/1024**2).toFixed(1)} MiB`}；全浏览器峰值未测定`:'—'));table.append(row);
    }section.append(table);
    for(const method of record.methods){if(!method.recognition&&!method.error)continue;const detail=el('details');detail.append(el('summary',`${method.label}：原始候选与逐字差异`));
      if(method.error)detail.append(el('p',method.error));const rec=method.recognition;
      if(rec){detail.append(rawArea('引擎原始输出（未重排、未标□）',rec.originalText),rawArea('按几何阅读序组合的候选（CER使用此文本；不补字）',rec.text));
        if(rec.mode==='columns'){
          const overlapCount=rec.passes.reduce((n,p)=>n+(p.overlappingLinePairs?.length||0),0),noBoxes=rec.passes.filter(p=>p.raw?.metrics?.detectedBoxes===0).length,empty=rec.passes.filter(p=>p.raw?.metrics?.detectedBoxes>0&&p.raw?.metrics?.recognizedCount===0).length;
          detail.append(el('p',`分栏方式 ${rec.columnProfile}；裁剪${rec.cropAudit?.fullCoverage?'覆盖完整、无像素重叠':'审计未提供'}。${rec.engine==='paddle'?`无检测框 ${noBoxes} 栏，检出框但无非空结果 ${empty} 栏。`:`引擎内部相交文字框 ${overlapCount} 对；原始候选均保留，不自动删字。`}`));
        }
        const e=method.evaluation;if(e?.scorable){const changes=e.alignment.filter(x=>x.type!=='match');detail.append(el('p',`正确匹配 ${e.correctAlignedCharacters}/${e.referenceCharacters}；字符序号按比较后的Unicode码位、从1开始。下方最多展示150处差异，完整对齐保存在JSON。`));detail.append(el('pre',JSON.stringify(changes.slice(0,150),null,2)));}else detail.append(el('p',e?.reason||'未计分'));
      }else if(method.partialPasses?.length)detail.append(el('pre',JSON.stringify(method.partialPasses,null,2)));
      section.append(detail);
    }container.append(section);
  }
}
async function models(){const get=async file=>{try{const r=await fetch(new URL(file,document.baseURI));if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}catch(error){return {unavailable:error.message};}};return {paddle:await get('model-status.json'),tesseract:await get('tesseract-models.json')};}
async function run(all){
  if(state.busy)return;if(state.records.length>=10){$('status').textContent='本页已存10份记录，请先导出，再刷新继续，避免大量原图占用内存。';return;}
  busy(true);state.stop=false;state.last=null;$('output').value='';$('details').textContent='';$('status').textContent='正在浏览器本地运行真实模型…';let wrapper;
  try{const testCase=await snapshot(),modelInfo=await models();wrapper={record:null,url:URL.createObjectURL(state.selected)};state.records.push(wrapper);
    if(all){await runSuite(state.selected,testCase,{shouldStop:()=>state.stop,onUpdate:record=>{wrapper.record=record;record.models=modelInfo;renderRecords();const running=record.methods.find(m=>m.status==='running');$('status').textContent=running?`正在运行 ${running.label}；完成的方法和原始输出已保留。`:'正在保存本次记录…';}});}
    else{const method={id:`${$('engine').value}-${$('mode').value}`,kind:$('engine').value,mode:$('mode').value,label:`${$('engine').value} ${$('mode').value==='whole'?'整页':'分栏'}`},record=newRecord(testCase);record.models=modelInfo;record.methods=[await runMethod(state.selected,testCase,method)];record.finishedAt=new Date().toISOString();wrapper.record=record;
      const result=record.methods[0];if(result.recognition){state.last={...result.recognition,evaluation:result.evaluation,case:testCase,memory:result.memory};$('output').value=result.recognition.text;$('details').textContent=JSON.stringify({caseId:testCase.id,initialization:result.recognition.initialization,inferenceMs:result.recognition.inferenceMs,evaluation:result.evaluation,memory:result.memory},null,2);}renderRecords();}
    const failures=wrapper.record.methods.filter(m=>m.status==='failed');$('status').textContent=failures.length?`未完成识别：${failures.map(m=>m.label+' '+m.error).join('；')}。已完成的方法保留。`:state.stop?'已停止后续方法；当前完成结果已记录。':'运行完成。原始候选和标准快照已记录，请导出保存。';
  }catch(error){$('status').textContent=`未完成识别：${error.message}`;if(wrapper&&!wrapper.record){state.records.splice(state.records.indexOf(wrapper),1);URL.revokeObjectURL(wrapper.url);}else if(wrapper?.record){wrapper.record.workflowError=error.message;wrapper.record.finishedAt=new Date().toISOString();for(const m of wrapper.record.methods){if(m.status==='running'){m.status='failed';m.error=error.message;}else if(m.status==='pending')m.status='not-run';}}}
  finally{busy(false);renderRecords();}
}
$('image').onchange=()=>{const file=$('image').files[0];if(file)loadInput(async()=>{await setImage(file);$('sampleType').value='unverified';},'图片');};
$('sample').onclick=()=>loadInput(async()=>{const response=await fetch(new URL('images/example.png',document.baseURI));if(!response.ok)throw new Error('演示图未找到');await setImage(new File([await response.blob()],'example.png',{type:'image/png'}));$('sampleType').value='synthetic';$('sourceNotes').value='仓库现代生成的竖排繁体演示；非清代原刻本。';},'演示图');
$('truthFile').onchange=()=>{const file=$('truthFile').files[0];if(file)loadInput(async()=>{if(file.size>200000)throw new Error('标准TXT过大，请按单页或区域拆分。');const bytes=await file.arrayBuffer(),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);state.imported={fileName:file.name,sha256:await sha256(bytes),originalText:text};$('truth').value=text;$('reviewed').checked=false;},'UTF-8标准TXT');};
for(const id of ['orientation','columnCount','columnCuts','columnProfile','imageScale','whitespace','sampleType','sourceNotes','truth','reviewer','reviewed'])$(id).addEventListener('input',()=>{if(id==='truth')$('reviewed').checked=false;dirtyInput();});
$('run').onclick=()=>run(false);$('runSuite').onclick=()=>run(true);$('stopSuite').onclick=()=>{state.stop=true;$('stopSuite').disabled=true;$('status').textContent='等待当前方法完成，随后停止；不会丢弃已有结果。';};
$('exportCase').onclick=async()=>{try{download(await snapshot(),'ocr-test-case.json');}catch(error){$('status').textContent=error.message;}};
$('exportRecords').onclick=()=>download({schema:'ancient-ocr-records-v2',records:state.records.map(w=>w.record)},'ocr-test-records.json');
$('exportCSV').onclick=()=>download(recordsCSV(state.records.map(w=>w.record)),'ocr-test-summary.csv','text/csv;charset=utf-8');
$('download').onclick=()=>{if(state.last)download(state.last,'ocr-experiment.json');};
window.addEventListener('beforeunload',e=>{if(state.records.length){e.preventDefault();e.returnValue='';}});
window.ocrExperiment={initialize,recognize,release,score,runMethod,newRecord,prepareColumn,columnProfile};busy(false);
