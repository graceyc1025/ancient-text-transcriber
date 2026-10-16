import {test} from 'node:test';import assert from 'node:assert/strict';
// Pure evaluation/geometry are independent of browser model initialization.
import {editOperations} from '../../src/evaluation.js';
import {sortItems,score} from './engine.js';
import {evaluate,columnBoxes,rawTSVLines} from './evaluation.js';
import {validateSettings,recordsCSV} from './cases.js';
import {columnProfile,refineCuts,preparationGeometry,auditColumnBoxes,overlappingLines} from './columns.js';
import {predictWithTrace} from './paddle-trace.js';
test('旧输入默认保持原方式；修复只改变分栏图像、不改变整页参数',()=>{
  assert.equal(validateSettings({}).columnProfile,'legacy');
  assert.equal(columnProfile('repaired','paddle','vertical').padding,1);
  assert.equal(columnProfile('repaired','tesseract','vertical').effective,'legacy');
  assert.equal(columnProfile('repaired','paddle','horizontal').effective,'legacy');
  const g=preparationGeometry(150,2700,columnProfile('padding','paddle','vertical'));assert.deepEqual(g.workingSize,[450,2700]);assert.deepEqual(g.sourceSize,[150,2700]);
  const bounded=preparationGeometry(2200,7000,columnProfile('padding','paddle','vertical'));assert(bounded.workingSize[0]*bounded.workingSize[1]<5_010_000);assert(bounded.scale<1);
});
test('切线移动只依据墨迹且有限，移动前后每个像素恰归一栏',()=>{
  const density=Array(120).fill(1);density.fill(0,36,39);density.fill(0,83,86);
  const cuts=refineCuts(density,[0,40,80,120]);assert(cuts[1]<40&&cuts[2]>80);assert(Math.abs(cuts[1]-40)<=7);assert(Math.abs(cuts[2]-80)<=7);
  const boxes=cuts.slice(0,-1).map((x,i)=>[x/120,0,(cuts[i+1]-x)/120,1]);const audit=auditColumnBoxes(boxes.reverse(),120,400);assert(audit.fullCoverage);assert.equal(audit.overlapPixels,0);assert.equal(audit.gapPixels,0);
  const ownership=new Uint8Array(120);for(const [a,,b]of audit.rectangles)for(let x=a;x<b;x++)ownership[x]++;assert([...ownership].every(n=>n===1));
  assert.deepEqual(refineCuts(Array(120).fill(0),[0,40,80,120]),[0,40,80,120]);
  assert.equal(auditColumnBoxes([[0,0,.6,1],[.5,0,.5,1]],120,400).overlapPixels,12);
});
test('相交框审计不按相似文字去重，也不修改低置信候选',()=>{
  const item=(a,b,text)=>({poly:[[a,0],[b,0],[b,100],[a,100]],text});const items=[item(0,100,'□'),item(10,90,'不同'),item(110,120,'□')];const original=structuredClone(items);
  assert.equal(overlappingLines(items).length,1);assert.deepEqual(items,original);
});
test('SDK中间结果观察保留空文本/非有限分数，恢复方法并透传失败（非OCR模拟评测）',async()=>{
  const raw={items:[]},detResult=[{boxes:[{poly:[[0,0],[1,0],[1,2],[0,2]]}]}],recResult=[{text:'',score:NaN},{text:'𠮷',score:0}];
  const instance={detModel:{predict:async()=>detResult},recModel:{predict:async()=>recResult},async predict(){assert.equal(await this.detModel.predict(),detResult);assert.equal(await this.recModel.predict(),recResult);return raw;}};
  const det=instance.detModel.predict,rec=instance.recModel.predict,observed=await predictWithTrace(instance,null,{});assert.equal(observed.result,raw);assert.equal(observed.trace.recognitions[0][0].text,'');assert.equal(observed.trace.recognitions[0][0].scoreFinite,false);assert.equal(instance.detModel.predict,det);assert.equal(instance.recModel.predict,rec);
  instance.predict=async()=>{throw new Error('actual inference failure');};await assert.rejects(()=>predictWithTrace(instance,null,{}),/actual inference failure/);assert.equal(instance.detModel.predict,det);assert.equal(instance.recModel.predict,rec);
});
test('对照评分不把简体、缺字或错误列序视作正确',()=>{
  const reference='學習說慍';assert.equal(editOperations(reference,'学习说愠').distance,4);
  const omitted=editOperations('有朋自遠方來','有朋自方來');assert.equal(omitted.deletions,1);assert.equal(omitted.substitutions,0);
  assert(editOperations('甲乙丙丁','丙丁甲乙').distance>0);
});
test('新CER保留繁简、异体、变体序列和原文标点，提供可复核对齐',()=>{
  const e=evaluate('學𠮷葛\u{E0100}。','学吉葛。');assert(e.scorable);assert.equal(e.substitutions,2);assert.equal(e.deletions,1);assert.equal(e.distance,3);assert.equal(e.referenceCharacters,5);
  assert.equal(e.alignment.filter(x=>x.type!=='match').length,3);
  assert.equal(evaluate('甲','甲乙丙').CER,2); // CER is not clamped to 100%.
  assert.equal(evaluate('甲　乙','甲乙').deletions,1);
  assert.equal(evaluate('甲 \n乙','甲乙').CER,0);assert.equal(evaluate('甲\n乙','甲乙',{whitespace:'strict'}).deletions,1);
});
test('标准未校对、空白、存疑或过大时保留原因，不能伪报准确率',()=>{
  for(const[reference,options]of [['',{}],['□',{}],['�',{}],['甲',{reviewed:false}]]){const e=evaluate(reference,'□',options);assert.equal(e.scorable,false);assert.equal(e.CER,null);assert(e.reason);}
  assert.equal(evaluate('甲'.repeat(2100),'甲'.repeat(2100)).CER,null);
});
test('两引擎共享任意列数/自定义切线，完整覆盖原图且竖排从右至左',()=>{
  const plan=validateSettings({columnCuts:'0, 12, 50, 100',imageScale:1});assert.deepEqual(plan.columnBoxes,[[.5,0,.5,1],[.12,0,.38,1],[0,0,.12,1]]);
  assert.equal(columnBoxes({columnCount:7}).length,7);assert.equal(columnBoxes({columnCount:2,orientation:'horizontal'})[0][0],0);
  for(const columnCuts of ['5,100','0,50,49,100','0,NaN,100','0,50,99'])assert.throws(()=>columnBoxes({columnCuts}));assert.throws(()=>columnBoxes({columnCount:1.5}));
});
test('Tesseract原始字词不受负数或缺失置信度隐藏，原始TSV不被修改',()=>{
  const tsv='4\t1\t1\t1\t1\t0\t10\t10\t20\t80\t-1\t\n5\t1\t1\t1\t1\t1\t10\t10\t20\t20\t-1\t𠮷\n5\t1\t1\t1\t1\t2\t10\t30\t20\t20\tNaN\t□';
  const result=rawTSVLines(tsv);assert.equal(result[0].text,'𠮷□');assert(tsv.includes('NaN'));assert(tsv.includes('-1\t𠮷'));
});
test('CSV未知内存和CER留空，不以0冒充，文件名不作为公式执行',()=>{
  const record={case:{id:'id',image:{fileName:'=file.png',sha256:'img'},reference:{sha256:'truth',reviewed:false}},methods:[{id:'paddle-whole',status:'failed',evaluation:{CER:null},memory:{scope:'unavailable'},error:'=test'}]};
  const csv=recordsCSV([record]);assert(csv.includes('"\'=file.png"'));assert(csv.includes('"\'=test"'));assert(!csv.includes('NaN'));assert(csv.startsWith('\ufeff'));
});
test('模型来源、权重与官方字典固定',async()=>{
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  const m=JSON.parse(await readFile(new URL('models.json',import.meta.url),'utf8'));assert.equal(m.variant,'community-export');assert.equal(m.models.length,2);
  assert(m.models.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)&&/^[a-f0-9]{64}$/.test(x.weightSHA256)));
  const dict=await readFile(new URL('ppocrv5-official-dict.txt',import.meta.url));assert.equal(createHash('sha256').update(dict).digest('hex'),m.dictionarySHA256);
});
test('竖排同列碎片从上到下，列从右至左；保留引擎原始数组',()=>{
  const item=(x,y,text)=>({poly:[[x,y],[x+10,y],[x+10,y+20],[x,y+20]],text});
  const items=[item(10,0,'左'),item(50,30,'下'),item(51,0,'上')];
  assert.deepEqual(sortItems(items,'vertical').map(x=>x.text),['上','下','左']);assert.equal(items[0].text,'左');
  assert.equal(score('有朋自遠方來','有朋自方來').correctAlignedCharacters,5);assert.equal(score('','候选文字'),null);
});
