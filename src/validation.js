import { cleanIsbn, isValidIsbn10, isValidIsbn13, toIsbn13 } from "./isbn.js";

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

const STATUSES = new Set(["unread", "reading", "read", "dnf"]);

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 20) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((item) => cleanText(item, 200)).filter(Boolean))].slice(0, maxItems);
}

function cleanUrl(value) {
  const candidate = cleanText(value, 2000);
  if (!candidate) return null;
  if (/^\/api\/covers\/(?:(?:97[89]\d{10}|\d{9}[\dX])|custom-[a-f0-9-]{36})\.(?:jpg|png|webp|avif)$/i.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new ValidationError("Cover URL must be a Bookshelf cover or a valid http or https address.");
  }
}

export function validateBook(input = {}) {
  const title = cleanText(input.title, 500);
  if (!title) throw new ValidationError("Title is required.");

  let isbn10 = cleanIsbn(input.isbn10);
  let isbn13 = cleanIsbn(input.isbn13);
  if (isbn10 && !isValidIsbn10(isbn10)) throw new ValidationError("ISBN-10 is not valid.");
  if (isbn13 && !isValidIsbn13(isbn13)) throw new ValidationError("ISBN-13 is not valid.");
  if (!isbn13 && isbn10) isbn13 = toIsbn13(isbn10);

  const ratingValue = input.rating === "" || input.rating == null ? null : Number(input.rating);
  if (ratingValue != null && (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5)) {
    throw new ValidationError("Rating must be between 1 and 5.");
  }

  const bookRating = input.bookRating === "" || input.bookRating == null ? null : Number(input.bookRating);
  if (bookRating != null && (!Number.isFinite(bookRating) || bookRating < 1 || bookRating > 5)) {
    throw new ValidationError("Book rating must be between 1 and 5.");
  }
  const bookRatingsCount = input.bookRatingsCount === "" || input.bookRatingsCount == null
    ? null
    : Number(input.bookRatingsCount);
  if (bookRatingsCount != null && (!Number.isInteger(bookRatingsCount) || bookRatingsCount < 0)) {
    throw new ValidationError("Book rating count must be a positive whole number.");
  }

  const pageCount = input.pageCount === "" || input.pageCount == null ? null : Number(input.pageCount);
  if (pageCount != null && (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 100000)) {
    throw new ValidationError("Page count must be a positive whole number.");
  }

  const readingStatus = STATUSES.has(input.readingStatus) ? input.readingStatus : "unread";

  return {
    title,
    subtitle: cleanText(input.subtitle, 500),
    authors: cleanList(input.authors),
    authorSort: cleanList(input.authors)[0] || "",
    isbn10: isbn10 || null,
    isbn13: isbn13 || null,
    publisher: cleanText(input.publisher, 300),
    publishedDate: cleanText(input.publishedDate, 50),
    description: cleanText(input.description, 20000),
    pageCount,
    categories: cleanList(input.categories),
    coverUrl: cleanUrl(input.coverUrl),
    language: cleanText(input.language, 30),
    readingStatus,
    rating: ratingValue,
    bookRating,
    bookRatingsCount,
    bookRatingSource: cleanText(input.bookRatingSource, 100),
    notes: cleanText(input.notes, 20000),
    metadataSource: cleanText(input.metadataSource, 100),
  };
}
