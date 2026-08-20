import test from "node:test";
import assert from "node:assert/strict";
import { validateBook, ValidationError } from "../src/validation.js";

test("normalizes a valid book payload", () => {
  const book = validateBook({
    title: "  The Left Hand of Darkness  ",
    authors: [" Ursula K. Le Guin ", "Ursula K. Le Guin"],
    isbn10: "0441478123",
    rating: "5",
    readingStatus: "read",
    categories: "Science Fiction, Classics",
  });

  assert.equal(book.title, "The Left Hand of Darkness");
  assert.deepEqual(book.authors, ["Ursula K. Le Guin"]);
  assert.equal(book.isbn13, "9780441478125");
  assert.equal(book.rating, 5);
  assert.deepEqual(book.categories, ["Science Fiction", "Classics"]);
});

test("rejects missing titles and malformed ISBNs", () => {
  assert.throws(() => validateBook({ title: "" }), ValidationError);
  assert.throws(() => validateBook({ title: "Book", isbn13: "9780306406158" }), /ISBN-13 is not valid/);
});

test("rejects non-http cover URLs", () => {
  assert.throws(() => validateBook({ title: "Book", coverUrl: "javascript:alert(1)" }), /Cover URL/);
});

test("allows a locally cached Bookshelf cover", () => {
  const book = validateBook({ title: "Book", coverUrl: "/api/covers/9781399745413.jpg" });
  assert.equal(book.coverUrl, "/api/covers/9781399745413.jpg");
});
