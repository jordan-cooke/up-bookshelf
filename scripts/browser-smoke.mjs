// Optional browser regression: install Playwright separately, or point
// PLAYWRIGHT_MODULE to its module URL. BROWSER_CHANNEL can select installed Edge.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { createBook, initializeDatabase } from "../src/repository.js";
import { validateBook } from "../src/validation.js";
import { terminateIsbnOcr } from "../src/ocr.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const database = new DatabaseSync(":memory:");
initializeDatabase(database);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "up-browser-test-"));
const app = createApp({
  database,
  coverDirectory: directory,
  lookup: async isbn => ({ title: `Scanner test ${isbn}`, isbn13: isbn.length === 13 ? isbn : "", isbn10: isbn.length === 10 ? isbn : "", authors: ["Test Author"] }),
});
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
let browser;
let testPage;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  testPage = page;
  const errors = [];
  let lookupRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/lookup/")) lookupRequests++; });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector("#result-count").textContent === "0 books");
  await page.evaluate(() => {
    // Independent EAN-13 fixture encoder, not the scanner's decoder.
    const left = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const alternate = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
    const right = left.map(code => [...code].map(bit => bit === "0" ? "1" : "0").join(""));
    const parities = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    window.drawTestBarcode = (canvas, isbn, { angle = 0, faint = false, live = false } = {}) => {
      canvas.width = live ? 1920 : 1800;
      canvas.height = live ? 1080 : 1100;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      let bits = "101";
      const parity = parities[Number(isbn[0])];
      for (let index = 1; index <= 6; index++) bits += (parity[index - 1] === "L" ? left : alternate)[Number(isbn[index])];
      bits += "01010";
      for (let index = 7; index <= 12; index++) bits += right[Number(isbn[index])];
      bits += "101";
      ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(angle * Math.PI / 180);
      ctx.fillStyle = faint ? "#777" : "black";
      [...bits].forEach((bit, index) => { if (bit === "1") ctx.fillRect(-190 + index * 4, -85, 4, 170); });
      // Price supplement stands apart from the ISBN barcode, as on real books.
      for (let index = 0; index < 20; index++) ctx.fillRect(250 + index * 5, -85, index % 3 + 1, 170);
      ctx.font = "36px Arial"; ctx.fillText(`ISBN ${isbn}`, -190, -110);
      ctx.restore();
    };
    const cameraCanvas = document.createElement("canvas");
    window.drawTestBarcode(cameraCanvas, "9780306406157", { live: true });
    window.testCamera = cameraCanvas;
    setInterval(() => window.drawTestBarcode(cameraCanvas, "9780306406157", { live: true }), 100);
    navigator.mediaDevices.getUserMedia = async () => cameraCanvas.captureStream(15);
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: "videoinput", deviceId: "main-test", label: "Back Camera" },
      { kind: "videoinput", deviceId: "ultra-test", label: "Back Ultra Wide Camera" },
    ];
  });
  await page.getByRole("button", { name: "Scan a book", exact: true }).first().click();
  await page.locator("#continuous-scan").check();
  const started = performance.now();
  await page.locator("#live-scan-button").click();
  await page.waitForFunction(() => document.querySelector("#book-dialog").open, null, { timeout: 10000 });
  assert.equal(await page.locator("#book-form [name=isbn13]").inputValue(), "9780306406157");
  console.log(`PASS narrow phone guide live barcode: ${Math.round(performance.now() - started)} ms`);
  await page.locator("#save-book").click();
  await page.waitForFunction(() => document.querySelector("#scanner-dialog").open && document.querySelector("#scanner-reader video")?.readyState >= 2);
  await page.waitForTimeout(1500);
  assert.equal(lookupRequests, 1, "continuous scanning must not repeatedly look up the same visible barcode");
  assert.equal(await page.locator("#camera-select option").count(), 2);
  await page.locator('#scanner-dialog [data-close="scanner-dialog"]').click();
  console.log("PASS continuous scan, repeated-frame suppression, camera choice and close");

  const samples = ["9781950209156", "9780593529874", "9781464261169", "9780316557542", "9780679454472", "9781435162785"];
  for (const [index, isbn] of samples.entries()) {
    const photo = await page.evaluate(({ isbn, index }) => {
      const canvas = document.createElement("canvas");
      window.drawTestBarcode(canvas, isbn, { angle: index % 2 ? 10 : 0, faint: index === 2 });
      return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
    }, { isbn, index });
    await page.getByRole("button", { name: "Scan a book", exact: true }).first().click();
    await page.locator("#continuous-scan").uncheck();
    await page.locator("#barcode-photo").setInputFiles({ name: "barcode.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo, "base64") });
    await page.waitForFunction(() => document.querySelector("#book-dialog").open, null, { timeout: 45000 });
    assert.equal(await page.locator("#book-form [name=isbn13]").inputValue(), isbn);
    await page.locator('#book-dialog [data-close="book-dialog"]').first().click();
    console.log(`PASS photo barcode ${isbn}`);
  }

  const textPhoto = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 600;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1600, 600);
    ctx.fillStyle = "black"; ctx.font = "60px Arial"; ctx.fillText("ISBN 0-679-45447-0", 100, 300);
    return canvas.toDataURL("image/jpeg", 0.96).split(",")[1];
  });
  await page.getByRole("button", { name: "Scan a book", exact: true }).first().click();
  await page.locator("#barcode-photo").setInputFiles({ name: "printed-isbn.jpg", mimeType: "image/jpeg", buffer: Buffer.from(textPhoto, "base64") });
  await page.waitForFunction(() => document.querySelector("#book-dialog").open, null, { timeout: 45000 });
  assert.equal(await page.locator("#book-form [name=isbn10]").inputValue(), "0679454470");
  await page.locator('#book-dialog [data-close="book-dialog"]').first().click();
  console.log("PASS printed-number OCR fallback through the actual browser and server");

  for (let index = 0; index < 123; index++) createBook(database, validateBook({ title: `Library test ${index}`, collections: ["Test Collection"] }));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".book-card").length === 100);
  await page.locator("#load-more-books").click();
  await page.waitForFunction(() => document.querySelectorAll(".book-card").length === 124);
  assert.equal(await page.locator("#load-more-books").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log("PASS large-library pagination; no browser script errors");
} catch (error) {
  if (testPage && !testPage.isClosed()) console.log(await testPage.evaluate(() => ({
    notices: document.querySelector("#toast-region")?.textContent,
    video: [...document.querySelectorAll("video")].map(video => ({ width: video.videoWidth, height: video.videoHeight, cssWidth: video.clientWidth, cssHeight: video.clientHeight, ready: video.readyState })),
    scanner: document.querySelector("#scanner-dialog")?.open,
    form: document.querySelector("#book-dialog")?.open,
  })));
  throw error;
} finally {
  await browser?.close();
  await terminateIsbnOcr();
  await new Promise(resolve => server.close(resolve));
  database.close();
  await fs.rm(directory, { recursive: true, force: true });
}
