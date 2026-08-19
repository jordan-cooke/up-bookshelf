import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBook, initializeDatabase, listBooks } from "../src/repository.js";
import { validateBook } from "../src/validation.js";

test("persists the library to a SQLite file across restarts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jnc-bookshelf-test-"));
  const databasePath = path.join(directory, "bookshelf.sqlite");

  try {
    let database = new DatabaseSync(databasePath, { timeout: 1000 });
    initializeDatabase(database);
    createBook(database, validateBook({
      title: "The Dispossessed",
      authors: ["Ursula K. Le Guin"],
      isbn13: "9780061054884",
    }));
    assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    database.close();

    database = new DatabaseSync(databasePath, { timeout: 1000 });
    initializeDatabase(database);
    const result = listBooks(database, { search: "Dispossessed" });
    assert.equal(result.total, 1);
    assert.equal(result.books[0].authors[0], "Ursula K. Le Guin");
    database.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
