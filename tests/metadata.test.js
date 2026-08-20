import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleBook, normalizeOpenLibraryBook } from "../src/metadata.js";

test("normalizes Google Books metadata and upgrades cover URLs", () => {
  const result = normalizeGoogleBook(
    {
      items: [{
        volumeInfo: {
          title: "A Wizard of Earthsea",
          authors: ["Ursula K. Le Guin"],
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780547773742" }],
          imageLinks: { large: "http://example.com/large-cover.jpg", thumbnail: "http://example.com/cover.jpg" },
          pageCount: 320,
        },
      }],
    },
    "9780547773742",
  );

  assert.equal(result.title, "A Wizard of Earthsea");
  assert.deepEqual(result.authors, ["Ursula K. Le Guin"]);
  assert.equal(result.coverUrl, "https://example.com/large-cover.jpg");
  assert.equal(result.metadataSource, "Google Books");
});

test("normalizes Open Library metadata", () => {
  const result = normalizeOpenLibraryBook(
    {
      "ISBN:9780306406157": {
        title: "Example Book",
        authors: [{ name: "Example Author" }],
        publishers: [{ name: "Example Press" }],
        cover: { medium: "https://example.com/book.jpg" },
      },
    },
    "9780306406157",
  );

  assert.equal(result.title, "Example Book");
  assert.equal(result.publisher, "Example Press");
  assert.deepEqual(result.authors, ["Example Author"]);
});
