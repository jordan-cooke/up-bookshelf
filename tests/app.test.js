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
      version: "2.3.0",
      storage: "sqlite",
      authentication: false,
    });
    assert.equal(health.headers.get("x-up-bookshelf-version"), "2.3.0");

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
    assert.match(html, /styles\.css\?v=2\.3\.0/);
    assert.match(html, /capture="environment"/);
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /id="camera-select"/);
    assert.match(html, /id="torch-button"/);
    assert.match(html, /id="metadata-dialog"/);
    assert.match(html, /id="cover-options-button"/);
    assert.match(html, /id="custom-cover-file"/);
    assert.match(html, /id="google-books-key"/);
    assert.match(html, /id="settings-tagline-enabled"/);
    assert.match(html, /id="metadata-search-form"/);
    assert.match(html, /id="metadata-results"/);
    assert.match(html, /id="amazon-cookie"/);
    assert.match(html, /id="test-amazon-cookie"/);
    assert.match(html, /id="continuous-scan"/);
    assert.match(html, /Simpler · less secure/);
    assert.match(html, /More secure · stable/);
    assert.match(html, />Book rating</);
    assert.match(html, />Your rating</);

    const stylesheet = await fetch(`${baseUrl}/styles.css?v=2.3.0`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
    const css = await stylesheet.text();
    assert.match(css, /\.site-header/);
    assert.match(css, /\.tagline-hidden \.hero/);
    assert.match(css, /\.metadata-result-grid/);

    const script = await fetch(`${baseUrl}/app.js?v=2.3.0`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /^text\/javascript/);
    const javascript = await script.text();
    assert.match(javascript, /scanBarcodePhoto/);
    assert.match(javascript, /resumeContinuousScanning/);

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
        bookRating: 4.6,
        bookRatingsCount: 1204,
        bookRatingSource: "Google Books",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.id, 1);
    assert.equal(created.readingStatus, "reading");
    assert.equal(created.bookRating, 4.6);
    assert.equal(created.bookRatingsCount, 1204);
    assert.equal(created.bookRatingSource, "Google Books");

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

test("persists a custom name and toggleable motto in SQLite", async () => {
  await withServer({}, async (baseUrl) => {
    const saved = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Family", tagline: "Our stories live here.", taglineEnabled: true }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual({
      appName: (await saved.json()).appName,
      tagline: (await (await fetch(`${baseUrl}/api/config`)).json()).tagline,
    }, { appName: "Family Bookshelf", tagline: "Our stories live here." });

    await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", tagline: "Our stories live here.", taglineEnabled: false }),
    });
    const reset = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(reset.appName, "UP Bookshelf");
    assert.equal(reset.tagline, "");
    assert.equal(reset.taglineText, "Our stories live here.");
    assert.equal(reset.taglineEnabled, false);
  });
});

test("stores and tests provider credentials without returning their values to the browser", async () => {
  let lookupOptions;
  const lookup = async (_isbn, options) => {
    lookupOptions = options;
    return { merged: null, providers: [] };
  };
  let testedCookieOptions;
  const testAmazonCookie = async (options) => {
    testedCookieOptions = options;
    return { ok: true, count: 3 };
  };
  await withServer({ lookup, testAmazonCookie }, async (baseUrl, database) => {
    const secrets = {
      googleBooksApiKey: "test-google-secret",
      amazonClientId: "test-amazon-id",
      amazonClientSecret: "test-amazon-secret",
      amazonAssociateTag: "example-20",
      amazonCredentialVersion: "3.1",
      amazonMarketplace: "www.amazon.com",
      amazonCookie: "Cookie: session-id=test-cookie-secret; ubid-main=test-browser-session",
    };
    const saved = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", tagline: "Every good story", taglineEnabled: true, ...secrets }),
    });
    assert.equal(saved.status, 200);
    const config = await saved.json();
    assert.equal(config.providers.google.configured, true);
    assert.equal(config.providers.amazon.configured, true);
    assert.equal(config.providers.amazonCookie.configured, true);
    assert.doesNotMatch(JSON.stringify(config), /test-google-secret|test-amazon-secret|test-amazon-id|test-cookie-secret|test-browser-session/);

    assert.equal((await fetch(`${baseUrl}/api/metadata/9780547928227`)).status, 404);
    assert.equal(lookupOptions.googleBooksApiKey, "test-google-secret");
    assert.equal(lookupOptions.amazonClientSecret, "test-amazon-secret");
    assert.match(lookupOptions.amazonCookie, /test-cookie-secret/);
    assert.equal(database.prepare("SELECT value FROM app_settings WHERE key = 'amazon_cookie'").get().value, "session-id=test-cookie-secret; ubid-main=test-browser-session");

    const cookieTest = await fetch(`${baseUrl}/api/providers/amazon-cookie/test`, { method: "POST" });
    assert.equal(cookieTest.status, 200);
    assert.equal((await cookieTest.json()).count, 3);
    assert.match(testedCookieOptions.amazonCookie, /test-cookie-secret/);

    const removed = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", tagline: "Every good story", taglineEnabled: true, removeGoogleBooksApiKey: true, removeAmazonCreatorsCredentials: true, removeAmazonCookie: true }),
    });
    const removedConfig = await removed.json();
    assert.equal(removedConfig.providers.google.configured, false);
    assert.equal(removedConfig.providers.amazon.configured, false);
    assert.equal(removedConfig.providers.amazonCookie.configured, false);
  });
});

test("explains when the Amazon cookie test has no saved cookie", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/amazon-cookie/test`, { method: "POST" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Save an Amazon cookie before testing it." });
  });
});

test("searches multiple provider editions by ISBN, title, and author", async () => {
  let received;
  const searchMetadata = async (query, options) => {
    received = { query, options };
    return {
      providers: [{ id: "openlibrary", name: "Open Library", configured: true, available: true, count: 1, error: "" }],
      results: [{ id: "openlibrary-0", providerId: "openlibrary", providerName: "Open Library", book: { title: "Nero", authors: ["S. J. Tilly"] } }],
    };
  };
  await withServer({ searchMetadata }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/metadata-search?isbn=9781399745413&title=Nero&author=S.%20J.%20Tilly`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results.length, 1);
    assert.deepEqual(received.query, { isbn: "9781399745413", title: "Nero", author: "S. J. Tilly" });
    assert.equal((await fetch(`${baseUrl}/api/metadata-search`)).status, 400);
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
  const coverDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-app-covers-"));
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

test("uploads a custom cover into persistent storage", async () => {
  const coverDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "up-custom-covers-"));
  try {
    const jpeg = Buffer.alloc(2048, 7);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    await withServer({ coverDirectory }, async (baseUrl) => {
      const upload = await fetch(`${baseUrl}/api/covers/upload`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: jpeg,
      });
      assert.equal(upload.status, 201);
      const { coverUrl } = await upload.json();
      assert.match(coverUrl, /^\/api\/covers\/custom-[a-f0-9-]{36}\.jpg$/);
      const cover = await fetch(`${baseUrl}${coverUrl}`);
      assert.equal(cover.status, 200);
      assert.equal((await cover.arrayBuffer()).byteLength, jpeg.length);

      const created = await fetch(`${baseUrl}/api/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Custom Cover Book" }),
      });
      const book = await created.json();
      const saved = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverUrl }),
      });
      assert.equal(saved.status, 200);
      assert.equal((await saved.json()).coverUrl, coverUrl);
      assert.equal((await (await fetch(`${baseUrl}/api/books/${book.id}`)).json()).coverUrl, coverUrl);
    });
  } finally {
    await fs.promises.rm(coverDirectory, { recursive: true, force: true });
  }
});
