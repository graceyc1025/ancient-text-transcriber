import {readFile,writeFile,mkdir,cp,copyFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
await mkdir(path.join(here,'public/ort'),{recursive:true});
await cp(path.join(root,'public/ocr'),path.join(here,'public/ocr'),{recursive:true});
await cp(path.join(root,'public/images'),path.join(here,'public/images'),{recursive:true});
await copyFile(path.join(root,'models/manifest.json'),path.join(here,'public/tesseract-models.json'));
await cp(path.join(here,'licenses'),path.join(here,'public/licenses'),{recursive:true});
const manifest=JSON.parse(await readFile(path.join(here,'models.json'),'utf8')),assets=[];
await mkdir(path.join(here,'public/models'),{recursive:true});
try{await copyFile(path.join(here,'models/LICENSE.txt'),path.join(here,'public/models/LICENSE.txt'));}catch(error){if(error.code!=='ENOENT')throw error;}
for(const model of manifest.models){
  let bytes;try{bytes=await readFile(path.join(here,'models',model.file));}catch(error){if(error.code!=='ENOENT')throw error;assets.push({...model,available:false,bytes:null});continue;}
  if(!model.sha256)throw new Error(`Unpinned model: ${model.name}. Use import-community-models.mjs to verify and record its SHA-256 first.`);
  if(createHash('sha256').update(bytes).digest('hex')!==model.sha256)throw new Error(`Model checksum mismatch: ${model.name}`);
  await copyFile(path.join(here,'models',model.file),path.join(here,'public/models',model.file));assets.push({...model,available:true,bytes:bytes.byteLength});
}
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])await copyFile(path.join(here,'node_modules/onnxruntime-web/dist',name),path.join(here,'public/ort',name));
const runtimeBytes=(await stat(path.join(here,'public/ort/ort-wasm-simd-threaded.wasm'))).size;
await writeFile(path.join(here,'public/model-status.json'),JSON.stringify({variant:manifest.variant||'official',assets,ort:{version:'1.22.0',runtimeBytes},sdk:'0.4.2'},null,2));
console.log(assets.every(a=>a.available)?'Pinned Paddle models ready.':'Paddle models unavailable: import the pinned experiment weights before real recognition.');
