import {METHODS,pageHeap} from './cases.js';
import {recognize,release} from './engine.js';
import {evaluate} from './evaluation.js';
export function newRecord(testCase){return {schema:'ancient-ocr-comparison-v2',id:crypto.randomUUID(),case:structuredClone(testCase),startedAt:new Date().toISOString(),finishedAt:null,environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemoryGiB:navigator.deviceMemory??null,crossOriginIsolated,viewport:[innerWidth,innerHeight],measurement:'shared page; cached modules may persist between methods'},methods:METHODS.map(m=>({...m,status:'pending',evaluation:null,recognition:null,error:null}))};}
export async function runMethod(file,testCase,method){
  const start=performance.now(),before=pageHeap(),result={...method,status:'running',startedAt:new Date().toISOString(),recognition:null,evaluation:null};
  try{
    await release();
    const settings=testCase.settings;
    result.recognition=await recognize(file,{...settings,kind:method.kind,mode:method.mode,...(method.columnProfile?{columnProfile:method.columnProfile}:{})});
    const evaluationStart=performance.now(),rules={whitespace:settings.whitespace,reviewed:testCase.reference.reviewed===true};
    result.evaluation=evaluate(testCase.reference.text,result.recognition.text,rules);
    result.nativeOrderEvaluation=evaluate(testCase.reference.text,result.recognition.originalText,rules);
    result.evaluationMs=performance.now()-evaluationStart;result.status='done';
  }catch(error){result.status='failed';result.error=error?.message||String(error);result.partialPasses=error.partialPasses||[];result.evaluation={scorable:false,CER:null,reason:'该方法未完成，不对部分候选计算CER。'};}
  result.finishedAt=new Date().toISOString();result.wallMs=performance.now()-start;result.memory={scope:before.scope,before,after:pageHeap(),totalBrowserPeakMiB:null};return result;
}
export async function runSuite(file,testCase,{onUpdate=()=>{},shouldStop=()=>false}={}){
  const record=newRecord(testCase);onUpdate(record);
  try{
    for(let index=0;index<METHODS.length;index++){
      if(shouldStop()){for(let i=index;i<METHODS.length;i++)record.methods[i].status='not-run';break;}
      record.methods[index].status='running';onUpdate(record);
      record.methods[index]=await runMethod(file,record.case,METHODS[index]);onUpdate(record);
    }
  }finally{try{await release();}catch(error){record.cleanupError=error.message;}record.finishedAt=new Date().toISOString();onUpdate(record);}
  return record;
}
