import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/repository.js";

const sampleRows = [
  {
    id: 1,
    title: "A Wizard of Earthsea",
    subtitle: "",
    authors: JSON.stringify(["Ursula K. Le Guin"]),
    author_sort: "Ursula K. Le Guin",
    isbn_10: "0547773749",
    isbn_13: "9780547773742",
    publisher: "Clarion Books",
    published_date: "2012",
    description: "Ged was the greatest sorcerer in all Earthsea, but once he was called Sparrowhawk.",
    page_count: 320,
    categories: JSON.stringify(["Fantasy", "Classics"]),
    cover_url: "https://covers.openlibrary.org/b/isbn/9780547773742-L.jpg",
    language: "en",
    reading_status: "read",
    rating: 5,
    notes: "A forever favorite.",
    metadata_source: "Test fixture",
    created_at: new Date("2026-08-01T12:00:00Z"),
    updated_at: new Date("2026-08-01T12:00:00Z"),
  },
  {
    id: 2,
    title: "The Thursday Murder Club",
    subtitle: "A Novel",
    authors: JSON.stringify(["Richard Osman"]),
    author_sort: "Richard Osman",
    isbn_10: "1984880985",
    isbn_13: "9781984880987",
    publisher: "Pamela Dorman Books",
    published_date: "2020",
    description: "Four friends meet weekly to investigate unsolved murders.",
    page_count: 368,
    categories: JSON.stringify(["Mystery"]),
    cover_url: "https://covers.openlibrary.org/b/isbn/9781984880987-L.jpg",
    language: "en",
    reading_status: "reading",
    rating: null,
    notes: "",
    metadata_source: "Test fixture",
    created_at: new Date("2026-08-02T12:00:00Z"),
    updated_at: new Date("2026-08-02T12:00:00Z"),
  },
  {
    id: 3,
    title: "Braiding Sweetgrass",
    subtitle: "Indigenous Wisdom, Scientific Knowledge, and the Teachings of Plants",
    authors: JSON.stringify(["Robin Wall Kimmerer"]),
    author_sort: "Robin Wall Kimmerer",
    isbn_10: "1571313567",
    isbn_13: "9781571313560",
    publisher: "Milkweed Editions",
    published_date: "2015",
    description: "A botanist embraces the notion that plants and animals are our oldest teachers.",
    page_count: 408,
    categories: JSON.stringify(["Nature", "Essays"]),
    cover_url: "https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg",
    language: "en",
    reading_status: "unread",
    rating: null,
    notes: "",
    metadata_source: "Test fixture",
    created_at: new Date("2026-08-03T12:00:00Z"),
    updated_at: new Date("2026-08-03T12:00:00Z"),
  },
];

const database = new DatabaseSync(":memory:");
initializeDatabase(database);
const insert = database.prepare(`
  INSERT INTO books (
    id, title, subtitle, authors, author_sort, isbn_10, isbn_13, publisher, published_date,
    description, page_count, categories, cover_url, language, reading_status, rating, notes,
    metadata_source, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const row of sampleRows) {
  insert.run(
    row.id, row.title, row.subtitle, row.authors, row.author_sort, row.isbn_10, row.isbn_13,
    row.publisher, row.published_date, row.description, row.page_count, row.categories,
    row.cover_url, row.language, row.reading_status, row.rating, row.notes, row.metadata_source,
    row.created_at.toISOString(), row.updated_at.toISOString(),
  );
}

const app = createApp({ database });
const server = app.listen(4173, "127.0.0.1", () => console.log("Fixture bookshelf: http://127.0.0.1:4173"));
const keepAlive = setInterval(() => {}, 60_000);
process.on("SIGINT", () => {
  clearInterval(keepAlive);
  server.close(() => {
    database.close();
    process.exit(0);
  });
});
