import { parentPort } from "node:worker_threads";
import tesseract from "tesseract.js";
import englishLanguageData from "@tesseract.js-data/eng";
import heicConvert from "heic-convert";
import { extractIsbnFromText, isHeifImage } from "./ocr.js";
import { checkImageDimensions } from "./image-limits.js";

// Decode HEIC and run OCR outside the HTTP server's event loop. Keep the model
// warm between books; the parent controls concurrency, cancellation and lifetime.
let worker;
parentPort.on("message", async ({ image, contentType }) => {
  try {
    let bytes = Buffer.from(image);
    checkImageDimensions(bytes);
    if (isHeifImage(bytes, contentType)) {
      bytes = Buffer.from(await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.95 }));
    }
    if (!worker) {
      worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
        langPath: englishLanguageData.langPath,
        gzip: englishLanguageData.gzip,
        cacheMethod: "none",
        errorHandler: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist: "ISBNisbn0123456789Xx-: ",
        tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
    }
    const result = await worker.recognize(bytes);
    parentPort.postMessage({ isbn: extractIsbnFromText(result?.data?.text || "") });
  } catch (error) {
    parentPort.postMessage({ error: true, status: error.status === 413 ? 413 : 422 });
  }
});
