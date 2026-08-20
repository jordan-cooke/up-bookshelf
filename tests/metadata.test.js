import test from "node:test";
import assert from "node:assert/strict";
import { mergeBookMetadata, normalizeGoogleBook, normalizeOpenLibraryBook } from "../src/metadata.js";

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
    {
      covers: [15107046],
      languages: [{ key: "/languages/eng" }],
      works: [{ key: "/works/OL39663865W" }],
    },
    {
      description: { value: "A complete work-level description." },
    },
  );

  assert.equal(result.title, "Example Book");
  assert.equal(result.publisher, "Example Press");
  assert.deepEqual(result.authors, ["Example Author"]);
  assert.equal(result.description, "A complete work-level description.");
  assert.equal(result.language, "eng");
  assert.equal(result.coverCandidates[0], "https://covers.openlibrary.org/b/id/15107046.jpg?default=false");
});

test("merges providers so richer descriptions and cover choices are retained", () => {
  const result = mergeBookMetadata(
    {
      title: "Quicksilver",
      authors: ["Callie Hart"],
      description: "A richer synopsis.",
      coverUrl: "https://books.google.com/cover.jpg",
      coverCandidates: ["https://books.google.com/cover.jpg"],
      preferredCoverCandidates: [],
      categories: ["Fantasy"],
      metadataSource: "Google Books",
    },
    {
      title: "Quicksilver",
      publisher: "Hodder & Stoughton",
      description: "",
      coverUrl: "https://covers.openlibrary.org/cover.jpg",
      coverCandidates: ["https://covers.openlibrary.org/cover.jpg"],
      preferredCoverCandidates: ["https://covers.openlibrary.org/cover.jpg"],
      categories: ["Alternate Worlds"],
      metadataSource: "Open Library",
    },
  );

  assert.equal(result.description, "A richer synopsis.");
  assert.equal(result.publisher, "Hodder & Stoughton");
  assert.deepEqual(result.categories, ["Fantasy", "Alternate Worlds"]);
  assert.equal(result.coverCandidates.length, 2);
  assert.equal(result.coverUrl, "https://covers.openlibrary.org/cover.jpg");
  assert.equal(result.metadataSource, "Google Books + Open Library");
});
