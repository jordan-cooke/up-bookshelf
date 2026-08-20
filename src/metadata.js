import { cleanIsbn, classifyIsbn } from "./isbn.js";
import * as cheerio from "cheerio";

const AMAZON_TOKEN_ENDPOINTS = {
  "3.1": "https://api.amazon.com/auth/o2/token",
  "3.2": "https://api.amazon.co.uk/auth/o2/token",
  "3.3": "https://api.amazon.co.jp/auth/o2/token",
};
const AMAZON_RESOURCES = [
  "browseNodeInfo.browseNodes",
  "images.primary.large",
  "images.variants.large",
  "itemInfo.byLineInfo",
  "itemInfo.classifications",
  "itemInfo.contentInfo",
  "itemInfo.externalIds",
  "itemInfo.features",
  "itemInfo.productInfo",
  "itemInfo.title",
];
let amazonTokenCache = null;
const AMAZON_MARKETPLACES = new Set([
  "www.amazon.com", "www.amazon.ca", "www.amazon.com.mx", "www.amazon.com.br", "www.amazon.co.uk",
  "www.amazon.de", "www.amazon.fr", "www.amazon.it", "www.amazon.es", "www.amazon.nl", "www.amazon.se",
  "www.amazon.pl", "www.amazon.com.be", "www.amazon.co.jp", "www.amazon.in", "www.amazon.com.au",
  "www.amazon.sg", "www.amazon.ae", "www.amazon.sa", "www.amazon.com.tr",
]);

export function isSupportedAmazonMarketplace(value) {
  return AMAZON_MARKETPLACES.has(String(value || "").trim().toLowerCase());
}

function httpsUrl(value) {
  if (!value) return null;
  return String(value).replace(/^http:\/\//i, "https://");
}

function cleanGoogleCoverUrl(value) {
  const secure = httpsUrl(value);
  if (!secure) return null;
  try {
    const url = new URL(secure);
    // Google sometimes adds a photographed page curl and white border to its
    // API thumbnail. Removing this returns the straight front cover.
    url.searchParams.delete("edge");
    return url.toString();
  } catch {
    return secure;
  }
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

function bestGoogleCover(imageLinks = {}) {
  return unique([
    imageLinks.extraLarge,
    imageLinks.large,
    imageLinks.medium,
    imageLinks.small,
    imageLinks.thumbnail,
    imageLinks.smallThumbnail,
  ].map(cleanGoogleCoverUrl))[0] || null;
}

function googlePreferredCoverCandidates(imageLinks = {}) {
  return unique([imageLinks.extraLarge, imageLinks.large, imageLinks.medium].map(cleanGoogleCoverUrl));
}

function openLibraryCoverCandidates(book = {}, edition = {}, work = {}) {
  const coverIds = unique([...(edition.covers || []), ...(work.covers || [])]);
  const summaryCover = book.cover?.large || book.cover?.medium || book.cover?.small;
  return unique([
    ...coverIds.map((coverId) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`),
    summaryCover,
  ].map(httpsUrl));
}

function providerResult(id, name, configured, book = null, error = "") {
  return { id, name, configured, available: Boolean(book), book, error };
}

export function normalizeGoogleBook(payload, requestedIsbn) {
  const requested = cleanIsbn(requestedIsbn);
  const matchingItems = (payload?.items || []).filter((item) => (
    (item.volumeInfo?.industryIdentifiers || []).some((identifier) => cleanIsbn(identifier.identifier) === requested)
  ));
  const matchingItem = matchingItems[0];
  const volume = (matchingItem || payload?.items?.[0])?.volumeInfo;
  if (!volume) return null;

  const identifiers = volume.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10")?.identifier;
  const candidateItems = matchingItems.length ? matchingItems : (payload?.items || []).slice(0, 1);
  const coverCandidates = unique(candidateItems.map((item) => bestGoogleCover(item.volumeInfo?.imageLinks)));
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
    bookRating: Number.isFinite(volume.averageRating) ? volume.averageRating : null,
    bookRatingsCount: Number.isInteger(volume.ratingsCount) ? volume.ratingsCount : null,
    bookRatingSource: Number.isFinite(volume.averageRating) ? "Google Books" : "",
    metadataSource: "Google Books",
  };
}

function normalizeGoogleSearchItem(item) {
  const volume = item?.volumeInfo;
  if (!volume?.title) return null;
  const identifiers = volume.industryIdentifiers || [];
  const isbn13 = cleanIsbn(identifiers.find((identifier) => identifier.type === "ISBN_13")?.identifier || "") || null;
  const isbn10 = cleanIsbn(identifiers.find((identifier) => identifier.type === "ISBN_10")?.identifier || "") || null;
  const coverUrl = bestGoogleCover(volume.imageLinks);
  return {
    title: volume.title,
    subtitle: volume.subtitle || "",
    authors: volume.authors || [],
    isbn13,
    isbn10,
    publisher: volume.publisher || "",
    publishedDate: volume.publishedDate || "",
    description: descriptionText(volume.description),
    pageCount: Number.isInteger(volume.pageCount) ? volume.pageCount : null,
    categories: volume.categories || [],
    coverUrl,
    coverCandidates: coverUrl ? [coverUrl] : [],
    preferredCoverCandidates: coverUrl ? [coverUrl] : [],
    language: volume.language || "",
    bookRating: Number.isFinite(volume.averageRating) ? volume.averageRating : null,
    bookRatingsCount: Number.isInteger(volume.ratingsCount) ? volume.ratingsCount : null,
    bookRatingSource: Number.isFinite(volume.averageRating) ? "Google Books" : "",
    metadataSource: "Google Books",
    providerUrl: httpsUrl(volume.infoLink),
  };
}

export function normalizeGoogleSearchResults(payload) {
  return (payload?.items || []).map(normalizeGoogleSearchItem).filter(Boolean);
}

export function normalizeOpenLibraryBook(payload, requestedIsbn, edition = {}, work = {}) {
  const key = `ISBN:${cleanIsbn(requestedIsbn)}`;
  const book = payload?.[key] || Object.values(payload || {})[0];
  if (!book && !edition?.title && !work?.title) return null;

  const classified = classifyIsbn(requestedIsbn);
  const coverCandidates = openLibraryCoverCandidates(book, edition, work);
  const preferredCoverCandidates = unique((edition.covers || []).map(
    (coverId) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`,
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
    categories: subjects.slice(0, 12),
    coverUrl: coverCandidates[0] || null,
    coverCandidates,
    preferredCoverCandidates,
    language: languageKey.split("/").pop() || "",
    metadataSource: "Open Library",
  };
}

export function normalizeOpenLibrarySearchResults(payload) {
  return (payload?.docs || []).map((document) => {
    const identifiers = document.isbn || [];
    const isbn13 = cleanIsbn(identifiers.find((isbn) => /^(978|979)\d{10}$/.test(cleanIsbn(isbn))) || "") || null;
    const isbn10 = cleanIsbn(identifiers.find((isbn) => /^\d{9}[\dX]$/.test(cleanIsbn(isbn))) || "") || null;
    const coverUrl = Number.isInteger(document.cover_i)
      ? `https://covers.openlibrary.org/b/id/${document.cover_i}-L.jpg?default=false`
      : null;
    const firstSentence = Array.isArray(document.first_sentence) ? document.first_sentence[0] : document.first_sentence;
    return {
      title: document.title || "",
      subtitle: document.subtitle || "",
      authors: document.author_name || [],
      isbn13,
      isbn10,
      publisher: document.publisher?.[0] || "",
      publishedDate: String(document.first_publish_year || document.publish_date?.[0] || ""),
      description: descriptionText(firstSentence),
      pageCount: Number.isInteger(document.number_of_pages_median) ? document.number_of_pages_median : null,
      categories: (document.subject || []).slice(0, 12),
      coverUrl,
      coverCandidates: coverUrl ? [coverUrl] : [],
      preferredCoverCandidates: coverUrl ? [coverUrl] : [],
      language: document.language?.[0] || "",
      bookRating: Number.isFinite(document.ratings_average) ? document.ratings_average : null,
      bookRatingsCount: Number.isInteger(document.ratings_count) ? document.ratings_count : null,
      bookRatingSource: Number.isFinite(document.ratings_average) ? "Open Library" : "",
      metadataSource: "Open Library",
      providerUrl: document.key ? new URL(document.key, "https://openlibrary.org").toString() : "",
    };
  }).filter((book) => book.title);
}

function amazonDisplayValue(value) {
  return value?.displayValue ?? "";
}

function amazonImageCandidates(images = {}) {
  return unique([
    images.primary?.large?.url,
    ...(images.variants || []).map((variant) => variant.large?.url),
  ].map(httpsUrl));
}

function itemMatchesIsbn(item, requestedIsbn) {
  const ids = item?.itemInfo?.externalIds || {};
  return cleanIsbn(item?.asin) === cleanIsbn(requestedIsbn) || [...(ids.eans?.displayValues || []), ...(ids.isbns?.displayValues || [])]
    .map(cleanIsbn)
    .includes(cleanIsbn(requestedIsbn));
}

export function normalizeAmazonBook(payload, requestedIsbn) {
  const items = payload?.searchResult?.items || payload?.itemsResult?.items || [];
  const item = items.find((candidate) => itemMatchesIsbn(candidate, requestedIsbn));
  if (!item) return null;

  const info = item.itemInfo || {};
  const classified = classifyIsbn(requestedIsbn);
  const eans = info.externalIds?.eans?.displayValues || [];
  const isbns = info.externalIds?.isbns?.displayValues || [];
  const contributors = (info.byLineInfo?.contributors || [])
    .filter((person) => !person.roleType || person.roleType.toLowerCase() === "author")
    .map((person) => person.name)
    .filter(Boolean);
  const coverCandidates = amazonImageCandidates(item.images);
  const features = info.features?.displayValues || [];
  const language = info.contentInfo?.languages?.displayValues?.find((entry) => entry.type === "Published")
    || info.contentInfo?.languages?.displayValues?.[0];
  const browseNodes = item.browseNodeInfo?.browseNodes || [];

  return {
    title: amazonDisplayValue(info.title),
    subtitle: "",
    authors: contributors,
    isbn13: cleanIsbn(eans.find((value) => /^(978|979)/.test(cleanIsbn(value))) || classified?.isbn13 || "") || null,
    isbn10: cleanIsbn(isbns[0] || classified?.isbn10 || "") || null,
    publisher: amazonDisplayValue(info.byLineInfo?.manufacturer),
    publishedDate: amazonDisplayValue(info.contentInfo?.publicationDate)
      || amazonDisplayValue(info.productInfo?.releaseDate),
    description: descriptionText(features.join("\n\n")),
    pageCount: Number.isInteger(amazonDisplayValue(info.contentInfo?.pagesCount))
      ? amazonDisplayValue(info.contentInfo?.pagesCount)
      : null,
    categories: unique(browseNodes.map((node) => node.contextFreeName || node.displayName)).slice(0, 12),
    coverUrl: coverCandidates[0] || null,
    coverCandidates,
    preferredCoverCandidates: coverCandidates,
    language: language?.displayValue || "",
    metadataSource: "Amazon",
    providerUrl: item.detailPageURL || "",
  };
}

export function normalizeAmazonSearchResults(payload) {
  const items = payload?.searchResult?.items || payload?.itemsResult?.items || [];
  return items.map((item) => normalizeAmazonBook({ searchResult: { items: [item] } }, item.asin || "")).filter(Boolean);
}

export function mergeBookMetadata(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const scalarFields = [
    "title", "subtitle", "isbn13", "isbn10", "publisher", "publishedDate", "description", "pageCount", "language",
    "bookRating", "bookRatingsCount", "bookRatingSource",
  ];
  const merged = { ...fallback, ...primary };
  for (const field of scalarFields) merged[field] = primary[field] || fallback[field] || (field === "pageCount" ? null : "");
  merged.authors = primary.authors?.length ? primary.authors : fallback.authors || [];
  merged.categories = unique([...(primary.categories || []), ...(fallback.categories || [])]).slice(0, 12);
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

function mergeProviderBooks(books) {
  return books.filter(Boolean).reduce((merged, book) => mergeBookMetadata(merged, book), null);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": "UPBookshelf/2.0", ...options.headers },
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 8000),
  });
  if (!response.ok) throw new Error(`Metadata provider returned ${response.status}`);
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36", ...options.headers },
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 10000),
  });
  if (!response.ok) throw new Error(`Metadata provider returned ${response.status}`);
  return response.text();
}

async function lookupGoogleBooks(isbn, apiKey) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("projection", "full");
  url.searchParams.set("key", apiKey);
  return normalizeGoogleBook(await fetchJson(url), isbn);
}

function searchTerms(query) {
  const phrase = (value) => String(value).replaceAll('"', "").trim();
  const descriptive = [
    query.title ? `intitle:"${phrase(query.title)}"` : "",
    query.author ? `inauthor:"${phrase(query.author)}"` : "",
  ].filter(Boolean).join(" ");
  return descriptive || `isbn:${query.isbn}`;
}

async function searchGoogleBooks(query, apiKey) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", searchTerms(query));
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("projection", "full");
  url.searchParams.set("printType", "books");
  url.searchParams.set("key", apiKey);
  return normalizeGoogleSearchResults(await fetchJson(url));
}

async function searchOpenLibrary(query) {
  const url = new URL("https://openlibrary.org/search.json");
  if (query.title || query.author) {
    if (query.title) url.searchParams.set("title", query.title);
    if (query.author) url.searchParams.set("author", query.author);
  } else if (query.isbn) url.searchParams.set("isbn", query.isbn);
  url.searchParams.set("limit", "10");
  url.searchParams.set("fields", [
    "key", "title", "subtitle", "author_name", "isbn", "publisher", "first_publish_year", "publish_date",
    "number_of_pages_median", "language", "subject", "cover_i", "ratings_average", "ratings_count", "first_sentence",
  ].join(","));
  return normalizeOpenLibrarySearchResults(await fetchJson(url));
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

async function amazonAccessToken(credentials) {
  const now = Date.now();
  const cacheKey = `${credentials.clientId}:${credentials.credentialVersion}`;
  if (amazonTokenCache?.key === cacheKey && amazonTokenCache.expiresAt > now + 60000) return amazonTokenCache.token;

  const tokenEndpoint = AMAZON_TOKEN_ENDPOINTS[credentials.credentialVersion] || AMAZON_TOKEN_ENDPOINTS["3.1"];
  const payload = await fetchJson(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: "creatorsapi::default",
    }),
  });
  if (!payload.access_token) throw new Error("Amazon did not return an access token");
  amazonTokenCache = {
    key: cacheKey,
    token: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
  };
  return amazonTokenCache.token;
}

async function lookupAmazon(isbn, credentials) {
  const token = await amazonAccessToken(credentials);
  const payload = await fetchJson("https://creatorsapi.amazon/catalog/v1/searchItems", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": credentials.marketplace,
    },
    body: JSON.stringify({
      partnerTag: credentials.partnerTag,
      marketplace: credentials.marketplace,
      searchIndex: "Books",
      keywords: isbn,
      itemCount: 10,
      resources: AMAZON_RESOURCES,
    }),
    timeoutMs: 12000,
  });
  return normalizeAmazonBook(payload, isbn);
}

async function searchAmazon(query, credentials) {
  const token = await amazonAccessToken(credentials);
  const keywords = [query.title, query.author].filter(Boolean).join(" ") || query.isbn;
  const payload = await fetchJson("https://creatorsapi.amazon/catalog/v1/searchItems", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": credentials.marketplace,
    },
    body: JSON.stringify({
      partnerTag: credentials.partnerTag,
      marketplace: credentials.marketplace,
      searchIndex: "Books",
      keywords,
      itemCount: 10,
      resources: AMAZON_RESOURCES,
    }),
    timeoutMs: 12000,
  });
  return normalizeAmazonSearchResults(payload);
}

function amazonResultImage(element) {
  const sourceSet = element.attr("srcset") || "";
  const largest = sourceSet.split(",").map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
  return httpsUrl(largest || element.attr("data-src") || element.attr("src"));
}

function normalizeAmazonCookieSearchHtml(html, marketplace) {
  if (/validateCaptcha|Enter the characters you see below|Sorry, we just need to make sure you're not a robot/i.test(html)) {
    throw new Error("Amazon requested browser verification. Refresh the saved cookie and try again.");
  }
  const $ = cheerio.load(html);
  return $('[data-component-type="s-search-result"][data-asin]').map((_index, node) => {
    const result = $(node);
    const asin = String(result.attr("data-asin") || "").trim();
    const title = result.find("h2 span").first().text().trim()
      || result.find('[data-cy="title-recipe"] span').first().text().trim();
    if (!asin || !title) return null;
    const authorRow = result.find(".a-row.a-size-base.a-color-secondary").first().text().replace(/\s+/g, " ").trim();
    const authorsMatch = authorRow.match(/\bby\s+(.+?)(?:\s+\||\s+\(|$)/i);
    const authors = authorsMatch?.[1]?.split(/,\s*(?:and\s+)?|\s+and\s+/i).map((author) => author.trim()).filter(Boolean) || [];
    const image = amazonResultImage(result.find("img.s-image").first());
    const href = result.find('h2 a[href], a.a-link-normal[href*="/dp/"]').first().attr("href");
    const classified = classifyIsbn(asin);
    const date = authorRow.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i)?.[0] || "";
    return {
      title,
      subtitle: "",
      authors,
      isbn13: classified?.isbn13 || null,
      isbn10: classified?.isbn10 || null,
      publisher: "",
      publishedDate: date,
      description: "",
      pageCount: null,
      categories: [],
      coverUrl: image,
      coverCandidates: image ? [image] : [],
      preferredCoverCandidates: image ? [image] : [],
      language: "",
      metadataSource: "Amazon (cookie)",
      providerUrl: href ? new URL(href, `https://${marketplace}`).toString() : "",
    };
  }).get().filter(Boolean).slice(0, 10);
}

export function normalizeAmazonCookieSearchResults(html, marketplace = "www.amazon.com") {
  return normalizeAmazonCookieSearchHtml(String(html || ""), marketplace);
}

async function searchAmazonCookie(query, credentials) {
  const keywords = [query.title, query.author].filter(Boolean).join(" ") || query.isbn;
  const url = new URL(`https://${credentials.marketplace}/s`);
  url.searchParams.set("k", keywords);
  url.searchParams.set("i", "stripbooks");
  const html = await fetchText(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: credentials.cookie,
    },
    timeoutMs: 12000,
  });
  return normalizeAmazonCookieSearchHtml(html, credentials.marketplace);
}

async function lookupAmazonCookie(isbn, credentials) {
  const books = await searchAmazonCookie({ isbn, title: "", author: "" }, credentials);
  return books.find((book) => cleanIsbn(book.isbn13 || book.isbn10) === cleanIsbn(isbn)) || books[0] || null;
}

function amazonCredentials(options = {}) {
  const credentials = {
    clientId: String(options.amazonClientId ?? "").trim(),
    clientSecret: String(options.amazonClientSecret ?? "").trim(),
    credentialVersion: String(options.amazonCredentialVersion ?? "3.1").trim(),
    partnerTag: String(options.amazonPartnerTag ?? "").trim(),
    marketplace: String(options.amazonMarketplace ?? "www.amazon.com").trim(),
  };
  return Object.values(credentials).every(Boolean) ? credentials : null;
}

function amazonCookieCredentials(options = {}) {
  const cookie = String(options.amazonCookie ?? "").trim();
  const marketplace = String(options.amazonMarketplace ?? "www.amazon.com").trim().toLowerCase();
  return cookie && isSupportedAmazonMarketplace(marketplace) ? { cookie, marketplace } : null;
}

export async function lookupBookMetadata(isbn, options = {}) {
  const googleKey = String(options.googleBooksApiKey ?? "").trim();
  const amazon = amazonCredentials(options);
  const amazonCookie = amazonCookieCredentials(options);
  const jobs = [
    {
      id: "google",
      name: "Google Books",
      configured: Boolean(googleKey),
      promise: googleKey ? lookupGoogleBooks(isbn, googleKey) : Promise.resolve(null),
    },
    {
      id: "openlibrary",
      name: "Open Library",
      configured: true,
      promise: lookupOpenLibrary(isbn),
    },
    {
      id: "amazon",
      name: "Amazon Creators API",
      configured: Boolean(amazon),
      promise: amazon ? lookupAmazon(isbn, amazon) : Promise.resolve(null),
    },
    {
      id: "amazon-cookie",
      name: "Amazon (cookie)",
      configured: Boolean(amazonCookie),
      promise: amazonCookie ? lookupAmazonCookie(isbn, amazonCookie) : Promise.resolve(null),
    },
  ];

  const providers = await Promise.all(jobs.map(async (job) => {
    if (!job.configured) return providerResult(job.id, job.name, false);
    try {
      return providerResult(job.id, job.name, true, await job.promise);
    } catch (error) {
      console.warn(`${job.name} lookup failed:`, error.message);
      return providerResult(job.id, job.name, true, null, "Provider lookup failed");
    }
  }));
  const merged = mergeProviderBooks(providers.map((provider) => provider.book));
  if (merged) {
    // Google and Open Library usually provide a straight front cover. Amazon
    // variants remain available in the picker but do not become the default.
    const coverOrder = ["google", "openlibrary", "amazon", "amazon-cookie"];
    const coverCandidates = unique(coverOrder.flatMap((id) => {
      const book = providers.find((provider) => provider.id === id)?.book;
      return [...(book?.preferredCoverCandidates || []), ...(book?.coverCandidates || [])];
    }));
    merged.coverCandidates = coverCandidates;
    merged.coverUrl = coverCandidates[0] || merged.coverUrl || null;
  }
  return { merged: merged?.title ? merged : null, providers };
}

export async function searchBookMetadata(query = {}, options = {}) {
  const normalized = {
    isbn: cleanIsbn(query.isbn),
    title: String(query.title || "").trim(),
    author: String(query.author || "").trim(),
  };
  const googleKey = String(options.googleBooksApiKey ?? "").trim();
  const amazon = amazonCredentials(options);
  const amazonCookie = amazonCookieCredentials(options);
  const jobs = [
    { id: "google", name: "Google Books", configured: Boolean(googleKey), promise: googleKey ? searchGoogleBooks(normalized, googleKey) : Promise.resolve([]) },
    { id: "openlibrary", name: "Open Library", configured: true, promise: searchOpenLibrary(normalized) },
    { id: "amazon", name: "Amazon Creators API", configured: Boolean(amazon), promise: amazon ? searchAmazon(normalized, amazon) : Promise.resolve([]) },
    { id: "amazon-cookie", name: "Amazon (cookie)", configured: Boolean(amazonCookie), promise: amazonCookie ? searchAmazonCookie(normalized, amazonCookie) : Promise.resolve([]) },
  ];
  const providers = await Promise.all(jobs.map(async (job) => {
    if (!job.configured) return { id: job.id, name: job.name, configured: false, available: false, count: 0, error: "" };
    try {
      const books = await job.promise;
      return { id: job.id, name: job.name, configured: true, available: books.length > 0, count: books.length, books, error: "" };
    } catch (error) {
      console.warn(`${job.name} search failed:`, error.message);
      return { id: job.id, name: job.name, configured: true, available: false, count: 0, books: [], error: "Provider search failed" };
    }
  }));
  const seen = new Set();
  const results = providers.flatMap((provider) => (provider.books || []).map((book, index) => ({
    id: `${provider.id}-${index}`,
    providerId: provider.id,
    providerName: provider.name,
    book,
  }))).filter((result) => {
    const key = `${result.providerId}:${result.book.isbn13 || result.book.isbn10 || ""}:${result.book.title}:${result.book.coverUrl || ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    providers: providers.map(({ books: _books, ...provider }) => provider),
    results,
  };
}

export async function lookupBookByIsbn(isbn, options = {}) {
  return (await lookupBookMetadata(isbn, options)).merged;
}
