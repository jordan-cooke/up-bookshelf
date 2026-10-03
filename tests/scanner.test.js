import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "../public/isbn.js";

// Exercise the actual UI orchestration with controlled devices/network, without
// binding page event listeners or requiring a real camera in CI.
const source = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/, "").split('document.addEventListener("click"')[0];
function browser() {
  const nodes = new Map();
  const node = () => ({
    open: true, hidden: false, checked: false, value: "", textContent: "",
    classList: { remove() {}, add() {}, toggle() {} },
    setAttribute() {}, replaceChildren() {}, append() {}, remove() {},
    close() { this.open = false; }, showModal() { this.open = true; },
  });
  const context = vm.createContext({
    cleanIsbn, isValidIsbn10, isValidIsbn13,
    AbortController, DOMException, File, Blob, URL, setTimeout, clearTimeout,
    window: {}, console,
    document: {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, node());
        return nodes.get(selector);
      },
      createElement: node,
      body: { append() {} },
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("const notices = []; toast = (message) => notices.push(message);", context);
  return (code) => vm.runInContext(code, context);
}

test("live scanning silently ignores bad checksums before metadata requests", async () => {
  const run = browser();
  run('api = () => { throw new Error("must not fetch"); };');
  assert.equal(await run('lookupIsbn("9780306406158", "live")'), false);
  assert.equal(run("notices.length"), 0);
});

test("photo fallback continues after OCR fails and retains continuous live mode", async () => {
  const run = browser();
  run(`
    let attempts = 0, textAttempts = 0, accepted;
    detectWithBrowser = async () => null;
    scanFileWithLibrary = async () => { if (++attempts === 1) throw new Error("blurred"); return "9780306406157"; };
    readPrintedIsbn = async () => { textAttempts++; throw new Error("OCR busy"); };
    enhancedPhotos = async () => [new File(["image"], "crop.jpg", { type: "image/jpeg" })];
    lookupIsbn = async (isbn, source) => { accepted = { isbn, source }; return true; };
  `);
  await run('scanBarcodePhoto(new File(["image"], "test.jpg", { type: "image/jpeg" }), "live")');
  assert.equal(run("attempts"), 2);
  assert.equal(run("textAttempts"), 1);
  assert.equal(run("accepted.source"), "live");
  assert.equal(run("accepted.isbn"), "9780306406157");
  assert.equal(run("photoController"), null);
});

test("closing a photo scan prevents late results and suppresses duplicate jobs", async () => {
  const run = browser();
  run(`
    let resolveDetection, detections = 0, lookups = 0;
    detectWithBrowser = () => { detections++; return new Promise(resolve => { resolveDetection = resolve; }); };
    lookupIsbn = async () => { lookups++; };
    const photo = new File(["image"], "test.jpg", { type: "image/jpeg" });
  `);
  const first = run("scanBarcodePhoto(photo)");
  await new Promise(resolve => setImmediate(resolve));
  await run("scanBarcodePhoto(photo)");
  assert.equal(run("detections"), 1);
  await run("closeScanner()");
  run('resolveDetection("9780306406157")');
  await first;
  assert.equal(run("lookups"), 0);
  assert.equal(run("notices.length"), 0);
});

test("closing the scanner during metadata lookup does not reopen a book form", async () => {
  const run = browser();
  run("let resolveLookup, forms = 0; api = () => new Promise(resolve => { resolveLookup = resolve; }); openBookForm = () => { forms++; };");
  const lookup = run('lookupIsbn("9780306406157", "live")');
  await run("closeScanner()");
  run('resolveLookup({ book: { title: "Book" }, providers: [] })');
  assert.equal(await lookup, false);
  assert.equal(run("forms"), 0);
});

test("native barcode failures still release the image bitmap", async () => {
  const run = browser();
  run(`
    let closed = 0;
    window.BarcodeDetector = true; window.createImageBitmap = true;
    globalThis.BarcodeDetector = class {
      static async getSupportedFormats() { return ["ean_13"]; }
      async detect() { throw new Error("unsupported image"); }
    };
    globalThis.createImageBitmap = async () => ({ close() { closed++; } });
  `);
  assert.equal(await run("detectWithBrowser({})"), null);
  assert.equal(run("closed"), 1);
});

test("file decoding never replaces the live camera instance", async () => {
  const run = browser();
  run(`
    const liveCamera = { live: true }; scanner = liveCamera;
    window.Html5Qrcode = true;
    globalThis.Html5QrcodeSupportedFormats = { EAN_13: 9 };
    globalThis.Html5Qrcode = class { async scanFile() { return "9780306406157"; } clear() {} };
  `);
  assert.equal(await run("scanFileWithLibrary({})"), "9780306406157");
  assert.equal(run("scanner === liveCamera"), true);
});

test("closing during camera startup also stops the camera that starts late", async () => {
  const run = browser();
  run(`
    let ready, starts = 0, stops = 0;
    globalThis.Html5QrcodeSupportedFormats = { EAN_13: 9 };
    globalThis.Html5Qrcode = class {
      start() { starts++; return new Promise(resolve => { ready = resolve; }); }
      async stop() { stops++; }
      clear() {}
    };
  `);
  const starting = run('startSelectedCamera("chosen-camera")');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run("starts"), 1);
  await run("closeScanner()");
  const stoppedBeforeStartup = run("stops");
  run("ready()");
  await starting;
  assert.equal(run("stops"), stoppedBeforeStartup + 1);
  assert.equal(run("scanner"), null);
  assert.equal(run("cameraStarting"), false);
});

test("oversized original OCR can retry a bounded resized image", async () => {
  const run = browser();
  run(`
    let textAttempts = 0, accepted;
    detectWithBrowser = async () => null;
    scanFileWithLibrary = async () => null;
    readPrintedIsbn = async () => {
      if (++textAttempts === 1) { const error = new Error("too many pixels"); error.status = 413; throw error; }
      return "9780306406157";
    };
    enhancedPhotos = async () => [new File(["small"], "crop.jpg", { type: "image/jpeg" })];
    lookupIsbn = async isbn => { accepted = isbn; return true; };
  `);
  await run('scanBarcodePhoto(new File(["image"], "test.jpg", { type: "image/jpeg" }))');
  assert.equal(run("textAttempts"), 2);
  assert.equal(run("accepted"), "9780306406157");
});
