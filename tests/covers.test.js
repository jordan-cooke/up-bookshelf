import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheBookCover, resolveCoverFile } from "../src/covers.js";

test("downloads an approved cover into persistent storage", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jnc-covers-"));
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
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jnc-covers-"));
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
