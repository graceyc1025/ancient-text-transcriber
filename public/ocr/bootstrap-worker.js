// Compatibility shim for the locked Tesseract.js 7.0.0 Worker protocol.
// Its main-thread createWorker promise rejects for action "load", but not for
// loadLanguage/initialize rejections. Those leave initialization pending until
// the application's timeout. Surface the fatal initialization error through the
// native Worker error channel (which createWorker handles), then close this
// failed Worker. Successful OCR messages and model bytes pass through unchanged.
const send = self.postMessage.bind(self);
let initializationFailed = false;
self.postMessage = (message, ...args) => {
  if (initializationFailed) return;
  send(message, ...args);
  if (message?.status === 'reject' && ['loadLanguage', 'initialize'].includes(message.action)) {
    initializationFailed = true;
    const reason = `${message.action}: ${String(message.data || 'OCR initialization failed')}`;
    setTimeout(() => {
      self.close();
      throw new Error(reason);
    }, 0);
  }
};
importScripts('./runtime/worker.min.js');
