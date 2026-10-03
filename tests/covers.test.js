import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheBookCover, coverCacheState, fetchProviderCover, resolveCoverFile } from "../src/covers.js";

test("fetches an approved provider cover for same-origin previews", async () => {
  const cover = await fetchProviderCover({
    value: "https://covers.openlibrary.org/b/id/15107046-L.jpg",
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, "covers.openlibrary.org");
      assert.equal(url.searchParams.get("default"), "false");
      assert.match(options.headers.Accept, /image\/jpeg/);
      return new Response(Buffer.alloc(2048, 4), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    },
  });
  assert.equal(cover.contentType, "image/jpeg");
  assert.equal(cover.bytes.length, 2048);
});

test("blocks redirects to private or unapproved hosts before contacting them", async () => {
  let calls = 0;
  const result = await fetchProviderCover({
    value: "https://books.google.com/cover",
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("follows approved cover redirects with a finite hop limit", async () => {
  let calls = 0;
  const result = await fetchProviderCover({
    value: "https://books.google.com/cover",
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 302, headers: { Location: "https://books.googleusercontent.com/cover.jpg" } })
        : new Response(Buffer.alloc(2048), { headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.equal(result.bytes.length, 2048);
  calls = 0;
  assert.equal(await fetchProviderCover({
    value: "https://books.google.com/cover",
    fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { Location: "/cover" } }); },
  }), null);
  assert.equal(calls, 5);
});

test("rejects credentials and nonstandard ports in provider URLs", async () => {
  for (const value of ["https://user:secret@books.google.com/cover", "https://books.google.com:8080/cover"]) {
    assert.equal(await fetchProviderCover({ value, fetchImpl: () => assert.fail("must not fetch") }), null);
  }
});

test("stops oversized chunked downloads without trusting Content-Length", async () => {
  let cancelled = false;
  const result = await fetchProviderCover({
    value: "https://books.google.com/cover",
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "image/jpeg" } }),
  });
  assert.equal(result, null);
  assert.equal(cancelled, true);
});

test("downloads an approved cover into persistent storage", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-covers-"));
  try {
    const fetchImpl = async (url) => {
      assert.equal(url.hostname, "covers.openlibrary.org");
      assert.equal(url.searchParams.get("default"), "false");
      return new Response(Buffer.alloc(2048, 1), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    };
    const publicPath = await cacheBookCover({
      isbn: "9781399745413",
      candidates: ["https://covers.openlibrary.org/b/id/15107046-L.jpg"],
      directory,
      fetchImpl,
    });

    assert.equal(publicPath, "/api/covers/9781399745413.jpg");
    assert.ok(resolveCoverFile(directory, "9781399745413.jpg"));
    assert.equal(resolveCoverFile(directory, "../bookshelf.sqlite"), null);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("does not fetch cover URLs from unapproved hosts", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-covers-"));
  try {
    const result = await cacheBookCover({
      isbn: "9781399745413",
      candidates: ["https://example.com/not-a-cover.jpg"],
      directory,
      fetchImpl: () => assert.fail("unapproved URL should not be fetched"),
    });
    assert.equal(result, null);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("replaces a cached cover with a selected Amazon provider image", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-covers-"));
  try {
    await fs.promises.writeFile(path.join(directory, "9781399745413.jpg"), Buffer.alloc(2048, 1));
    const result = await cacheBookCover({
      isbn: "9781399745413",
      candidates: ["https://m.media-amazon.com/images/I/selected.jpg"],
      directory,
      force: true,
      fetchImpl: async (url) => {
        assert.equal(url.hostname, "m.media-amazon.com");
        return new Response(Buffer.alloc(3072, 2), { status: 200, headers: { "Content-Type": "image/jpeg" } });
      },
    });
    assert.equal(result, "/api/covers/9781399745413.jpg");
    assert.equal((await fs.promises.stat(path.join(directory, "9781399745413.jpg"))).size, 3072);
    const state = coverCacheState(directory, "9781399745413.jpg");
    assert.equal(state.provider, "amazon");
    assert.equal(state.expired, false);
    assert.ok(state.maxAge <= 86400);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("marks Amazon cover resources expired after the required one-day TTL", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-covers-"));
  try {
    await fs.promises.writeFile(path.join(directory, "9781399745413.jpg"), Buffer.alloc(2048, 1));
    await fs.promises.writeFile(path.join(directory, "9781399745413.cover.json"), JSON.stringify({
      provider: "amazon",
      choiceIndex: 2,
      cachedAt: "2020-01-01T00:00:00.000Z",
    }));
    const state = coverCacheState(directory, "9781399745413.jpg");
    assert.equal(state.expired, true);
    assert.equal(state.choiceIndex, 2);
    assert.equal(state.maxAge, 0);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("keeps the previous cover when a replacement cannot be downloaded", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-covers-"));
  try {
    const coverPath = path.join(directory, "9781399745413.jpg");
    await fs.promises.writeFile(coverPath, Buffer.alloc(2048, 7));
    const result = await cacheBookCover({
      isbn: "9781399745413",
      candidates: ["https://m.media-amazon.com/images/I/missing.jpg"],
      directory,
      force: true,
      fetchImpl: async () => new Response("missing", { status: 404, headers: { "Content-Type": "text/plain" } }),
    });
    assert.equal(result, null);
    assert.equal((await fs.promises.readFile(coverPath))[0], 7);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
