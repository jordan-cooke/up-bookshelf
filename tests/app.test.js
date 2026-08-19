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
    assert.deepEqual(await health.json(), { status: "ok" });

    const response = await fetch(`${baseUrl}/api/books?sort=title&order=asc`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { books: [], total: 0 });
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

    const updateResponse = await fetch(`${baseUrl}/api/books/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...created, readingStatus: "read", rating: 5 }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).rating, 5);

    assert.equal((await fetch(`${baseUrl}/api/books/${created.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await (await fetch(`${baseUrl}/api/books`)).json()).total, 0);
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

test("optional password protects the library but not health checks", async () => {
  await withServer({ appPassword: "secret" }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/books`)).status, 401);
    const authorization = `Basic ${Buffer.from("bookshelf:secret").toString("base64")}`;
    assert.equal((await fetch(`${baseUrl}/api/books`, { headers: { authorization } })).status, 200);
  });
});
