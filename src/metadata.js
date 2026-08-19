import { cleanIsbn, classifyIsbn } from "./isbn.js";

function httpsUrl(value) {
  if (!value) return null;
  return String(value).replace(/^http:\/\//i, "https://");
}

export function normalizeGoogleBook(payload, requestedIsbn) {
  const volume = payload?.items?.[0]?.volumeInfo;
  if (!volume) return null;

  const identifiers = volume.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10")?.identifier;

  return {
    title: volume.title || "",
    subtitle: volume.subtitle || "",
    authors: volume.authors || [],
    isbn13: cleanIsbn(isbn13 || classifyIsbn(requestedIsbn)?.isbn13 || "") || null,
    isbn10: cleanIsbn(isbn10 || "") || null,
    publisher: volume.publisher || "",
    publishedDate: volume.publishedDate || "",
    description: volume.description || "",
    pageCount: Number.isInteger(volume.pageCount) ? volume.pageCount : null,
    categories: volume.categories || [],
    coverUrl: httpsUrl(volume.imageLinks?.thumbnail || volume.imageLinks?.smallThumbnail),
    language: volume.language || "",
    metadataSource: "Google Books",
  };
}

export function normalizeOpenLibraryBook(payload, requestedIsbn) {
  const key = `ISBN:${cleanIsbn(requestedIsbn)}`;
  const book = payload?.[key] || Object.values(payload || {})[0];
  if (!book) return null;

  const classified = classifyIsbn(requestedIsbn);
  return {
    title: book.title || "",
    subtitle: book.subtitle || "",
    authors: (book.authors || []).map((author) => author.name).filter(Boolean),
    isbn13: classified?.isbn13 || null,
    isbn10: classified?.isbn10 || null,
    publisher: book.publishers?.[0]?.name || "",
    publishedDate: book.publish_date || "",
    description: "",
    pageCount: Number.isInteger(book.number_of_pages) ? book.number_of_pages : null,
    categories: (book.subjects || []).slice(0, 8).map((subject) => subject.name).filter(Boolean),
    coverUrl: httpsUrl(book.cover?.large || book.cover?.medium || book.cover?.small),
    language: "",
    metadataSource: "Open Library",
  };
}

async function fetchJson(url, timeoutMs = 8000) {
  const response = await fetch(url, {
    headers: { "User-Agent": "HearthsideBookshelf/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Metadata provider returned ${response.status}`);
  return response.json();
}

export async function lookupBookByIsbn(isbn) {
  const googleUrl = new URL("https://www.googleapis.com/books/v1/volumes");
  googleUrl.searchParams.set("q", `isbn:${isbn}`);
  googleUrl.searchParams.set("maxResults", "1");

  try {
    const result = normalizeGoogleBook(await fetchJson(googleUrl), isbn);
    if (result?.title) return result;
  } catch (error) {
    console.warn("Google Books lookup failed:", error.message);
  }

  const openLibraryUrl = new URL("https://openlibrary.org/api/books");
  openLibraryUrl.searchParams.set("bibkeys", `ISBN:${isbn}`);
  openLibraryUrl.searchParams.set("jscmd", "data");
  openLibraryUrl.searchParams.set("format", "json");

  try {
    const result = normalizeOpenLibraryBook(await fetchJson(openLibraryUrl), isbn);
    if (result?.title) return result;
  } catch (error) {
    console.warn("Open Library lookup failed:", error.message);
  }

  return null;
}
