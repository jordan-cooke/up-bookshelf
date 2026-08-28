import tesseract from "tesseract.js";
import englishLanguageData from "@tesseract.js-data/eng";
import heicConvert from "heic-convert";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "./isbn.js";

const { createWorker, OEM, PSM } = tesseract;
const OCR_CHARACTER_FIXES = new Map([
  ["O", "0"],
  ["Q", "0"],
  ["D", "0"],
  ["I", "1"],
  ["L", "1"],
  ["|", "1"],
  ["!", "1"],
  ["Z", "2"],
  ["S", "5"],
  ["G", "6"],
  ["B", "8"],
]);

let workerPromise = null;
let recognitionQueue = Promise.resolve();
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

export function isHeifImage(image, contentType = "") {
  if (/^image\/hei[cf](?:-sequence)?$/i.test(String(contentType).split(";", 1)[0].trim())) return true;
  if (!image || image.byteLength < 12) return false;
  const header = Buffer.from(image.buffer || image, image.byteOffset || 0, Math.min(image.byteLength, 64));
  if (header.toString("ascii", 4, 8) !== "ftyp") return false;
  for (let offset = 8; offset + 4 <= header.length; offset += 4) {
    if (HEIF_BRANDS.has(header.toString("ascii", offset, offset + 4))) return true;
  }
  return false;
}

async function normalizeOcrImage(image, contentType) {
  if (!isHeifImage(image, contentType)) return image;
  return Buffer.from(await heicConvert({ buffer: Buffer.from(image), format: "JPEG", quality: 0.95 }));
}

function correctOcrCharacters(value) {
  return [...String(value || "").toUpperCase()]
    .map((character) => OCR_CHARACTER_FIXES.get(character) || character)
    .join("");
}

function isbnCandidates(value, { labeled = false } = {}) {
  const compact = cleanIsbn(correctOcrCharacters(value));
  const results = [];
  const add = (isbn, exact = false) => {
    if (isValidIsbn13(isbn)) results.push({ isbn, score: 70 + (labeled ? 100 : 0) + (exact ? 20 : 0) });
    if (labeled && isValidIsbn10(isbn)) results.push({ isbn, score: 40 + 100 + (exact ? 20 : 0) });
  };

  add(compact, true);
  for (let index = 0; index <= compact.length - 13; index += 1) {
    const isbn = compact.slice(index, index + 13);
    if (/^(?:978|979)/.test(isbn)) add(isbn);
  }
  if (labeled) {
    for (let index = 0; index <= compact.length - 10; index += 1) add(compact.slice(index, index + 10));
  }
  return results;
}

export function extractIsbnFromText(value = "") {
  const text = String(value || "").replace(/[‐‑‒–—―]/g, "-");
  const candidates = [];
  const labeledPattern = /ISBN(?:\s*-?\s*1[03])?\s*:?\s*([0-9OQDILSBZG|!Xx][0-9OQDILSBZG|!Xx\s.:-]{8,45})/gi;
  const numericPattern = /[0-9OQDILSBZG|!Xx][0-9OQDILSBZG|!Xx\s.:-]{8,30}/gi;

  for (const match of text.matchAll(labeledPattern)) candidates.push(...isbnCandidates(match[1], { labeled: true }));
  for (const match of text.matchAll(numericPattern)) candidates.push(...isbnCandidates(match[0]));

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.isbn || null;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: englishLanguageData.langPath,
      gzip: englishLanguageData.gzip,
      cacheMethod: "none",
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_char_whitelist: "ISBNisbn0123456789Xx-: ",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export function recognizeIsbnImage(image, { contentType = "" } = {}) {
  const recognize = async () => {
    const normalizedImage = await normalizeOcrImage(image, contentType);
    const worker = await getWorker();
    const result = await worker.recognize(normalizedImage);
    return extractIsbnFromText(result?.data?.text || "");
  };
  const job = recognitionQueue.then(recognize, recognize);
  recognitionQueue = job.catch(() => null);
  return job;
}

export async function terminateIsbnOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } finally {
    workerPromise = null;
  }
}
