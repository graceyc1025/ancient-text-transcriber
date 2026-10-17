const stopped = () => Object.assign(new Error('已停止本次识别。'), {cancelled:true});

// Importing this coordinator never imports an OCR runtime. One active engine.
export class OCRController {
  active=null; kind=null; epoch=0; rejectJob=null;
  async release() {
    this.epoch++; this.rejectJob?.(stopped()); this.rejectJob=null;
    const previous=this.active;this.active=null;this.kind=null;
    await previous?.cancel?.();
    await previous?.release();
  }
  async cancel(){await this.release();}
  async transcribe(page,options={}) {
    const kind=options.engine??'tesseract';
    if(!['tesseract','paddle'].includes(kind))throw new Error('未知识别引擎。');
    if(this.kind!==kind)await this.release();
    const epoch=this.epoch;
    const work=async()=>{
      options.onProgress?.('准备所选识别引擎',null);
      if(!this.active){
        const module=kind==='paddle'?await import('./paddle.js'):await import('./ocr.js');
        if(epoch!==this.epoch)throw stopped();
        this.active=kind==='paddle'?new module.PaddleBrowserOCR():new module.BrowserOCR();this.kind=kind;
      }
      const result=await this.active.transcribe(page,options);
      if(epoch!==this.epoch)throw stopped();
      return {...result,settings:{...result.settings,engine:kind}};
    };
    try{return await Promise.race([new Promise((_,reject)=>{this.rejectJob=reject;}),work()]);}
    finally{if(epoch===this.epoch)this.rejectJob=null;}
  }
}
