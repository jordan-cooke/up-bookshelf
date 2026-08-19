import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

function fakePool() {
  return {
    async query(sql) {
      if (sql.includes("SELECT 1")) return [[{ ok: 1 }]];
      if (sql.includes("COUNT(*)")) return [[{ total: 0, read_count: 0, reading_count: 0, unread_count: 0 }]];
      return [[]];
    },
    async execute(sql) {
      if (sql.includes("COUNT(*)")) return [[{ total: 0 }]];
      return [[]];
    },
  };
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health and empty bookshelf endpoints respond", async () => {
  await withServer(createApp({ pool: fakePool() }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const response = await fetch(`${baseUrl}/api/books?sort=title&order=asc`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { books: [], total: 0 });
  });
});

test("invalid ISBN lookups are rejected before provider access", async () => {
  await withServer(createApp({ pool: fakePool(), lookup: () => assert.fail("lookup should not run") }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup/12345`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid ISBN/);
  });
});

test("optional password protects the library but not health checks", async () => {
  await withServer(createApp({ pool: fakePool(), appPassword: "secret" }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/books`)).status, 401);
    const authorization = `Basic ${Buffer.from("bookshelf:secret").toString("base64")}`;
    assert.equal((await fetch(`${baseUrl}/api/books`, { headers: { authorization } })).status, 200);
  });
});
