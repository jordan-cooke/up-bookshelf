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

export async function initializeDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(500) NOT NULL,
      subtitle VARCHAR(500) NOT NULL DEFAULT '',
      authors JSON NOT NULL,
      author_sort VARCHAR(200) NOT NULL DEFAULT '',
      isbn_10 VARCHAR(10) NULL,
      isbn_13 VARCHAR(13) NULL,
      publisher VARCHAR(300) NOT NULL DEFAULT '',
      published_date VARCHAR(50) NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      page_count INT UNSIGNED NULL,
      categories JSON NOT NULL,
      cover_url VARCHAR(2000) NULL,
      language VARCHAR(30) NOT NULL DEFAULT '',
      reading_status ENUM('unread', 'reading', 'read', 'dnf') NOT NULL DEFAULT 'unread',
      rating TINYINT UNSIGNED NULL,
      notes TEXT NOT NULL,
      metadata_source VARCHAR(100) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY books_isbn_10_unique (isbn_10),
      UNIQUE KEY books_isbn_13_unique (isbn_13),
      INDEX books_title_index (title),
      INDEX books_author_index (author_sort),
      INDEX books_status_index (reading_status),
      INDEX books_created_index (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listBooks(pool, options = {}) {
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

  const [rows] = await pool.execute(
    `SELECT * FROM books ${whereSql} ORDER BY ${sortColumn} ${direction}, id ${direction} LIMIT ${limit}`,
    parameters,
  );
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM books ${whereSql}`, parameters);
  return { books: rows.map(mapBook), total: Number(count.total) };
}

export async function getBook(pool, id) {
  const [[row]] = await pool.execute("SELECT * FROM books WHERE id = ?", [id]);
  return mapBook(row);
}

export async function findByIsbn(pool, isbn) {
  const [[row]] = await pool.execute("SELECT * FROM books WHERE isbn_10 = ? OR isbn_13 = ? LIMIT 1", [isbn, isbn]);
  return mapBook(row);
}

export async function createBook(pool, book) {
  const [result] = await pool.execute(
    `INSERT INTO books (
      title, subtitle, authors, author_sort, isbn_10, isbn_13, publisher, published_date,
      description, page_count, categories, cover_url, language, reading_status, rating, notes, metadata_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    valuesFor(book),
  );
  return getBook(pool, result.insertId);
}

export async function updateBook(pool, id, book) {
  const [result] = await pool.execute(
    `UPDATE books SET
      title = ?, subtitle = ?, authors = ?, author_sort = ?, isbn_10 = ?, isbn_13 = ?, publisher = ?, published_date = ?,
      description = ?, page_count = ?, categories = ?, cover_url = ?, language = ?, reading_status = ?, rating = ?,
      notes = ?, metadata_source = ?
    WHERE id = ?`,
    [...valuesFor(book), id],
  );
  return result.affectedRows ? getBook(pool, id) : null;
}

export async function deleteBook(pool, id) {
  const [result] = await pool.execute("DELETE FROM books WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

export async function libraryStats(pool) {
  const [[row]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(reading_status = 'read') AS read_count,
      SUM(reading_status = 'reading') AS reading_count,
      SUM(reading_status = 'unread') AS unread_count
    FROM books
  `);
  return {
    total: Number(row.total || 0),
    read: Number(row.read_count || 0),
    reading: Number(row.reading_count || 0),
    unread: Number(row.unread_count || 0),
  };
}

export async function exportBooks(pool) {
  const [rows] = await pool.query("SELECT * FROM books ORDER BY created_at ASC, id ASC");
  return rows.map(mapBook);
}
