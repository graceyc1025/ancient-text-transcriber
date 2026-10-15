import {test,expect} from '@playwright/test';

const cacheKey='ancient-transcriber-tessdata-best-e12c65a9/chi_tra_vert.traineddata';
for(const failure of ['404','bad-cache'])test(`初始化${failure}及时报具体错误、保留底稿、可重试真实OCR`,async({page,context})=>{
  page.on('dialog',d=>d.accept());await page.goto('./');await page.locator('#autoRun').uncheck();
  await page.locator('#fileInput').setInputFiles('public/images/example.png');await expect(page.locator('.segment-text')).toBeVisible();await page.locator('.segment-text').fill('人工底稿𠮷□');
  if(failure==='404')await context.route('**/chi_tra_vert.traineddata.gz',r=>r.fulfill({status:404,body:'Not found'}));
  else await page.evaluate(key=>new Promise((resolve,reject)=>{const r=indexedDB.open('keyval-store');r.onupgradeneeded=()=>r.result.createObjectStore('keyval');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('keyval','readwrite');tx.objectStore('keyval').put(new Uint8Array([0,0]),key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),cacheKey);
  await page.locator('#runCurrent').click();await expect(page.locator('#pageWarnings')).toContainText(failure==='404'?'Response code: 404':'initialization failed',{timeout:15_000});
  await expect(page.locator('#pageWarnings')).not.toContainText('超过两分钟');await expect(page.locator('#runCurrent')).toBeEnabled();await expect(page.locator('.segment-text')).toHaveValue('人工底稿𠮷□');
  await page.locator('#showRecords').click();await expect(page.locator('#rawOutput')).toHaveValue('');await expect(page.locator('#recordRun option')).toHaveCount(0);await page.locator('#closeRecords').click();
  if(failure==='404')await context.unroute('**/chi_tra_vert.traineddata.gz');
  // Tesseract deletes the invalid cache when Init fails; next run fetches again.
  await page.locator('#runCurrent').click();await expect(page.locator('#runCurrent')).toBeEnabled({timeout:120_000});await expect(page.locator('#pageWarnings')).not.toContainText('本次识别失败');
  expect((await page.locator('.segment-text').inputValue()).length).toBeGreaterThan(10);await page.locator('#showRecords').click();await expect(page.locator('#recordRun option')).toHaveCount(1);
  expect((await page.locator('#rawOutput').inputValue()).length).toBeGreaterThan(10);
});
