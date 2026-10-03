import { cleanIsbn, isValidIsbn10, isValidIsbn13, toIsbn13 } from "./isbn.js";
import { createOcrService } from "./ocr-service.js";

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

function correctOcrCharacters(value) {
  return [...String(value || "").toUpperCase()]
    .map((character) => OCR_CHARACTER_FIXES.get(character) || character)
    .join("");
}

export function extractIsbnFromText(value = "") {
  const text = String(value || "").replace(/[‐‑‒–—―]/g, "-");
  const candidates = new Set();
  // Never slide a ten-digit window through a damaged ISBN-13: roughly one
  // in eleven such guesses passes ISBN-10's checksum but identifies another book.
  const labels = /\bISBN(?:[ \t]*-?[ \t]*1[03])?\s*:?\s*([0-9OQDILSBZG|!Xx][0-9OQDILSBZG|!Xx \t-]{8,70})/gi;
  for (const match of text.matchAll(labels)) {
    const corrected = correctOcrCharacters(match[1]);
    const prefix = corrected.match(/^(?:97[89](?:[ \t-]*\d){10}|\d(?:[ \t-]*\d){8}[ \t-]*[\dX])(?![\dX])/);
    if (!prefix) continue;
    const isbn = cleanIsbn(prefix[0]);
    if (isbn.length === 10 && /^97[89]/.test(cleanIsbn(corrected))) continue;
    if (isValidIsbn13(isbn) || isValidIsbn10(isbn)) candidates.add(isbn);
  }
  for (const match of text.matchAll(/(?<!\d)97[89](?:[ \t-]*\d){10}(?!\d)/g)) {
    const isbn = cleanIsbn(match[0]);
    if (isValidIsbn13(isbn)) candidates.add(isbn);
  }
  // A photo containing several different books must not silently pick one.
  if (new Set([...candidates].map(toIsbn13)).size !== 1) return null;
  return [...candidates].find(isValidIsbn13) || [...candidates][0];
}

const service = createOcrService();
export const recognizeIsbnImage = service.recognize;
export const terminateIsbnOcr = service.close;
