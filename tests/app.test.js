import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/repository.js";

function testDatabase() {
  const database = new DatabaseSync(":memory:", { timeout: 1000 });
  initializeDatabase(database);
  return database;
}

async function withServer(options, callback) {
  const database = testDatabase();
  const app = createApp({ database, ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`, database);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
}

test("health and empty bookshelf endpoints respond", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      app: "UP Bookshelf",
      version: "2.0.0",
      storage: "sqlite",
      authentication: false,
    });
    assert.equal(health.headers.get("x-up-bookshelf-version"), "2.0.0");

    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.appName, "UP Bookshelf");
    assert.equal(config.brandName, "UP");

    const response = await fetch(`${baseUrl}/api/books?sort=title&order=asc`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { books: [], total: 0 });
  });
});

test("serves the styled app shell with safe cache headers", async () => {
  await withServer({}, async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(page.headers.get("content-security-policy"), /upgrade-insecure-requests/);
    const html = await page.text();
    assert.match(html, /styles\.css\?v=2\.0\.0/);
    assert.match(html, /capture="environment"/);
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /id="camera-select"/);
    assert.match(html, /id="torch-button"/);
    assert.match(html, /id="metadata-dialog"/);

    const stylesheet = await fetch(`${baseUrl}/styles.css?v=2.0.0`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
    assert.match(await stylesheet.text(), /\.site-header/);

    const script = await fetch(`${baseUrl}/app.js?v=2.0.0`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /^text\/javascript/);
    assert.match(await script.text(), /scanBarcodePhoto/);

    const icon = await fetch(`${baseUrl}/icon.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type"), /^image\/svg\+xml/);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).name, "UP Bookshelf");

    const barcodeReader = await fetch(`${baseUrl}/vendor/html5-qrcode/html5-qrcode.min.js`);
    assert.equal(barcodeReader.status, 200);
    assert.match(barcodeReader.headers.get("content-type"), /^text\/javascript/);

    assert.equal((await fetch(`${baseUrl}/missing.css`)).status, 404);
  });
});

test("creates, searches, updates, and deletes a SQLite-backed book", async () => {
  await withServer({}, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "A Wizard of Earthsea",
        authors: ["Ursula K. Le Guin"],
        isbn13: "9780547773742",
        readingStatus: "reading",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.id, 1);
    assert.equal(created.readingStatus, "reading");

    const searchResponse = await fetch(`${baseUrl}/api/books?q=Earthsea`);
    const search = await searchResponse.json();
    assert.equal(search.total, 1);
    assert.equal(search.books[0].title, "A Wizard of Earthsea");

    const statsBeforeUpdate = await (await fetch(`${baseUrl}/api/stats`)).json();
    assert.deepEqual(statsBeforeUpdate, { total: 1, read: 0, reading: 1, unread: 0 });

    const exported = await (await fetch(`${baseUrl}/api/export`)).json();
    assert.equal(exported.version, 1);
    assert.equal(exported.books.length, 1);
    assert.equal(exported.books[0].isbn13, "9780547773742");

    const updateResponse = await fetch(`${baseUrl}/api/books/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...created, readingStatus: "read", rating: 5 }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).rating, 5);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/stats`)).json(), { total: 1, read: 1, reading: 0, unread: 0 });

    assert.equal((await fetch(`${baseUrl}/api/books/${created.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await (await fetch(`${baseUrl}/api/books`)).json()).total, 0);
  });
});

test("looks up a valid ISBN and returns normalized book details", async () => {
  const lookup = async (isbn) => ({
    title: "The Hobbit",
    authors: ["J. R. R. Tolkien"],
    isbn13: isbn,
    readingStatus: "unread",
  });
  await withServer({ lookup }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup/9780547928227`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      existing: null,
      book: {
        title: "The Hobbit",
        authors: ["J. R. R. Tolkien"],
        isbn13: "9780547928227",
        readingStatus: "unread",
      },
      providers: [],
    });
  });
});

test("uses an optional private library name without changing the image", async () => {
  await withServer({ bookshelfName: "JnC" }, async (baseUrl) => {
    assert.equal((await (await fetch(`${baseUrl}/api/config`)).json()).appName, "JnC Bookshelf");
    assert.equal((await (await fetch(`${baseUrl}/manifest.webmanifest`)).json()).name, "JnC Bookshelf");
    assert.equal((await (await fetch(`${baseUrl}/api/health`)).json()).app, "JnC Bookshelf");
  });
});

test("persists a custom name and removable welcome message in SQLite", async () => {
  await withServer({ bookshelfName: "Family" }, async (baseUrl) => {
    const saved = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "JnC", tagline: "Our stories live here." }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual({
      appName: (await saved.json()).appName,
      tagline: (await (await fetch(`${baseUrl}/api/config`)).json()).tagline,
    }, { appName: "JnC Bookshelf", tagline: "Our stories live here." });

    await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", tagline: "" }),
    });
    const reset = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(reset.appName, "Family Bookshelf");
    assert.equal(reset.tagline, "");
  });
});

test("duplicate ISBNs are rejected", async () => {
  await withServer({}, async (baseUrl) => {
    const request = () => fetch(`${baseUrl}/api/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Duplicate", isbn13: "9780547773742" }),
    });
    assert.equal((await request()).status, 201);
    const duplicate = await request();
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already in your bookshelf/);
  });
});

test("invalid ISBN lookups are rejected before provider access", async () => {
  await withServer({ lookup: () => assert.fail("lookup should not run") }, async (baseUrl) => {
    for (const barcode of ["12345", "0718619412953"]) {
      const response = await fetch(`${baseUrl}/api/lookup/${barcode}`);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /valid ISBN/);
    }
  });
});

test("the local library does not require authentication", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/books`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("www-authenticate"), null);
  });
});

test("serves cached covers from the persistent data directory", async () => {
  const coverDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jnc-app-covers-"));
  try {
    await fs.promises.writeFile(path.join(coverDirectory, "9781399745413.jpg"), Buffer.alloc(2048, 1));
    await withServer({ coverDirectory }, async (baseUrl) => {
      const cover = await fetch(`${baseUrl}/api/covers/9781399745413.jpg`);
      assert.equal(cover.status, 200);
      assert.equal(cover.headers.get("content-type"), "image/jpeg");
      assert.match(cover.headers.get("cache-control"), /immutable/);
      assert.equal((await cover.arrayBuffer()).byteLength, 2048);
      assert.equal((await fetch(`${baseUrl}/api/covers/not-a-cover.jpg`)).status, 404);
    });
  } finally {
    await fs.promises.rm(coverDirectory, { recursive: true, force: true });
  }
});
