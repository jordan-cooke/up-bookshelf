import { cleanIsbn, classifyIsbn } from "./isbn.js";

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

function googleCoverCandidates(imageLinks = {}) {
  return unique([
    imageLinks.extraLarge,
    imageLinks.large,
    imageLinks.medium,
    imageLinks.small,
    imageLinks.thumbnail,
    imageLinks.smallThumbnail,
  ].map(cleanGoogleCoverUrl));
}

function googlePreferredCoverCandidates(imageLinks = {}) {
  return unique([imageLinks.extraLarge, imageLinks.large, imageLinks.medium].map(cleanGoogleCoverUrl));
}

function openLibraryCoverCandidates(book = {}, edition = {}, work = {}) {
  const coverIds = unique([...(edition.covers || []), ...(work.covers || [])]);
  return unique([
    ...coverIds.map((coverId) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`),
    book.cover?.large,
    book.cover?.medium,
    book.cover?.small,
  ].map(httpsUrl));
}

function providerResult(id, name, configured, book = null, error = "") {
  return { id, name, configured, available: Boolean(book), book, error };
}

export function normalizeGoogleBook(payload, requestedIsbn) {
  const requested = cleanIsbn(requestedIsbn);
  const matchingItem = payload?.items?.find((item) => (
    (item.volumeInfo?.industryIdentifiers || []).some((identifier) => cleanIsbn(identifier.identifier) === requested)
  ));
  const volume = (matchingItem || payload?.items?.[0])?.volumeInfo;
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

export function mergeBookMetadata(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const scalarFields = ["title", "subtitle", "isbn13", "isbn10", "publisher", "publishedDate", "description", "pageCount", "language"];
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

async function lookupGoogleBooks(isbn, apiKey) {
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

function amazonCredentials(options = {}) {
  const credentials = {
    clientId: String(options.amazonClientId ?? process.env.AMAZON_CREATORS_CLIENT_ID ?? "").trim(),
    clientSecret: String(options.amazonClientSecret ?? process.env.AMAZON_CREATORS_CLIENT_SECRET ?? "").trim(),
    credentialVersion: String(options.amazonCredentialVersion ?? process.env.AMAZON_CREATORS_CREDENTIAL_VERSION ?? "3.1").trim(),
    partnerTag: String(options.amazonPartnerTag ?? process.env.AMAZON_ASSOCIATE_TAG ?? "").trim(),
    marketplace: String(options.amazonMarketplace ?? process.env.AMAZON_MARKETPLACE ?? "www.amazon.com").trim(),
  };
  return Object.values(credentials).every(Boolean) ? credentials : null;
}

export async function lookupBookMetadata(isbn, options = {}) {
  const googleKey = String(options.googleBooksApiKey ?? process.env.GOOGLE_BOOKS_API_KEY ?? "").trim();
  const amazon = amazonCredentials(options);
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
      name: "Amazon",
      configured: Boolean(amazon),
      promise: amazon ? lookupAmazon(isbn, amazon) : Promise.resolve(null),
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
    const coverOrder = ["amazon", "openlibrary", "google"];
    const coverCandidates = unique(coverOrder.flatMap((id) => {
      const book = providers.find((provider) => provider.id === id)?.book;
      return [...(book?.preferredCoverCandidates || []), ...(book?.coverCandidates || [])];
    }));
    merged.coverCandidates = coverCandidates;
    merged.coverUrl = coverCandidates[0] || merged.coverUrl || null;
  }
  return { merged: merged?.title ? merged : null, providers };
}

export async function lookupBookByIsbn(isbn, options = {}) {
  return (await lookupBookMetadata(isbn, options)).merged;
}
