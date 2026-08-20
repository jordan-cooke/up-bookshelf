import test from "node:test";
import assert from "node:assert/strict";
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
      app: "JnC Bookshelf",
      version: "1.2.0",
      storage: "sqlite",
      authentication: false,
    });
    assert.equal(health.headers.get("x-jnc-bookshelf-version"), "1.2.0");

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
    const html = await page.text();
    assert.match(html, /styles\.css\?v=1\.2\.0/);
    assert.match(html, /capture="environment"/);

    const stylesheet = await fetch(`${baseUrl}/styles.css?v=1.2.0`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
    assert.match(await stylesheet.text(), /\.site-header/);

    const script = await fetch(`${baseUrl}/app.js?v=1.2.0`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /^text\/javascript/);
    assert.match(await script.text(), /scanBarcodePhoto/);

    const icon = await fetch(`${baseUrl}/icon.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type"), /^image\/svg\+xml/);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).name, "JnC Bookshelf");

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
    });
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
    const response = await fetch(`${baseUrl}/api/lookup/12345`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid ISBN/);
  });
});

test("the local library does not require authentication", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/books`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("www-authenticate"), null);
  });
});
