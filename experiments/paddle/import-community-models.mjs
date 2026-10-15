// Explicit, reproducible alternative to the inaccessible official asset host.
// No weights are modified. ORT detection + ONNX recognition are packed for the
// official SDK. Community exports are NOT claimed bit-identical to BCE tarballs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const archive=process.argv[2];if(!archive)throw new Error('Pass pdfmarkdown-ppocrv5-models-1.0.0.tgz obtained with npm pack --ignore-scripts.');
const bytes=await readFile(archive),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
if(integrity!=='sha512-BDxXJ0k2Sk5eozXHUVMdYCR3WEurOBmHV4tkk4a/Zzds4Nk6q1UzQ6SuGLETUbFkL8ATm1925AoedBCanysdyg==')throw new Error('npm archive integrity mismatch');
const extract=name=>{const r=spawnSync('tar',['-xOf',archive,`package/${name}`],{maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(`Cannot extract ${name}`);return r.stdout;};
const directory=new URL('models/',import.meta.url);await mkdir(directory,{recursive:true});
const dict=await readFile(new URL('ppocrv5-official-dict.txt',import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
if(hash(dict)!=='d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b')throw new Error('Official dictionary checksum mismatch');
function tar(entries){const blocks=[];for(const[name,data]of entries){const h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100,8);h.write('0000000\0',108,8);h.write('0000000\0',116,8);h.write(data.length.toString(8).padStart(11,'0')+'\0',124,12);h.write('00000000000\0',136,12);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6);h.write('00',263,2);const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));}blocks.push(Buffer.alloc(1024));return Buffer.concat(blocks);}
const models=[];
for(const[kind,name,input,expected]of [
  ['det','PP-OCRv5_mobile_det','detection/PP-OCRv5_mobile_det_infer.ort','30acfc4e21f2a23669d01a75aaeb92190f96874613108a0f7086bed264420abc'],
  ['rec','PP-OCRv5_mobile_rec','recognition/PP-OCRv5_mobile_rec_infer.onnx','d253c3cbee6e507828a5271a30ab0ec8ae7c2a99d0cc8e6f844fe380809d22b3']]){
  const weights=extract(input);if(hash(weights)!==expected)throw new Error(`Upstream LFS hash mismatch for ${input}`);
  const config={Global:{model_name:name},PreProcess:{transform_ops:kind==='rec'?[{RecResizeImg:{image_shape:[3,48,320]}}]:[{DetResizeForTest:{resize_long:960,limit_type:'max',max_side_limit:4000}},{NormalizeImage:{mean:[.485,.456,.406],std:[.229,.224,.225],scale:1/255}}]},PostProcess:kind==='rec'?{name:'CTCLabelDecode',character_dict:dict.toString('utf8').trimEnd().split('\n')}:{name:'DBPostProcess',thresh:.3,box_thresh:.6,max_candidates:1000,unclip_ratio:1.5}};
  const packed=tar([['inference.onnx',weights],['inference.yml',Buffer.from(JSON.stringify(config))]]),file=`${name}.tar`;await writeFile(new URL(file,directory),packed);
  models.push({name,file,sha256:hash(packed),bytes:packed.length,weightSHA256:expected,weightBytes:weights.length,weightFormat:kind==='det'?'ORT':'ONNX'});
}
await writeFile(new URL('LICENSE.txt',directory),extract('LICENSE'));
await writeFile(new URL('models.json',import.meta.url),JSON.stringify({variant:'community-export',source:'pdfmarkdown-ppocrv5-models@1.0.0; upstream PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models',upstreamCommit:'384182c7187c12d4ea181ae3b97c8b7e12089d9d',packageIntegrity:integrity,dictionarySHA256:hash(dict),note:'Official SDK, community-exported weights. Custom SDK inference config uses official character dictionary. ORT data is in the SDK-required inference.onnx tar entry; ONNX Runtime autodetects its format.',models},null,2)+'\n');
console.log('Verified community export imported. It is not the official BCE archive.');
