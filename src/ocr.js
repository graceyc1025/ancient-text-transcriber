import { createWorker, OEM, PSM } from 'tesseract.js';
import { assetURL } from './assets.js';
import { cropCanvas, loadImage } from './images.js';
import { parseTSV, sortRegions, validateRegions } from './transcription.js';

const messages = {
  'loading tesseract core': '载入浏览器识别引擎',
  'initializing tesseract': '初始化识别引擎',
  'loading language traineddata': '载入繁体模型（首次可能较慢）',
  'initializing api': '准备繁体模型',
  'recognizing text': '正在识别文字',
};

export class BrowserOCR {
  worker = null;
  language = null;
  logger = null;

  async release() {
    if (this.worker) await this.worker.terminate();
    this.worker = null; this.language = null;
  }

  async getWorker(orientation) {
    const language = orientation === 'vertical' ? 'chi_tra_vert' : 'chi_tra';
    if (this.worker && this.language === language) return this.worker;
    await this.release();
    if (!('WebAssembly' in window) || !('Worker' in window)) throw new Error('此浏览器不支持本地 OCR。请使用较新的 Chrome、Edge、Firefox 或 Safari。');
    const options = {
      workerPath: assetURL('ocr/runtime/worker.min.js'),
      // 固定非 SIMD 核心：本次实测 v7 的 SIMD 核心无法运行该浮点繁体模型。
      corePath: assetURL('ocr/runtime/core/tesseract-core-lstm.wasm.js'),
      langPath: assetURL('ocr/tessdata'),
      workerBlobURL: false, gzip: true, cacheMethod: 'write',
      cachePath: 'ancient-transcriber-tessdata-best-e12c65a9',
      errorHandler: () => {}, // 错误由 await 的拒绝路径显示在对应页，避免库额外抛出全局错误。
      logger: event => this.logger?.(messages[event.status] ?? '准备识别', Math.round((event.progress ?? 0) * 100)),
    };
    this.worker = await createWorker(language, OEM.LSTM_ONLY, options);
    this.language = language;
    return this.worker;
  }

  async transcribe(page, { orientation, threshold, onProgress }) {
    this.logger = onProgress;
    const notices = [
      '通用繁体 OCR 未针对清代古籍训练。□仅标记检测到的低置信度字词，仍可能漏字或高置信度误识；请逐字校对。',
    ];
    validateRegions(page.regions);
    if (!page.regions.length) notices.push('未分区识别：标题、版心、页码可能混入正文。复杂版面建议先框选，再分别校勘。');
    const selections = sortRegions(page.regions.length ? page.regions : [{ kind: 'body', bbox: [0, 0, 1, 1] }], orientation);
    const worker = await this.getWorker(orientation);
    await worker.setParameters({ tessedit_pageseg_mode: orientation === 'vertical' ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_BLOCK });
    const image = await loadImage(page.url), segments = [];
    try {
      for (let index = 0; index < selections.length; index++) {
        const region = selections[index];
        const { canvas, bounds, resized } = cropCanvas(image, region.bbox);
        const cw = canvas.width, ch = canvas.height;
        if (resized) notices.push('大图的识别用图已缩小至最长边 2400 像素；小字可能丢失，请框选较小区域以提高有效分辨率。原始文件未修改。');
        let output;
        try { output = await worker.recognize(canvas, {}, { tsv: true, text: true }); }
        finally { canvas.width = 0; canvas.height = 0; }
        const result = parseTSV(output.data.tsv, threshold, orientation);
        // GetTSV 坐标以实际送给 WASM 的图为准，而不是原图。
        const [ox, oy, ow, oh] = bounds;
        for (const mark of result.uncertain) {
          const [x, y, w, h] = mark.bbox;
          mark.bbox = [ox + x / cw * ow, oy + y / ch * oh, w / cw * ow, h / ch * oh];
        }
        if (!result.text) notices.push('有区域未检测到文字。空结果不表示原图无字，请人工检查。');
        segments.push({ kind: region.kind, bbox: region.bbox, text: result.text, uncertain: result.uncertain, detected_characters: result.detectedCharacters });
      }
    } catch (error) {
      await this.release();
      throw error;
    } finally { this.logger = null; }
    return { segments, warnings: [...new Set(notices)] };
  }
}
