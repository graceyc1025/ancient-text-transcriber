// Observe the pinned SDK's intermediate outputs before its empty-text filter.
// Return the exact same model objects/results; never replace candidates.
export async function predictWithTrace(instance,target,params){
  const trace={detections:[],recognitions:[],errors:[]},det=instance.detModel,rec=instance.recModel;
  if(typeof det?.predict!=='function'||typeof rec?.predict!=='function')return {result:await instance.predict(target,params),trace:{unavailable:'SDK intermediate prediction methods unavailable'}};
  const detPredict=det.predict,recPredict=rec.predict;
  det.predict=async function(...args){const result=await detPredict.apply(this,args);try{trace.detections.push(structuredClone(result));}catch(error){trace.errors.push(error.message);}return result;};
  rec.predict=async function(...args){const result=await recPredict.apply(this,args);try{trace.recognitions.push(result.map(item=>({...item,score:Number.isFinite(item.score)?item.score:null,scoreFinite:Number.isFinite(item.score)})));}catch(error){trace.errors.push(error.message);}return result;};
  try{return {result:await instance.predict(target,params),trace};}
  finally{det.predict=detPredict;rec.predict=recPredict;}
}
