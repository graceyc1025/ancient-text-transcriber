import test from 'node:test';
import assert from 'node:assert/strict';
import { processPixels, localInk, columnPartitions, memoryBudget, workingSize } from '../src/processing.js';

test('原图参数保持色彩；灰度、对比度与二值化不改变图尺寸',()=>{
  const data={width:2,height:1,data:new Uint8ClampedArray([50,100,150,255,220,220,220,255])};
  const original=[...data.data];processPixels(data,{contrast:100,binary:'none'});assert.deepEqual([...data.data],original);
  processPixels(data,{grayscale:true,contrast:100,binary:'none'});assert.equal(data.data[0],data.data[1]);assert.equal(data.data[1],data.data[2]);
  processPixels(data,{binary:'manual',binaryThreshold:160});assert.deepEqual([...data.data],[0,0,0,255,255,255,255,255]);
});
test('自动阈值和局部阈值能区分背景与笔画，不借助文字猜测',()=>{
  const width=30,height=30,gray=new Uint8Array(width*height).fill(200);for(let y=8;y<22;y++)for(let x=12;x<17;x++)gray[y*width+x]=50;
  const ink=localInk(gray,width,height);assert.equal(ink[15*width+14],1);assert.equal(ink[2*width+2],0);
  const data={width,height,data:new Uint8ClampedArray(width*height*4)};for(let i=0;i<gray.length;i++){data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=gray[i];data.data[i*4+3]=255;}
  const output=processPixels(data,{binary:'otsu'});assert.equal(output.threshold,50);assert.equal(data.data[(15*width+14)*4],0);assert.equal(data.data[(2*width+2)*4],255);
});
test('投影分栏切线覆盖整个区域，空图不会虚构多列',()=>{
  const width=120,height=160,gray=new Uint8Array(width*height).fill(255);
  for(const x0 of [15,50,85])for(let y=15;y<145;y+=22)for(let yy=y;yy<y+12;yy++)for(let x=x0;x<x0+14;x++)gray[yy*width+x]=0;
  const columns=columnPartitions(gray,width,height);assert.equal(columns.length,3);assert.equal(columns[0][0],0);assert.equal(columns.at(-1)[1],1);for(let i=1;i<columns.length;i++)assert.equal(columns[i-1][1],columns[i][0]);
  assert.deepEqual(columnPartitions(new Uint8Array(width*height).fill(255),width,height),[[0,1]]);
  assert.deepEqual(columnPartitions(gray,width,height,3),[[0,1/3],[1/3,2/3],[2/3,1]]);
});
test('手机和桌面工作图预算有界，原图不被强制压至旧版最长边2400',()=>{
  const desktop=workingSize(1000,6000,2,memoryBudget('standard'));assert.ok(desktop.width*desktop.height<=5000000);assert.ok(desktop.height>2400);assert.ok(desktop.limited);
  const mobile=workingSize(1000,6000,2,memoryBudget('auto',true));assert.ok(mobile.width*mobile.height<=1500000);
  const column=workingSize(120,2000,2,memoryBudget('compact'));assert.equal(column.scale,2);assert.equal(column.width,240);assert.equal(column.height,4000);
});
