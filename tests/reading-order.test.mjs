import {test} from 'node:test';import assert from 'node:assert/strict';
import {sortItems} from '../src/reading-order.js';
const item=(text,x,y,w=20,h=90)=>({text,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],score:.1});
test('双页几何排序：右页先、同栏上至下，候选和分数不变',()=>{
  const items=[item('左页',10,10),item('右上',140,10),item('右下',141,160),item('中栏',80,10)];
  assert.deepEqual(sortItems(items).map(i=>i.text),['右上','右下','中栏','左页']);assert.equal(sortItems(items)[0],items[1]);assert.equal(items[0].text,'左页');
});
test('横排几何顺序不转换字形，不删除低分候选',()=>{
  const items=[item('淂扵□',120,10,80,20),item('𠮷異體',10,10,80,20)];assert.deepEqual(sortItems(items,'horizontal').map(i=>i.text),['𠮷異體','淂扵□']);
});
