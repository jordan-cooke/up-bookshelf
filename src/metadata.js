import { cleanIsbn, classifyIsbn } from "./isbn.js";

function httpsUrl(value) {
  if (!value) return null;
  return String(value).replace(/^http:\/\//i, "https://");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function descriptionText(value) {
  const text = typeof value === "object" && value ? value.value : value;
  if (!text) return "";
  return String(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function googleCoverCandidates(imageLinks = {}) {
  return unique([
    imageLinks.extraLarge,
    imageLinks.large,
    imageLinks.medium,
    imageLinks.small,
    imageLinks.thumbnail,
    imageLinks.smallThumbnail,
  ].map(httpsUrl));
}

function googlePreferredCoverCandidates(imageLinks = {}) {
  return unique([imageLinks.extraLarge, imageLinks.large].map(httpsUrl));
}

function openLibraryCoverCandidates(book = {}, edition = {}, work = {}) {
  const coverIds = unique([...(edition.covers || []), ...(work.covers || [])]);
  return unique([
    ...coverIds.map((coverId) => `https://covers.openlibrary.org/b/id/${coverId}.jpg?default=false`),
    book.cover?.large,
    book.cover?.medium,
    book.cover?.small,
    ...coverIds.map((coverId) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`),
  ].map(httpsUrl));
}

export function normalizeGoogleBook(payload, requestedIsbn) {
  const volume = payload?.items?.[0]?.volumeInfo;
  if (!volume) return null;

  const identifiers = volume.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10")?.identifier;
  const coverCandidates = googleCoverCandidates(volume.imageLinks);
  const preferredCoverCandidates = googlePreferredCoverCandidates(volume.imageLinks);

  return {
    title: volume.title || "",
    subtitle: volume.subtitle || "",
    authors: volume.authors || [],
    isbn13: cleanIsbn(isbn13 || classifyIsbn(requestedIsbn)?.isbn13 || "") || null,
    isbn10: cleanIsbn(isbn10 || "") || null,
    publisher: volume.publisher || "",
    publishedDate: volume.publishedDate || "",
    description: descriptionText(volume.description),
    pageCount: Number.isInteger(volume.pageCount) ? volume.pageCount : null,
    categories: volume.categories || [],
    coverUrl: coverCandidates[0] || null,
    coverCandidates,
    preferredCoverCandidates,
    language: volume.language || "",
    metadataSource: "Google Books",
  };
}

export function normalizeOpenLibraryBook(payload, requestedIsbn, edition = {}, work = {}) {
  const key = `ISBN:${cleanIsbn(requestedIsbn)}`;
  const book = payload?.[key] || Object.values(payload || {})[0];
  if (!book && !edition?.title && !work?.title) return null;

  const classified = classifyIsbn(requestedIsbn);
  const coverCandidates = openLibraryCoverCandidates(book, edition, work);
  const preferredCoverCandidates = unique((edition.covers || []).map(
    (coverId) => `https://covers.openlibrary.org/b/id/${coverId}.jpg?default=false`,
  ));
  const languageKey = edition.languages?.[0]?.key || "";
  const subjects = book?.subjects?.map((subject) => subject.name).filter(Boolean)
    || work.subjects?.filter((subject) => typeof subject === "string")
    || [];

  return {
    title: book?.title || edition.title || work.title || "",
    subtitle: book?.subtitle || edition.subtitle || work.subtitle || "",
    authors: (book?.authors || []).map((author) => author.name).filter(Boolean),
    isbn13: cleanIsbn(edition.isbn_13?.[0] || classified?.isbn13 || "") || null,
    isbn10: cleanIsbn(edition.isbn_10?.[0] || classified?.isbn10 || "") || null,
    publisher: book?.publishers?.[0]?.name || edition.publishers?.[0] || "",
    publishedDate: book?.publish_date || edition.publish_date || "",
    description: descriptionText(edition.description) || descriptionText(work.description),
    pageCount: Number.isInteger(book?.number_of_pages)
      ? book.number_of_pages
      : (Number.isInteger(edition.number_of_pages) ? edition.number_of_pages : null),
    categories: subjects.slice(0, 8),
    coverUrl: coverCandidates[0] || null,
    coverCandidates,
    preferredCoverCandidates,
    language: languageKey.split("/").pop() || "",
    metadataSource: "Open Library",
  };
}

export function mergeBookMetadata(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const scalarFields = ["title", "subtitle", "isbn13", "isbn10", "publisher", "publishedDate", "description", "pageCount", "language"];
  const merged = { ...fallback, ...primary };
  for (const field of scalarFields) merged[field] = primary[field] || fallback[field] || (field === "pageCount" ? null : "");
  merged.authors = primary.authors?.length ? primary.authors : fallback.authors || [];
  merged.categories = unique([...(primary.categories || []), ...(fallback.categories || [])]).slice(0, 8);
  merged.preferredCoverCandidates = unique([
    ...(primary.preferredCoverCandidates || []),
    ...(fallback.preferredCoverCandidates || []),
  ]);
  merged.coverCandidates = unique([
    ...merged.preferredCoverCandidates,
    ...(primary.coverCandidates || []),
    ...(fallback.coverCandidates || []),
  ]);
  merged.coverUrl = merged.coverCandidates[0] || primary.coverUrl || fallback.coverUrl || null;
  merged.metadataSource = unique([primary.metadataSource, fallback.metadataSource]).join(" + ");
  return merged;
}

async function fetchJson(url, timeoutMs = 8000) {
  const response = await fetch(url, {
    headers: { "User-Agent": "JnCBookshelf/1.4" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Metadata provider returned ${response.status}`);
  return response.json();
}

async function lookupGoogleBooks(isbn, apiKey) {
  if (!apiKey) return null;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("projection", "full");
  url.searchParams.set("key", apiKey);
  return normalizeGoogleBook(await fetchJson(url), isbn);
}

async function lookupOpenLibrary(isbn) {
  const summaryUrl = new URL("https://openlibrary.org/api/books");
  summaryUrl.searchParams.set("bibkeys", `ISBN:${isbn}`);
  summaryUrl.searchParams.set("jscmd", "data");
  summaryUrl.searchParams.set("format", "json");

  const editionUrl = new URL(`https://openlibrary.org/isbn/${isbn}.json`);
  const [summaryResult, editionResult] = await Promise.allSettled([fetchJson(summaryUrl), fetchJson(editionUrl)]);
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
  const edition = editionResult.status === "fulfilled" ? editionResult.value : {};

  let work = {};
  const workKey = edition.works?.[0]?.key;
  if (workKey && /^\/works\/OL\d+W$/.test(workKey)) {
    try {
      work = await fetchJson(new URL(`${workKey}.json`, "https://openlibrary.org"));
    } catch (error) {
      console.warn("Open Library work lookup failed:", error.message);
    }
  }

  return normalizeOpenLibraryBook(summary, isbn, edition, work);
}

export async function lookupBookByIsbn(isbn, options = {}) {
  const apiKey = String(options.googleBooksApiKey ?? process.env.GOOGLE_BOOKS_API_KEY ?? "").trim();
  const googlePromise = apiKey
    ? lookupGoogleBooks(isbn, apiKey).catch((error) => {
      console.warn("Google Books lookup failed:", error.message);
      return null;
    })
    : Promise.resolve(null);
  const openLibraryPromise = lookupOpenLibrary(isbn).catch((error) => {
    console.warn("Open Library lookup failed:", error.message);
    return null;
  });

  const [google, openLibrary] = await Promise.all([googlePromise, openLibraryPromise]);
  const result = mergeBookMetadata(google, openLibrary);
  return result?.title ? result : null;
}
