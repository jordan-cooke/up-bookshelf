import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBook, initializeDatabase, listBooks, listCollections } from "../src/repository.js";
import { validateBook } from "../src/validation.js";

test("paginates large collections with stable order and safe sort/limit input", () => {
  const database = new DatabaseSync(":memory:");
  try {
    initializeDatabase(database);
    for (let index = 0; index < 310; index++) {
      createBook(database, validateBook({ title: `Book ${String(index).padStart(3, "0")}` }));
    }
    const first = listBooks(database, { sort: "title", order: "asc", limit: 100 });
    const second = listBooks(database, { sort: "title", order: "asc", limit: 100, offset: 100 });
    assert.equal(first.total, 310);
    assert.equal(second.total, 310);
    assert.equal(first.books.length, 100);
    assert.equal(first.books[99].title, "Book 099");
    assert.equal(second.books[0].title, "Book 100");
    assert.equal(new Set([...first.books, ...second.books].map(book => book.id)).size, 200);
    for (const sort of ["__proto__", "constructor", "title; DROP TABLE books"]) {
      assert.equal(listBooks(database, { sort, limit: "NaN", offset: -4 }).books.length, 250);
    }
    assert.equal(listBooks(database, { limit: 1e10 }).books.length, 310);
    assert.equal(listBooks(database, { offset: Infinity }).total, 310);
  } finally { database.close(); }
});

test("persists the library to a SQLite file across restarts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "up-bookshelf-test-"));
  const databasePath = path.join(directory, "bookshelf.sqlite");

  try {
    let database = new DatabaseSync(databasePath, { timeout: 1000 });
    initializeDatabase(database);
    createBook(database, validateBook({
      title: "The Dispossessed",
      authors: ["Ursula K. Le Guin"],
      isbn13: "9780061054884",
      rating: 5,
      bookRating: 4.2,
      bookRatingsCount: 91,
      bookRatingSource: "Google Books",
      collections: ["Hainish Cycle", "Favorites"],
    }));
    assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    database.close();

    database = new DatabaseSync(databasePath, { timeout: 1000 });
    initializeDatabase(database);
    const result = listBooks(database, { search: "Dispossessed" });
    assert.equal(result.total, 1);
    assert.equal(result.books[0].authors[0], "Ursula K. Le Guin");
    assert.equal(result.books[0].rating, 5);
    assert.equal(result.books[0].bookRating, 4.2);
    assert.equal(result.books[0].bookRatingsCount, 91);
    assert.equal(result.books[0].bookRatingSource, "Google Books");
    assert.deepEqual(result.books[0].collections, ["Hainish Cycle", "Favorites"]);
    assert.equal(listBooks(database, { collection: "Hainish Cycle" }).total, 1);
    assert.deepEqual(listCollections(database), [{ name: "Favorites", count: 1 }, { name: "Hainish Cycle", count: 1 }]);
    database.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("adds provider-rating and collection columns to an existing library", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    authors TEXT NOT NULL DEFAULT '[]',
    author_sort TEXT NOT NULL DEFAULT '',
    isbn_10 TEXT UNIQUE,
    isbn_13 TEXT UNIQUE,
    publisher TEXT NOT NULL DEFAULT '',
    published_date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    page_count INTEGER,
    categories TEXT NOT NULL DEFAULT '[]',
    cover_url TEXT,
    language TEXT NOT NULL DEFAULT '',
    reading_status TEXT NOT NULL DEFAULT 'unread',
    rating INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    metadata_source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  initializeDatabase(database);
  const columns = new Set(database.prepare("PRAGMA table_info(books)").all().map((column) => column.name));
  assert.equal(columns.has("book_rating"), true);
  assert.equal(columns.has("book_ratings_count"), true);
  assert.equal(columns.has("book_rating_source"), true);
  assert.equal(columns.has("collections"), true);
  assert.equal(columns.has("collection_sort"), true);
  database.close();
});
