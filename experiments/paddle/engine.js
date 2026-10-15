import {BrowserOCR} from '../../src/ocr.js';
import {loadImage,cropCanvas} from '../../src/images.js';
import {evaluate,columnBoxes,rawTSVLines} from './evaluation.js';

const base=path=>new URL(path,document.baseURI).href;
let active=null;
async function deadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}}
export async function release(){if(active?.kind==='tesseract')await active.instance.release();if(active?.kind==='paddle')await active.instance.dispose();active=null;}
export async function initialize(kind,orientation='vertical'){
  if(!['tesseract','paddle'].includes(kind))throw new Error('未知识别引擎。');
  if(active?.kind===kind&&(kind==='paddle'||active.orientation===orientation))return {...active.initialization,originalInitializationMs:active.initialization.elapsedMs,elapsedMs:0,reused:true};
  await release();const start=performance.now();
  if(kind==='tesseract'){const instance=new BrowserOCR();await instance.getWorker(orientation);active={kind,instance,orientation};}
  else{
    const status=await (await fetch(base('model-status.json'))).json();
    if(status.assets.some(a=>!a.available))throw new Error('本实验固定的Paddle模型尚未下载，不能进行真实Paddle识别；没有模拟结果。');
    const {PaddleOCR}=await import('@paddleocr/paddleocr-js');
    const instance=await PaddleOCR.create({textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'PP-OCRv5_mobile_rec',textDetectionModelAsset:{url:base('models/PP-OCRv5_mobile_det.tar')},textRecognitionModelAsset:{url:base('models/PP-OCRv5_mobile_rec.tar')},textDetectionBatchSize:1,textRecognitionBatchSize:1,worker:false,ortOptions:{backend:'wasm',numThreads:1,proxy:false,wasmPaths:base('ort/')}});
    active={kind,instance};
  }
  active.initialization={elapsedMs:performance.now()-start,kind,reused:false,summary:active.instance.getInitializationSummary?.()??null};return active.initialization;
}
export function sortItems(items,orientation){
  const boxes=items.map((item,index)=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;return {index,x,y,w,h,item};});
  // Geometric grouping only. No vocabulary, reference text, or context is used.
  boxes.sort((a,b)=>orientation==='vertical'?(b.x+b.w/2)-(a.x+a.w/2)||a.y-b.y:a.y-b.y||a.x-b.x);
  const groups=[];for(const box of boxes){const center=orientation==='vertical'?box.x+box.w/2:box.y+box.h/2,extent=orientation==='vertical'?box.w:box.h;
    let group=groups.find(g=>Math.abs(g.center-center)<=.6*Math.min(g.extent,extent));if(!group){group={center,extent,boxes:[]};groups.push(group);}group.boxes.push(box);}
  return groups.flatMap(g=>g.boxes.sort((a,b)=>orientation==='vertical'?a.y-b.y:a.x-b.x)).map(b=>b.item);
}
export function score(reference,text,options){if(!reference)return null;return evaluate(reference,text,options);}
export async function recognize(blob,{kind='tesseract',mode='whole',orientation='vertical',tesseractScale=2,imageScale,columnCount=3,columnCuts=''}={}){
  if(!['whole','columns'].includes(mode))throw new Error('未知识别方式。');
  const boxes=mode==='columns'?columnBoxes({columnCount,columnCuts,orientation}):[[0,0,1,1]],scale=imageScale??(kind==='tesseract'?tesseractScale:1);
  const predictorParams={textRecScoreThresh:0,textDetLimitSideLen:960,textDetLimitType:'max',textDetMaxSideLimit:4000,textDetThresh:.3,textDetBoxThresh:.6,textDetUnclipRatio:2},psm=orientation==='vertical'?'5':'6';
  const initialization=await initialize(kind,orientation),start=performance.now(),url=URL.createObjectURL(blob);
  const passes=[];
  try{
    const image=await loadImage(url);
    if(kind==='tesseract')await active.instance.worker.setParameters({tessedit_pageseg_mode:psm});
    try{for(const box of boxes){
      // Both engines receive the same crop/scale/budget, independent of truth.
      const working=cropCanvas(image,box,{scale,memory:'standard',mobile:false,grayscale:false,contrast:100,binary:'none'}),target=working.canvas;
      try{
        if(kind==='tesseract'){
          const output=await deadline(active.instance.worker.recognize(target,{},{tsv:true,text:true}),90_000,'该栏识别超过90秒；已完成栏的原始输出会保留。');
          const rawText=output.data.text??'',rawTSV=output.data.tsv,items=rawTSVLines(rawTSV),text=sortItems(items,orientation).map(i=>i.text).join('\n');
          passes.push({bbox:box,workingSize:[target.width,target.height],memoryLimited:working.resized,model:active.instance.language,psm,rawText,rawTSV,sortedRaw:text,text,confidenceMasking:false});
        }else{
          const result=await deadline(active.instance.predict(target,predictorParams),90_000,'该栏识别超过90秒；请缩小区域后测试。'),raw=result[0];
          passes.push({bbox:box,workingSize:[target.width,target.height],memoryLimited:working.resized,raw,text:sortItems(raw.items,orientation).map(i=>i.text).join('\n'),confidenceMasking:false});
        }
      }finally{target.width=0;target.height=0;}}
    }finally{image.src='';}
    return {pipelineVersion:'raw-candidate-comparison-v2',engine:kind,orientation,mode,initialization,inferenceMs:performance.now()-start,imageScale:scale,parameters:kind==='tesseract'?{tessedit_pageseg_mode:psm}:{...predictorParams,batchSize:1},processing:{grayscale:false,contrast:100,binary:'none',maxWorkingPixels:5_000_000},confidenceMasking:false,text:passes.map(p=>p.text).join('\n'),originalText:kind==='tesseract'?passes.map(p=>p.rawText).join('\n'):passes.flatMap(p=>p.raw.items.map(i=>i.text)).join('\n'),passes};
  }catch(error){error.partialPasses=passes;throw error;}finally{URL.revokeObjectURL(url);}
}
