import {readFile,writeFile,mkdir,copyFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'public/paddle');
const hash=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(path.join(root,'experiments/paddle/models.json'),'utf8'));
const sdk=path.join(root,'node_modules/@paddleocr/paddleocr-js'),ort=path.join(root,'node_modules/onnxruntime-web');
const sdkPackage=JSON.parse(await readFile(path.join(sdk,'package.json'))),ortPackage=JSON.parse(await readFile(path.join(ort,'package.json')));
if(sdkPackage.version!=='0.4.2'||ortPackage.version!=='1.24.3')throw new Error('Paddle SDK/ORT 版本不符。');
const workerName=(await readdir(path.join(sdk,'dist/assets'))).find(x=>/^worker-entry-.*\.js$/.test(x)),worker=await readFile(path.join(sdk,'dist/assets',workerName));
if(hash(worker)!=='477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52'||!worker.includes(Buffer.from('ONNX Runtime Web v1.24.3')))throw new Error('SDK Worker 字节或内嵌 ORT 版本不符。');
const dictionary=await readFile(path.join(root,'experiments/paddle/ppocrv5-official-dict.txt'));
if(hash(dictionary)!==manifest.dictionarySHA256)throw new Error('Paddle 官方字典校验失败。');
function tar(entries){const blocks=[];for(const[name,data]of entries){const h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100,8);h.write('0000000\0',108,8);h.write('0000000\0',116,8);h.write(data.length.toString(8).padStart(11,'0')+'\0',124,12);h.write('00000000000\0',136,12);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6);h.write('00',263,2);h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));}blocks.push(Buffer.alloc(1024));return Buffer.concat(blocks);}
await rm(output,{recursive:true,force:true});
for(const folder of ['models','runtime','ort','licenses'])await mkdir(path.join(output,folder),{recursive:true});
const files={};
for(const [i,input]of ['detection/PP-OCRv5_mobile_det_infer.ort','recognition/PP-OCRv5_mobile_rec_infer.onnx'].entries()){
  const model=manifest.models[i],weights=await readFile(path.join(root,'node_modules/pdfmarkdown-ppocrv5-models',input));
  if(hash(weights)!==model.weightSHA256)throw new Error(`Paddle 权重校验失败：${input}`);
  const config={Global:{model_name:model.name},PreProcess:{transform_ops:i===1?[{RecResizeImg:{image_shape:[3,48,320]}}]:[{DetResizeForTest:{resize_long:960,limit_type:'max',max_side_limit:4000}},{NormalizeImage:{mean:[.485,.456,.406],std:[.229,.224,.225],scale:1/255}}]},PostProcess:i===1?{name:'CTCLabelDecode',character_dict:dictionary.toString('utf8').trimEnd().split('\n')}:{name:'DBPostProcess',thresh:.3,box_thresh:.6,max_candidates:1000,unclip_ratio:1.5}};
  const packed=tar([['inference.onnx',weights],['inference.yml',Buffer.from(JSON.stringify(config))]]);
  if(hash(packed)!==model.sha256)throw new Error(`Paddle tar 校验失败：${model.name}`);
  await writeFile(path.join(output,'models',model.file),packed);files[model.file]={bytes:packed.length,sha256:hash(packed)};
}
await writeFile(path.join(output,'runtime/sdk-worker.js'),worker);
files['sdk-worker.js']={bytes:worker.length,sha256:hash(worker)};
for(const name of ['ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
  const bytes=await readFile(path.join(ort,'dist',name));await writeFile(path.join(output,'ort',name),bytes);files[name]={bytes:bytes.length,sha256:hash(bytes)};
}
for(const name of ['paddle-worker.js','processing.js'])await copyFile(path.join(root,'src',name),path.join(output,name==='paddle-worker.js'?'worker.js':name));
for(const name of await readdir(path.join(root,'experiments/paddle/licenses')))await copyFile(path.join(root,'experiments/paddle/licenses',name),path.join(output,'licenses',name));
await copyFile(path.join(root,'node_modules/pdfmarkdown-ppocrv5-models/LICENSE'),path.join(output,'licenses/community-models-LICENSE.txt'));
const pipelineConfig={pipelineName:'OCR',modelSelection:{textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'PP-OCRv5_mobile_rec'},assets:{det:{url:'models/PP-OCRv5_mobile_det.tar'},rec:{url:'models/PP-OCRv5_mobile_rec.tar'}},runtimeDefaults:{text_det_limit_side_len:960,text_det_limit_type:'max',text_det_max_side_limit:4000,text_det_thresh:.3,text_det_box_thresh:.6,text_det_unclip_ratio:2,text_rec_score_thresh:0},pipelineBatchSize:1,textDetectionBatchSize:1,textRecognitionBatchSize:1,warnings:[]};
await writeFile(path.join(output,'config.json'),JSON.stringify({versions:{sdk:'0.4.2',ort:'1.24.3',wasm:'1.24.3'},models:manifest,pipelineConfig,files},null,2)+'\n');
console.log('Paddle：固定社区权重/字典/SDK Worker 校验通过，ORT/WASM统一1.24.3；资源仅供同源按需加载。');
