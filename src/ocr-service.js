import { Worker } from "node:worker_threads";

export class OcrError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createOcrService({
  workerFactory = () => new Worker(new URL("./ocr-worker.js", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  }),
  timeoutMs = 30000,
  idleMs = 60000,
  maxJobs = 2,
} = {}) {
  let worker = null;
  let active = null;
  let idleTimer;
  const queue = [];
  const reset = () => {
    clearTimeout(idleTimer);
    const previous = worker;
    worker = null;
    return previous?.terminate().catch(() => {});
  };
  const finish = (job, error, isbn) => {
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.abort);
    if (active === job) active = null;
    error ? job.reject(error) : job.resolve(isbn || null);
    pump();
  };
  const pump = () => {
    if (active) return;
    const job = queue.shift();
    if (!job) {
      idleTimer = setTimeout(reset, idleMs);
      idleTimer.unref?.();
      worker?.unref();
      return;
    }
    clearTimeout(idleTimer);
    active = job;
    try {
      if (!worker) {
        const current = workerFactory();
        worker = current;
        current.on("message", (result) => {
          if (worker !== current || !active) return;
          const running = active;
          if (result.error) {
            reset();
            finish(running, new OcrError(result.status === 413
              ? "That photo is too large to read. Try a cropped photo of the ISBN."
              : "That image could not be read. Try a clear JPEG photo.", result.status === 413 ? 413 : 422));
          } else finish(running, null, result.isbn);
        });
        const failed = () => {
          if (worker !== current) return;
          const running = active;
          reset();
          if (running) finish(running, new OcrError("The ISBN reader restarted. Please try again.", 503));
        };
        current.on("error", failed);
        current.on("exit", failed);
      }
      worker.ref();
      job.timer = setTimeout(() => {
        reset();
        finish(job, new OcrError("Reading the ISBN took too long. Try a closer, sharper photo.", 504));
      }, timeoutMs);
      worker.postMessage({ image: job.image, contentType: job.contentType });
    } catch {
      reset();
      finish(job, new OcrError("The ISBN reader could not start. Please try again.", 503));
    }
  };
  return {
    recognize(image, { contentType = "", signal } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (queue.length + Number(Boolean(active)) >= maxJobs) {
        return Promise.reject(new OcrError("The ISBN reader is busy. Please try again in a moment.", 429));
      }
      return new Promise((resolve, reject) => {
        const job = { image, contentType, signal, resolve, reject };
        job.abort = () => {
          if (active === job) reset();
          else queue.splice(queue.indexOf(job), 1);
          finish(job, signal.reason || new Error("Scan cancelled"));
        };
        signal?.addEventListener("abort", job.abort, { once: true });
        queue.push(job);
        pump();
      });
    },
    async close() {
      const error = new OcrError("The ISBN reader is shutting down.", 503);
      for (const job of queue.splice(0)) {
        job.signal?.removeEventListener("abort", job.abort);
        job.reject(error);
      }
      const stopped = reset();
      if (active) finish(active, error);
      clearTimeout(idleTimer);
      await stopped;
    },
  };
}
