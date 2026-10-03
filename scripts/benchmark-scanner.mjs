// Local-only regression corpus: images are deliberately not committed.
// node scripts/benchmark-scanner.mjs <directory-containing-IMG_6952.HEIC-through-IMG_6957.HEIC>
import fs from "node:fs/promises";
import path from "node:path";
import { recognizeIsbnImage, terminateIsbnOcr } from "../src/ocr.js";
import { toIsbn13 } from "../src/isbn.js";

if (!process.argv[2]) throw new Error("Pass the directory containing the six HEIC regression photos.");
const samples = [
  ["IMG_6952.HEIC", "9781950209156"],
  ["IMG_6953.HEIC", "9780593529874"],
  ["IMG_6954.HEIC", "9781464261169"],
  ["IMG_6955.HEIC", "9780316557542"],
  ["IMG_6956.HEIC", "9780679454472"],
  ["IMG_6957.HEIC", "9781435162785"],
];
let failed = 0;
let maxDelay = 0;
let previous = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  maxDelay = Math.max(maxDelay, now - previous - 20);
  previous = now;
}, 20);
try {
  for (const [filename, expected] of samples) {
    const image = await fs.readFile(path.join(process.argv[2], filename));
    const started = performance.now();
    const actual = await recognizeIsbnImage(image, { contentType: "image/heic" });
    const passed = toIsbn13(actual) === expected;
    if (!passed) failed++;
    console.log(`${passed ? "PASS" : "FAIL"} ${filename}: ${actual} (${Math.round(performance.now() - started)} ms)`);
  }
} finally {
  clearInterval(timer);
  await terminateIsbnOcr();
}
console.log(`Main-thread timer delay: ${Math.round(maxDelay)} ms; ${samples.length - failed}/${samples.length} correct.`);
process.exitCode = failed ? 1 : 0;
