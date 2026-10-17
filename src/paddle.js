import {assetURL} from './assets.js';
import {sortRegions,validateRegions} from './transcription.js';
import {sortItems} from './reading-order.js';

const stopped=()=>Object.assign(new Error('已停止本次识别。'),{cancelled:true});
const parameters=Object.freeze({textRecScoreThresh:0,textDetLimitSideLen:960,textDetLimitType:'max',textDetMaxSideLimit:4000,textDetThresh:.3,textDetBoxThresh:.6,textDetUnclipRatio:2});
export class PaddleBrowserOCR {
  worker=null;ready=false;pending=new Map();nextId=1;logger=null;initialization=null;
  release(){
    const worker=this.worker;this.worker=null;this.ready=false;
    worker?.terminate();
    for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(stopped());}
    this.pending.clear();
  }
  cancel(){this.release();}
  request(type,payload,timeout){
    return new Promise((resolve,reject)=>{
      const id=this.nextId++,timer=setTimeout(()=>{
        this.pending.delete(id);reject(new Error(type==='init'?'Paddle 模型加载超过两分钟，请检查下载后重试，或切换 Tesseract。':'Paddle 识别超过90秒，已停止 Worker；请框选更小区域或切换 Tesseract。'));this.release();
      },timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.worker.postMessage({kind:'worker-transport-request',requestId:id,type,payload});
    });
  }
  async initialize(){
    if(this.ready)return;
    if(typeof Worker!=='function'||typeof createImageBitmap!=='function'||typeof OffscreenCanvas!=='function')throw new Error('此浏览器不支持 Paddle 所需的 Worker、ImageBitmap 或 OffscreenCanvas，请选择 Tesseract。');
    this.logger?.('载入 Paddle 隔离 Worker',null);
    this.worker=new Worker(assetURL('paddle/worker.js'),{type:'module',name:'ancient-paddle-ocr'});
    this.worker.onmessage=({data})=>{
      if(data?.kind==='paddle-progress'){this.logger?.(data.stage,data.percent??null);return;}
      if(data?.kind!=='worker-transport-response')return;
      const task=this.pending.get(data.requestId);if(!task)return;
      clearTimeout(task.timer);this.pending.delete(data.requestId);
      if(data.status==='success')task.resolve(data.payload);else task.reject(new Error(data.error?.message||'Paddle Worker 返回错误。'));
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(new Error(event.message||'Paddle Worker 中断，可能与资源加载、浏览器限制或内存有关，请切换 Tesseract。'));};
    this.worker.onmessageerror=()=>this.fail(new Error('Paddle Worker 通信失败，请切换 Tesseract。'));
    this.initialization=await this.request('init',{},120_000);this.ready=true;
  }
  fail(error){for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();this.release();}
  async transcribe(page,{orientation='vertical',onProgress,processing={}}={}){
    validateRegions(page.regions);
    this.logger=onProgress;const passes=[],segments=[];
    const options={scale:1,grayscale:false,contrast:100,binary:'none',memory:'auto',mobile:false,...processing};
    const notices=['Paddle 试用：保留全部原始候选，不按置信度替换为□；置信度不是正确率。繁简误识、异体字缺项及漏字仍需人工校对。'];
    if(!page.regions.length)notices.push('未框选正文时标题、印章和版心可能混入结果；复杂版面可分别框选、识别和校序。');
    try{
      await this.initialize();
      const selections=sortRegions(page.regions.length?page.regions:[{kind:'body',bbox:[0,0,1,1],id:'whole-page'}],orientation);
      for(const [index,region] of selections.entries()){
        const direction=region.orientation||orientation,start=performance.now();
        this.logger?.(`区域 ${index+1}/${selections.length} · 准备图像`,null);
        const observed=await this.request('predict',{file:page.file,bbox:region.bbox,processing:options,params:parameters},90_000);
        const raw=observed.result,ordered=sortItems(raw.items,direction),text=ordered.map(i=>i.text).join('\n'),rawText=raw.items.map(i=>i.text).join('\n');
        const detected=raw.items.map(item=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]),[x,y,w,h]=region.bbox;return {text:item.text,confidence:item.score,bbox:[x+Math.min(...xs)/raw.image.width*w,y+Math.min(...ys)/raw.image.height*h,(Math.max(...xs)-Math.min(...xs))/raw.image.width*w,(Math.max(...ys)-Math.min(...ys))/raw.image.height*h]};});
        const characters=raw.items.reduce((n,i)=>n+Array.from(i.text).length,0),regionId=region.id||`${region.kind}:${region.bbox.join(',')}`;
        segments.push({kind:region.kind,regionId,bbox:region.bbox,text,uncertain:[],detected,detected_characters:characters});
        passes.push({engine:'paddle',regionId,kind:region.kind,column:1,columnCount:1,bbox:region.bbox,orientation:direction,model:'PP-OCRv5_mobile',psm:null,processing:options,parameters,workingSize:observed.preparation.workingSize,memoryLimited:observed.preparation.limited,preparation:observed.preparation,raw,rawText,sortedRaw:text,markedText:text,confidenceMasking:false,detectedCharacters:characters,squareCount:Array.from(text).filter(c=>c==='□').length,wordBoxes:raw.items.length,lineBoxes:raw.metrics.detectedBoxes,elapsedMs:Math.round(performance.now()-start),initialization:this.initialization});
        if(observed.preparation.limited)notices.push(`Paddle 工作图已缩至 ${observed.preparation.workingSize.join('×')}，小字可能丢失；可框选较小区域保留细节。`);
        if(!characters)notices.push('Paddle 已完成但该区域无非空候选，不能据此认定原图无字；请检查原图、框选范围或换引擎。');
      }
      return {segments,passes,columns:[],warnings:[...new Set(notices)],settings:{engine:'paddle',orientation,mode:'whole',threshold:0,processing:options}};
    }catch(error){
      error.passes=passes;this.release();
      if(!error.cancelled&&/out of memory|allocation fail|cannot allocate/i.test(error.message))error.message='Paddle 内存分配失败，本页未完成；已有文字保留。请框选更小区域或切换 Tesseract。';
      throw error;
    }finally{this.logger=null;}
  }
}
