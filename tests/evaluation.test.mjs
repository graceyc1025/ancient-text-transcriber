import test from 'node:test';import assert from 'node:assert/strict';import{editOperations,orderInversions}from'../src/evaluation.js';
test('分别统计漏识、错识、多识，并保留 Unicode 扩展字',()=>{assert.equal(editOperations('學而時習之','學時習之').deletions,1);assert.equal(editOperations('學而','學二').substitutions,1);assert.equal(editOperations('學𠮷','學𠮷字').insertions,1);assert.equal(editOperations('學𠮷','學𠮷').distance,0);});
test('列序逆序独立统计，同列碎片不产生假逆序',()=>{assert.equal(orderInversions([0,0,1,1,2]),0);assert.equal(orderInversions([2,1,0]),3);});
