import {test} from 'node:test';import assert from 'node:assert/strict';
// Pure evaluation/geometry are independent of browser model initialization.
import {editOperations} from '../../src/evaluation.js';
import {sortItems,score} from './engine.js';
test('对照评分不把简体、缺字或错误列序视作正确',()=>{
  const reference='學習說慍';assert.equal(editOperations(reference,'学习说愠').distance,4);
  const omitted=editOperations('有朋自遠方來','有朋自方來');assert.equal(omitted.deletions,1);assert.equal(omitted.substitutions,0);
  assert(editOperations('甲乙丙丁','丙丁甲乙').distance>0);
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
