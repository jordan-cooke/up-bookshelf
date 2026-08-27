import test from "node:test";
import assert from "node:assert/strict";
import { validateBook, ValidationError } from "../src/validation.js";

test("normalizes a valid book payload", () => {
  const book = validateBook({
    title: "  The Left Hand of Darkness  ",
    authors: [" Ursula K. Le Guin ", "Ursula K. Le Guin"],
    isbn10: "0441478123",
    rating: "5",
    bookRating: "4.3",
    bookRatingsCount: "782",
    bookRatingSource: "Google Books",
    readingStatus: "read",
    categories: "Science Fiction, Classics",
    collections: "Hainish Cycle, Favorites, Hainish Cycle",
  });

  assert.equal(book.title, "The Left Hand of Darkness");
  assert.deepEqual(book.authors, ["Ursula K. Le Guin"]);
  assert.equal(book.isbn13, "9780441478125");
  assert.equal(book.rating, 5);
  assert.equal(book.bookRating, 4.3);
  assert.equal(book.bookRatingsCount, 782);
  assert.equal(book.bookRatingSource, "Google Books");
  assert.deepEqual(book.categories, ["Science Fiction", "Classics"]);
  assert.deepEqual(book.collections, ["Hainish Cycle", "Favorites"]);
  assert.equal(book.collectionSort, "Hainish Cycle");
});

test("rejects missing titles and malformed ISBNs", () => {
  assert.throws(() => validateBook({ title: "" }), ValidationError);
  assert.throws(() => validateBook({ title: "Book", isbn13: "9780306406158" }), /ISBN-13 is not valid/);
});

test("rejects non-http cover URLs", () => {
  assert.throws(() => validateBook({ title: "Book", coverUrl: "javascript:alert(1)" }), /Cover URL/);
});

test("rejects invalid provider ratings without affecting personal ratings", () => {
  assert.throws(() => validateBook({ title: "Book", bookRating: "5.1" }), /Book rating/);
  assert.throws(() => validateBook({ title: "Book", bookRatingsCount: "2.5" }), /rating count/);
});

test("allows a locally cached Bookshelf cover", () => {
  const book = validateBook({ title: "Book", coverUrl: "/api/covers/9781399745413.jpg" });
  assert.equal(book.coverUrl, "/api/covers/9781399745413.jpg");
  const custom = validateBook({ title: "Book", coverUrl: "/api/covers/custom-123e4567-e89b-12d3-a456-426614174000.jpg" });
  assert.equal(custom.coverUrl, "/api/covers/custom-123e4567-e89b-12d3-a456-426614174000.jpg");
});
