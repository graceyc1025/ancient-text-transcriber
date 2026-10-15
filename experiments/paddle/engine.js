import {BrowserOCR} from '../../src/ocr.js';
import {loadImage,cropCanvas} from '../../src/images.js';
import {editOperations} from '../../src/evaluation.js';

const base=path=>new URL(path,document.baseURI).href;
let active=null;
export async function release(){if(active?.kind==='tesseract')await active.instance.release();if(active?.kind==='paddle')await active.instance.dispose();active=null;}
export async function initialize(kind,orientation='vertical'){
  if(active?.kind===kind&&(kind==='paddle'||active.orientation===orientation))return active.initialization;
  await release();const start=performance.now();
  if(kind==='tesseract'){const instance=new BrowserOCR();await instance.getWorker(orientation);active={kind,instance,orientation};}
  else{
    const status=await (await fetch(base('model-status.json'))).json();
    if(status.assets.some(a=>!a.available))throw new Error('PaddleOCR官方模型尚未下载，不能进行真实Paddle识别；没有模拟结果。');
    const {PaddleOCR}=await import('@paddleocr/paddleocr-js');
    const instance=await PaddleOCR.create({textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'PP-OCRv5_mobile_rec',textDetectionModelAsset:{url:base('models/PP-OCRv5_mobile_det.tar')},textRecognitionModelAsset:{url:base('models/PP-OCRv5_mobile_rec.tar')},textDetectionBatchSize:1,textRecognitionBatchSize:1,worker:false,ortOptions:{backend:'wasm',numThreads:1,proxy:false,wasmPaths:base('ort/')}});
    active={kind,instance};
  }
  active.initialization={elapsedMs:performance.now()-start,kind,summary:active.instance.getInitializationSummary?.()??null};return active.initialization;
}
export function sortItems(items,orientation){
  const boxes=items.map((item,index)=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;return {index,x,y,w,h,item};});
  // Geometric grouping only. No vocabulary, reference text, or context is used.
  boxes.sort((a,b)=>orientation==='vertical'?(b.x+b.w/2)-(a.x+a.w/2)||a.y-b.y:a.y-b.y||a.x-b.x);
  const groups=[];for(const box of boxes){const center=orientation==='vertical'?box.x+box.w/2:box.y+box.h/2,extent=orientation==='vertical'?box.w:box.h;
    let group=groups.find(g=>Math.abs(g.center-center)<=.6*Math.min(g.extent,extent));if(!group){group={center,extent,boxes:[]};groups.push(group);}group.boxes.push(box);}
  return groups.flatMap(g=>g.boxes.sort((a,b)=>orientation==='vertical'?a.y-b.y:a.x-b.x)).map(b=>b.item);
}
export function score(reference,text){const truth=reference.replace(/\s/gu,''),candidate=text.replace(/\s/gu,'');if(!truth)return null;const errors=editOperations(truth,candidate);return {...errors,correctAlignedCharacters:errors.referenceCharacters-errors.substitutions-errors.deletions,note:'Aligned matches; reference supplied by a human, never passed to OCR.'};}
export async function recognize(blob,{kind='tesseract',mode='whole',orientation='vertical',tesseractScale=2}={}){
  const initialization=await initialize(kind,orientation),start=performance.now(),url=URL.createObjectURL(blob);
  try{
    if(kind==='tesseract'){
      const result=await active.instance.transcribe({url,regions:[]},{orientation,threshold:0,mode:mode==='columns'?'columns':'whole',columnCount:mode==='columns'?3:0,processing:{scale:tesseractScale,memory:'standard',mobile:false}});
      return {engine:kind,orientation,mode,initialization,inferenceMs:performance.now()-start,text:result.passes.map(p=>p.sortedRaw).join('\n'),originalText:result.passes.map(p=>p.rawText).join('\n'),passes:result.passes};
    }
    const image=await loadImage(url),boxes=mode==='columns'?[2,1,0].map(i=>[i/3,0,1/3,1]):[[0,0,1,1]],passes=[];
    try{for(const box of boxes){const {canvas}=cropCanvas(image,box,{scale:1,memory:'standard',mobile:false,grayscale:false,contrast:100,binary:'none'});
      try{const result=await active.instance.predict(canvas,{textRecScoreThresh:0,textDetLimitSideLen:960,textDetLimitType:'max',textDetMaxSideLimit:4000});
        const raw=result[0];passes.push({bbox:box,workingSize:[canvas.width,canvas.height],raw,text:sortItems(raw.items,orientation).map(i=>i.text).join('\n')});
      }finally{canvas.width=0;canvas.height=0;}}
    }finally{image.src='';}
    return {engine:kind,orientation,mode,initialization,inferenceMs:performance.now()-start,text:passes.map(p=>p.text).join('\n'),originalText:passes.flatMap(p=>p.raw.items.map(i=>i.text)).join('\n'),passes};
  }finally{URL.revokeObjectURL(url);}
}
