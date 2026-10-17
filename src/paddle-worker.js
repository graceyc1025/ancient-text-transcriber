// Served as a same-origin, non-blob module Worker. Heavy SDK/OpenCV never enter
// the editor realm. The editor's strict CSP is unchanged. Version-pinned SDK
// uses dynamic code internally in this isolated worker, not in the document.
import {memoryBudget,workingSize,processPixels} from './processing.js';
const send=self.postMessage.bind(self),progress=(stage,percent=null)=>send({kind:'paddle-progress',stage,percent});
const base=new URL('./',import.meta.url),nativeFetch=self.fetch.bind(self);
let sdkHandler,config,boot=null;
const metadata=new Map();
// Restrict explicit SDK fetches; no models from CDN or uploads. OpenCV's fixed
// embedded WASM is a data: URL. Dynamic ORT imports use explicit local paths.
self.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url??input,base);
  if((init?.method??(input instanceof Request?input.method:'GET'))!=='GET')throw new Error('Paddle 仅允许读取本地资源。');
  if(url.protocol==='data:'){
    if(!url.href.startsWith('data:application/octet-stream;base64,'))throw new Error('不支持的内嵌资源。');
    return nativeFetch(input,init);
  }
  if(url.origin!==base.origin||!url.href.startsWith(base.href))throw new Error('拒绝加载非本站 Paddle 资源。');
  const response=await nativeFetch(input,init);
  if(!response.ok)throw new Error(`Paddle 资源下载失败 HTTP ${response.status}：${url.pathname.split('/').at(-1)}`);
  const filename=url.pathname.split('/').at(-1),expected=config?.files?.[filename]?.bytes;
  if(!response.body||!expected)return response;
  const reader=response.body.getReader();let read=0,last=-1;
  return new Response(new ReadableStream({async pull(controller){
    try{const {done,value}=await reader.read();if(done){controller.close();return;}read+=value.byteLength;const percent=Math.min(100,Math.floor(read/expected*100));if(percent>=last+5){last=percent;progress(`下载 ${filename} · ${(read/1024/1024).toFixed(1)} MB`,percent);}controller.enqueue(value);}catch(e){controller.error(e);}
  },cancel(reason){return reader.cancel(reason);}}),{status:response.status,headers:response.headers});
};
self.postMessage=(message,...args)=>{
  const meta=metadata.get(message?.requestId);
  if(message?.kind==='worker-transport-response'){
    if(message.status==='success'&&meta)message={...message,payload:{result:message.payload[0],preparation:meta}};
    if(message.status==='success'&&message.payload?.summary)message={...message,payload:{...message.payload,versions:config.versions,modelManifest:config.models}};
    metadata.delete(message.requestId);
  }
  send(message,...args);
};
async function loadSDK(){
  progress('读取 Paddle 固定资源清单');
  config=await (await fetch(new URL('config.json',base))).json();
  if(config.versions.ort!==config.versions.wasm)throw new Error('ORT 与 WASM 版本不一致，已停止初始化。');
  progress('载入隔离 SDK / OpenCV / WASM');
  await import('./runtime/sdk-worker.js');sdkHandler=self.onmessage;self.onmessage=handle;
}
async function handle(event){
  const message=event.data;if(message?.kind!=='worker-transport-request')return;
  try{
    if(message.type==='init'){
      await (boot??=loadSDK());
      const pipelineConfig=structuredClone(config.pipelineConfig);
      for(const asset of Object.values(pipelineConfig.assets))asset.url=new URL(asset.url,base).href;
      progress('初始化检测 / 识别模型');
      sdkHandler({data:{...message,payload:{options:{pipelineConfig,ortOptions:{backend:'wasm',numThreads:1,proxy:false,disableWasmProxy:true,wasmPaths:new URL('ort/',base).href}}}}});
    }else if(message.type==='predict'){
      if(!sdkHandler)throw new Error('Paddle 尚未初始化。');
      const {file,bbox,processing,params}=message.payload;
      const source=await createImageBitmap(file);
      let canvas,bitmap;
      try{
        if(source.width*source.height>25_000_000)throw new Error('图片超过2500万像素，请缩小后重试。');
        const [x,y,w,h]=bbox,left=Math.round(x*source.width),top=Math.round(y*source.height),width=Math.round((x+w)*source.width)-left,height=Math.round((y+h)*source.height)-top;
        if(width<5||height<5)throw new Error('框选区域太小。');
        const size=workingSize(width,height,processing.scale,memoryBudget(processing.memory,processing.mobile));
        progress(`图像处理 ${size.width}×${size.height}`);
        canvas=new OffscreenCanvas(size.width,size.height);const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx)throw new Error('无法创建 Worker 图像画布。');
        ctx.fillStyle='white';ctx.fillRect(0,0,size.width,size.height);ctx.drawImage(source,left,top,width,height,0,0,size.width,size.height);
        if(processing.grayscale||processing.binary!=='none'||Number(processing.contrast)!==100){const result=processPixels(ctx.getImageData(0,0,size.width,size.height),processing);ctx.putImageData(result.imageData,0,0);}
        bitmap=canvas.transferToImageBitmap();metadata.set(message.requestId,{workingSize:[size.width,size.height],limited:size.limited,scale:size.scale,sourceCrop:[left,top,width,height]});
      }finally{source.close();if(canvas)canvas.width=canvas.height=0;}
      progress('检测与识别中 · 完成后返回结果（无逐字百分比）');
      sdkHandler({data:{...message,payload:{sources:[{kind:'imageBitmap',imageBitmap:bitmap}],params}}});
    }else throw new Error('不支持的 Paddle 操作。');
  }catch(error){metadata.delete(message.requestId);send({kind:'worker-transport-response',requestId:message.requestId,status:'error',error:{message:error.message}});}
}
self.onmessage=handle;
