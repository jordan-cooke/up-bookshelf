import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOcrService } from "../src/ocr-service.js";

function fixture(options = {}) {
  const workers = [];
  const service = createOcrService({
    ...options,
    workerFactory: () => {
      const worker = new EventEmitter();
      worker.jobs = [];
      worker.ref = worker.unref = () => {};
      worker.postMessage = (job) => worker.jobs.push(job);
      worker.terminate = async () => { worker.stopped = true; };
      workers.push(worker);
      return worker;
    },
  });
  return { ...service, workers };
}

test("OCR serializes work, bounds its queue and reuses the warm worker", async () => {
  const service = fixture();
  try {
    const first = service.recognize(Buffer.from("first"));
    const second = service.recognize(Buffer.from("second"));
    await assert.rejects(service.recognize(Buffer.from("excess")), { status: 429 });
    assert.equal(service.workers[0].jobs.length, 1);
    service.workers[0].emit("message", { isbn: "9780306406157" });
    assert.equal(await first, "9780306406157");
    assert.equal(service.workers[0].jobs.length, 2);
    service.workers[0].emit("message", { isbn: null });
    assert.equal(await second, null);
    assert.equal(service.workers.length, 1);
  } finally { await service.close(); }
});

test("OCR timeouts terminate the stuck worker and permit a clean retry", async () => {
  const service = fixture({ timeoutMs: 20 });
  try {
    await assert.rejects(service.recognize(Buffer.from("stuck")), { status: 504 });
    assert.equal(service.workers[0].stopped, true);
    const retry = service.recognize(Buffer.from("retry"));
    service.workers[1].emit("message", { isbn: "9780306406157" });
    assert.equal(await retry, "9780306406157");
  } finally { await service.close(); }
});

test("cancelling an active scan kills its worker and ignores stale results", async () => {
  const service = fixture();
  const controller = new AbortController();
  try {
    const first = service.recognize(Buffer.from("cancel"), { signal: controller.signal });
    const rejected = assert.rejects(first, { name: "AbortError" });
    const second = service.recognize(Buffer.from("next"));
    controller.abort();
    await rejected;
    assert.equal(service.workers[0].stopped, true);
    service.workers[0].emit("message", { isbn: "wrong stale result" });
    service.workers[1].emit("message", { isbn: "9780306406157" });
    assert.equal(await second, "9780306406157");
  } finally { await service.close(); }
});

test("cancelled queued scans never run, and worker crashes are recoverable", async () => {
  const service = fixture();
  const controller = new AbortController();
  try {
    const first = service.recognize(Buffer.from("first"));
    const failed = assert.rejects(first, { status: 503 });
    const queued = service.recognize(Buffer.from("cancel"), { signal: controller.signal });
    const cancelled = assert.rejects(queued, { name: "AbortError" });
    controller.abort();
    await cancelled;
    assert.equal(service.workers[0].jobs.length, 1);
    service.workers[0].emit("error", new Error("crash"));
    await failed;
    const retry = service.recognize(Buffer.from("next"));
    service.workers[1].emit("message", { isbn: null });
    await retry;
  } finally { await service.close(); }
});
