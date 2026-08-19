import { createApp } from "../src/app.js";

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

const pool = {
  async query(sql) {
    if (sql.includes("SELECT 1")) return [[{ ok: 1 }]];
    if (sql.includes("SUM(reading_status")) {
      return [[{ total: 3, read_count: 1, reading_count: 1, unread_count: 1 }]];
    }
    if (sql.includes("SELECT * FROM books")) return [sampleRows];
    return [[]];
  },
  async execute(sql, parameters = []) {
    if (sql.includes("COUNT(*)")) return [[{ total: sampleRows.length }]];
    if (sql.includes("WHERE id = ?")) return [[sampleRows.find((row) => row.id === Number(parameters[0]))]];
    if (sql.startsWith("SELECT * FROM books")) return [sampleRows];
    return [[]];
  },
};

const app = createApp({ pool });
const server = app.listen(4173, "127.0.0.1", () => console.log("Fixture bookshelf: http://127.0.0.1:4173"));
const keepAlive = setInterval(() => {}, 60_000);
process.on("SIGINT", () => {
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
});
