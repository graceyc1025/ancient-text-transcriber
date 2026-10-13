import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'models/manifest.json'), 'utf8'));
for (const model of manifest.models) {
  const raw = gunzipSync(await readFile(path.join(root, 'public/ocr/tessdata', `${model.name}.traineddata.gz`)));
  if (createHash('sha256').update(raw).digest('hex') !== model.sha256) throw new Error(`模型校验失败：${model.name}`);
}
const runtime = path.join(root, 'public/ocr/runtime');
await rm(runtime, { recursive: true, force: true });
await mkdir(path.join(runtime, 'core'), { recursive: true });
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(runtime, 'worker.min.js'));
await copyFile(path.join(root, 'node_modules/tesseract.js/LICENSE.md'), path.join(runtime, 'Tesseract.js-LICENSE.txt'));
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const file of await readdir(core)) {
  if (/^tesseract-core-lstm\.wasm(?:\.js)?$/.test(file)) {
    await copyFile(path.join(core, file), path.join(runtime, 'core', file));
  }
}
await copyFile(path.join(core, 'LICENSE'), path.join(runtime, 'core/LICENSE.txt'));
console.log('已校验繁体模型并准备同源 OCR Worker / WASM；没有 CDN 或付费服务。');
