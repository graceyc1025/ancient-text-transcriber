import {columnBoxes,RULES_VERSION} from './evaluation.js';
import {COLUMN_PROFILES} from './columns.js';
export const METHODS=[{id:'tesseract-whole',kind:'tesseract',mode:'whole',label:'Tesseract 整页'},{id:'tesseract-columns',kind:'tesseract',mode:'columns',label:'Tesseract 分栏'},{id:'paddle-whole',kind:'paddle',mode:'whole',label:'PaddleOCR 整页'},{id:'paddle-columns',kind:'paddle',mode:'columns',label:'PaddleOCR 分栏'}];
export function validateSettings(settings){
  const {orientation='vertical',columnCount=3,columnCuts='',imageScale=1,whitespace='layout',columnProfile='legacy'}=settings||{};
  if(![1,2,3].includes(Number(imageScale)))throw new Error('共同放大倍数只能为1、2或3。');
  if(!['layout','strict'].includes(whitespace))throw new Error('未知空白规则。');
  if(!COLUMN_PROFILES.includes(columnProfile))throw new Error('未知分栏处理方式。');
  return {orientation,columnCount:Number(columnCount),columnCuts:String(columnCuts),imageScale:Number(imageScale),whitespace,columnProfile,columnBoxes:columnBoxes({orientation,columnCount,columnCuts})};
}
export async function sha256(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?new TextEncoder().encode(data):data))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function makeCase(file,reference,settings,metadata={}){
  const dimensions=await createImageBitmap(file);let image;try{image={fileName:file.name||'image.png',mime:file.type,bytes:file.size,width:dimensions.width,height:dimensions.height,sha256:await sha256(await file.arrayBuffer())};}finally{dimensions.close();}
  return {schema:'ancient-ocr-case-v1',id:crypto.randomUUID(),createdAt:new Date().toISOString(),image,reference:{text:reference,sha256:await sha256(reference),reviewed:!!metadata.reviewed,reviewer:metadata.reviewer||'',importedFile:metadata.importedFile||null},metadata:{source:metadata.source||'',sampleType:metadata.sampleType||'unverified'},settings:validateSettings(settings),rules:{version:RULES_VERSION,variants:'exact-code-points; no normalization or folding',uncertainReference:'CER unavailable if reference contains □ or U+FFFD',punctuation:'preserved'}};
}
export function pageHeap(){
  const heap=globalThis.performance?.memory;
  return {scope:'main-page JavaScript heap only',usedBytes:heap?.usedJSHeapSize??null,totalBrowserPeakMiB:null,reason:'普通页面不能可靠测量全浏览器/Worker/WASM峰值；此值不代表总内存。请用桌面case-benchmark采集PSS。'};
}
export function recordsCSV(records){
  const rows=[['recordId','caseId','filename','imageSHA256','referenceSHA256','reviewed','method','columnProfile','effectiveColumnProfile','status','CER','S','D','I','initMs','inferenceMs','wallMs','memoryScope','mainPageJSHeapAfterBytes','browserProcessTreePeakMiB','error']];
  for(const record of records)for(const method of record.methods){const e=method.evaluation||{};rows.push([record.id||'',record.case.id,record.case.image.fileName,record.case.image.sha256,record.case.reference.sha256,record.case.reference.reviewed,method.id,method.mode==='columns'?(method.recognition?.columnProfile??method.columnProfile??record.case.settings?.columnProfile??''):'',method.recognition?.effectiveProfile?.effective??'',method.status,e.CER??'',e.substitutions??'',e.deletions??'',e.insertions??'',method.recognition?.initialization?.elapsedMs??'',method.recognition?.inferenceMs??'',method.wallMs??'',method.memory?.scope??'',method.memory?.after?.usedBytes??'',method.memory?.peak?.pssMiB??'',method.error??'']);}
  return '\ufeff'+rows.map(row=>row.map(value=>{const safe=typeof value==='string'&&/^[=+@\-\t\r]/.test(value)?"'"+value:String(value);return '"'+safe.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
}
