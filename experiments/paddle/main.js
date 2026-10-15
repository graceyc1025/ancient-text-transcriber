import {initialize,recognize,release,score} from './engine.js';
import './style.css';
const $=id=>document.getElementById(id);let selected=null,last=null,url=null;
function setImage(file){selected=file;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);$('preview').src=url;}
$('image').onchange=()=>{if($('image').files[0])setImage($('image').files[0]);};
$('sample').onclick=async()=>{const response=await fetch(new URL('images/example.png',document.baseURI));setImage(await response.blob());};
$('run').onclick=async()=>{if(!selected){$('status').textContent='请先选择图片。';return;}$('run').disabled=true;$('output').value='';last=null;$('details').textContent='';$('status').textContent='正在浏览器本地运行真实模型…';
  try{last=await recognize(selected,{kind:$('engine').value,mode:$('mode').value,orientation:$('orientation').value});$('output').value=last.text;last.evaluation=score($('truth').value,last.text);$('details').textContent=JSON.stringify({initialization:last.initialization,inferenceMs:last.inferenceMs,evaluation:last.evaluation},null,2);$('status').textContent='运行完成。输出仍须逐字核对。';}
  catch(error){$('status').textContent=`未完成识别：${error.message}`;}finally{$('run').disabled=false;}};
$('download').onclick=()=>{if(!last)return;const link=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(last,null,2)],{type:'application/json'}));link.href=u;link.download='ocr-experiment.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
window.ocrExperiment={initialize,recognize,release,score};
