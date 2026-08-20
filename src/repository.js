const SORT_COLUMNS = {
  added: "created_at",
  title: "title",
  author: "author_sort",
  published: "published_date",
  rating: "rating",
  updated: "updated_at",
};

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || "[]");
  } catch {
    return fallback;
  }
}

function mapBook(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    subtitle: row.subtitle || "",
    authors: parseJson(row.authors),
    isbn10: row.isbn_10,
    isbn13: row.isbn_13,
    publisher: row.publisher || "",
    publishedDate: row.published_date || "",
    description: row.description || "",
    pageCount: row.page_count,
    categories: parseJson(row.categories),
    coverUrl: row.cover_url,
    language: row.language || "",
    readingStatus: row.reading_status,
    rating: row.rating,
    notes: row.notes || "",
    metadataSource: row.metadata_source || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function valuesFor(book) {
  return [
    book.title,
    book.subtitle,
    JSON.stringify(book.authors),
    book.authorSort,
    book.isbn10,
    book.isbn13,
    book.publisher,
    book.publishedDate,
    book.description,
    book.pageCount,
    JSON.stringify(book.categories),
    book.coverUrl,
    book.language,
    book.readingStatus,
    book.rating,
    book.notes,
    book.metadataSource,
  ];
}

export function initializeDatabase(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS books (
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
      page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
      categories TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT,
      language TEXT NOT NULL DEFAULT '',
      reading_status TEXT NOT NULL DEFAULT 'unread'
        CHECK (reading_status IN ('unread', 'reading', 'read', 'dnf')),
      rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
      notes TEXT NOT NULL DEFAULT '',
      metadata_source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS books_title_index ON books (title);
    CREATE INDEX IF NOT EXISTS books_author_index ON books (author_sort);
    CREATE INDEX IF NOT EXISTS books_status_index ON books (reading_status);
    CREATE INDEX IF NOT EXISTS books_created_index ON books (created_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getAppSettings(database) {
  return Object.fromEntries(database.prepare("SELECT key, value FROM app_settings").all().map((row) => [row.key, row.value]));
}

export function saveAppSettings(database, settings) {
  const statement = database.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  database.exec("BEGIN");
  try {
    for (const [key, value] of Object.entries(settings)) statement.run(key, String(value));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getAppSettings(database);
}

export function listBooks(database, options = {}) {
  const search = String(options.search || "").trim();
  const status = ["unread", "reading", "read", "dnf"].includes(options.status) ? options.status : "";
  const where = [];
  const parameters = [];

  if (search) {
    where.push("(title LIKE ? OR subtitle LIKE ? OR author_sort LIKE ? OR publisher LIKE ? OR isbn_10 LIKE ? OR isbn_13 LIKE ?)");
    const pattern = `%${search}%`;
    parameters.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (status) {
    where.push("reading_status = ?");
    parameters.push(status);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortColumn = SORT_COLUMNS[options.sort] || SORT_COLUMNS.added;
  const direction = options.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(Number(options.limit) || 250, 1), 1000);

  const rows = database
    .prepare(`SELECT * FROM books ${whereSql} ORDER BY ${sortColumn} ${direction}, id ${direction} LIMIT ${limit}`)
    .all(...parameters);
  const count = database.prepare(`SELECT COUNT(*) AS total FROM books ${whereSql}`).get(...parameters);
  return { books: rows.map(mapBook), total: Number(count.total) };
}

export function getBook(database, id) {
  return mapBook(database.prepare("SELECT * FROM books WHERE id = ?").get(id));
}

export function findByIsbn(database, isbn) {
  return mapBook(database.prepare("SELECT * FROM books WHERE isbn_10 = ? OR isbn_13 = ? LIMIT 1").get(isbn, isbn));
}

export function createBook(database, book) {
  const result = database.prepare(`
    INSERT INTO books (
      title, subtitle, authors, author_sort, isbn_10, isbn_13, publisher, published_date,
      description, page_count, categories, cover_url, language, reading_status, rating, notes, metadata_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...valuesFor(book));
  return getBook(database, result.lastInsertRowid);
}

export function updateBook(database, id, book) {
  const result = database.prepare(`
    UPDATE books SET
      title = ?, subtitle = ?, authors = ?, author_sort = ?, isbn_10 = ?, isbn_13 = ?, publisher = ?, published_date = ?,
      description = ?, page_count = ?, categories = ?, cover_url = ?, language = ?, reading_status = ?, rating = ?,
      notes = ?, metadata_source = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(...valuesFor(book), id);
  return result.changes ? getBook(database, id) : null;
}

export function deleteBook(database, id) {
  return database.prepare("DELETE FROM books WHERE id = ?").run(id).changes > 0;
}

export function libraryStats(database) {
  const row = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN reading_status = 'read' THEN 1 ELSE 0 END) AS read_count,
      SUM(CASE WHEN reading_status = 'reading' THEN 1 ELSE 0 END) AS reading_count,
      SUM(CASE WHEN reading_status = 'unread' THEN 1 ELSE 0 END) AS unread_count
    FROM books
  `).get();
  return {
    total: Number(row.total || 0),
    read: Number(row.read_count || 0),
    reading: Number(row.reading_count || 0),
    unread: Number(row.unread_count || 0),
  };
}

export function exportBooks(database) {
  return database.prepare("SELECT * FROM books ORDER BY created_at ASC, id ASC").all().map(mapBook);
}
