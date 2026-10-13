import { createWorker, OEM } from 'tesseract.js';
import { assetURL } from './assets.js';
import { cropCanvas, loadImage, splitColumns } from './images.js';
import { parseTSV, sortRegions, validateRegions } from './transcription.js';

const messages = { 'loading tesseract core':'载入识别引擎','initializing tesseract':'初始化识别引擎','loading language traineddata':'载入繁体模型','initializing api':'准备模型','recognizing text':'识别文字' };
const deadline = async (promise, ms, label) => {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]); }
  finally { clearTimeout(timer); }
};
const cancelledError = () => Object.assign(new Error('已停止本次识别。'),{cancelled:true});

export function tsvDiagnostics(tsv, bounds, width, height) {
  const detected=[],lines=[];
  for(const row of tsv.split('\n')){
    const parts=row.split('\t'),level=Number(parts[0]);if(level!==4&&level!==5)continue;
    const values=parts.slice(6,10).map(Number);if(values.length!==4||!values.every(Number.isFinite))continue;
    const [x,y,w,h]=values,[ox,oy,ow,oh]=bounds;
    const box={bbox:[ox+x/width*ow,oy+y/height*oh,w/width*ow,h/height*oh],confidence:Number(parts[10]),text:parts.slice(11).join('\t')};
    if(level===4)lines.push(box);else if(box.text.trim())detected.push(box);
  }
  return {detected,lines};
}

export class BrowserOCR {
  worker=null;language=null;logger=null;cancelled=false;epoch=0;cancelReject=null;

  async release(){this.epoch++;const worker=this.worker;this.worker=null;this.language=null;if(worker)await worker.terminate();}
  async cancel(){this.cancelled=true;if(this.worker){this.cancelReject?.(cancelledError());await this.release();}}

  async getWorker(orientation,model='auto') {
    const language=model==='auto'?(orientation==='vertical'?'chi_tra_vert':'chi_tra'):model;
    if(!['chi_tra_vert','chi_tra'].includes(language))throw new Error('不支持这个模型。');
    if(this.worker&&this.language===language)return this.worker;
    await this.release();
    if(!('WebAssembly' in window)||!('Worker' in window))throw new Error('浏览器不支持本地 OCR，请使用较新的浏览器。');
    const epoch=this.epoch;
    const pending=createWorker(language,OEM.LSTM_ONLY,{
      workerPath:assetURL('ocr/runtime/worker.min.js'),corePath:assetURL('ocr/runtime/core/tesseract-core-lstm.wasm.js'),langPath:assetURL('ocr/tessdata'),
      workerBlobURL:false,gzip:true,cacheMethod:'write',cachePath:'ancient-transcriber-tessdata-best-e12c65a9',errorHandler:()=>{},
      logger:event=>{if(epoch===this.epoch)this.logger?.(messages[event.status]??'准备识别',Math.round((event.progress??0)*100));},
    });
    // 初始化时库尚未提供 terminate 句柄；超时后，迟到的 Worker 一旦完成就释放。
    pending.then(worker=>{if(epoch!==this.epoch)worker.terminate();},()=>{});
    try{this.worker=await deadline(pending,120000,'模型加载超过两分钟，请检查本站资源下载后重试。');this.language=language;return this.worker;}
    catch(error){await this.release();throw new Error(error?.message||String(error||'模型或 Worker 未能加载。'));}
  }

  async transcribe(page,{orientation='vertical',threshold=65,onProgress,mode='whole',columnCount=0,psm='auto',model='auto',processing={}}={}) {
    this.cancelled=false;this.logger=onProgress;
    const options={scale:2,grayscale:false,contrast:100,binary:'none',memory:'auto',mobile:false,...processing};
    const notices=['检测数量是 OCR 输出数量，不是原图字数；□只代表低置信度。原始输出和坐标已保存，仍须逐字校对。'];
    validateRegions(page.regions);
    if(!page.regions.length)notices.push('未分区时标题、版心和正文仍可能混合。建议先框正文；分栏切线请对照原图检查。');
    const selections=sortRegions(page.regions.length?page.regions:[{kind:'body',bbox:[0,0,1,1],id:'whole-page'}],orientation);
    const image=await loadImage(page.url),segments=[],passes=[],columns=[];
    try{
      for(const region of selections){
        const direction=region.orientation||orientation,regionMode=region.mode||mode,regionPSM=region.psm||psm;
        const number=Number(region.columnCount??columnCount),id=region.id||`${region.kind}:${region.bbox.join(',')}`;
        const boxes=direction==='vertical'&&regionMode==='columns'?splitColumns(image,region.bbox,options,number):[region.bbox];
        if(regionMode==='columns'&&direction==='vertical'&&boxes.length===1&&!number)notices.push('像素投影未找到可靠的多列，已保留整区识别。可框出正文后重试，或指定均分列数。');
        const worker=await this.getWorker(direction,model);
        if(this.cancelled)throw cancelledError();
        const actualPSM=regionPSM==='auto'?(direction==='vertical'?'5':'6'):String(regionPSM);
        if(!['3','4','5','6','7','11','13'].includes(actualPSM))throw new Error('不支持这个页面分割模式。');
        // SetVariable 的值必须为字符串；PSM6/7不是竖排默认模式。
        await worker.setParameters({tessedit_pageseg_mode:actualPSM});
        const segment={kind:region.kind,regionId:id,bbox:region.bbox,text:'',uncertain:[],detected:[],detected_characters:0};
        const texts=[];
        for(let index=0;index<boxes.length;index++){
          if(this.cancelled)throw cancelledError();
          this.logger?.(`区域 ${segments.length+1} · 列 ${index+1}/${boxes.length}`,0);
          const bbox=boxes[index],{canvas,bounds,resized,threshold:binaryThreshold}=cropCanvas(image,bbox,options),cw=canvas.width,ch=canvas.height;
          const started=performance.now();let output;
          try{
            const stop=new Promise((_,reject)=>{this.cancelReject=reject;});
            output=await deadline(Promise.race([worker.recognize(canvas,{},{tsv:true,text:true}),stop]),90000,'本区域识别超时；请分成更小区域或使用节省内存模式。');
          }finally{this.cancelReject=null;canvas.width=0;canvas.height=0;}
          const raw=parseTSV(output.data.tsv,0,direction),marked=parseTSV(output.data.tsv,threshold,direction),diagnostic=tsvDiagnostics(output.data.tsv,bounds,cw,ch);
          const [ox,oy,ow,oh]=bounds;
          for(const mark of marked.uncertain){const[x,y,w,h]=mark.bbox;mark.bbox=[ox+x/cw*ow,oy+y/ch*oh,w/cw*ow,h/ch*oh];}
          texts.push(marked.text);segment.uncertain.push(...marked.uncertain);segment.detected.push(...diagnostic.detected);segment.detected_characters+=raw.detectedCharacters;
          const record={regionId:id,kind:region.kind,column:index+1,columnCount:boxes.length,bbox,orientation:direction,model:this.language,psm:actualPSM,processing:options,binaryThreshold,workingSize:[cw,ch],memoryLimited:resized,
            wordBoxes:diagnostic.detected.length,lineBoxes:diagnostic.lines.length,detectedCharacters:raw.detectedCharacters,squareCount:Array.from(marked.text).filter(c=>c==='□').length,
            rawText:output.data.text??'',rawTSV:output.data.tsv,sortedRaw:raw.text,markedText:marked.text,elapsedMs:Math.round(performance.now()-started)};
          passes.push(record);columns.push({bbox,regionId:id,column:index+1,kind:region.kind});
          if(resized)notices.push(`识别用图 ${cw}×${ch} 已按内存预算缩放；可分栏或框更小区域以保留字形细节。`);
          if(!raw.detectedCharacters)notices.push('模型已加载，但有区域没有检测字词。请看检测框、预处理和原始输出，不能据空结果认定原图无字。');
        }
        segment.text=texts.join('\n');segments.push(segment);
      }
    }catch(error){const failure=error instanceof Error?error:new Error(String(error));failure.passes=passes;await this.release();throw failure;}
    finally{image.src='';this.logger=null;}
    return {segments,passes,columns,warnings:[...new Set(notices)],settings:{orientation,threshold,mode,columnCount,psm,model,processing:options}};
  }
}
