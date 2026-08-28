import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "./isbn.js";
import { checkAmazonCookie, isSupportedAmazonMarketplace, lookupBookMetadata, searchBookMetadata } from "./metadata.js";
import { cacheBookCover, coverCacheState, fetchProviderCover, saveUploadedCover } from "./covers.js";
import { createBookshelfWorkbook } from "./excel.js";
import { recognizeIsbnImage } from "./ocr.js";
import {
  createBook,
  deleteAppSettings,
  deleteBook,
  exportBooks,
  findByIsbn,
  getAppSettings,
  getBook,
  libraryStats,
  listBooks,
  listCollections,
  saveAppSettings,
  updateBook,
  updateBookCover,
} from "./repository.js";
import { validateBook, validateCoverUrl, ValidationError } from "./validation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_VERSION = "2.5.0";
export const DEFAULT_TAGLINE = "Every good story,\nright where you left it.";
const REQUIRED_ASSETS = ["index.html", "styles.css", "app.js", "icon.svg", "manifest.webmanifest"];

function numericId(request, response, next) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid book id." });
  request.bookId = id;
  return next();
}

export function bookshelfIdentity(value) {
  const configured = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  const brandName = (configured || "UP").replace(/\s+Bookshelf$/i, "") || "UP";
  return { brandName, appName: `${brandName} Bookshelf` };
}

function normalizeLookupResult(result) {
  if (result && Object.hasOwn(result, "merged")) return { book: result.merged, providers: result.providers || [] };
  return { book: result, providers: [] };
}

const AMAZON_CREATORS_SETTING_KEYS = [
  "amazon_client_id",
  "amazon_client_secret",
  "amazon_credential_version",
  "amazon_associate_tag",
];

function providerConfiguration(saved) {
  const amazonFields = {
    clientId: Boolean(saved.amazon_client_id),
    clientSecret: Boolean(saved.amazon_client_secret),
    associateTag: Boolean(saved.amazon_associate_tag),
  };
  return {
    openlibrary: { name: "Open Library", configured: true, requiresKey: false },
    google: { name: "Google Books", configured: Boolean(saved.google_books_api_key), requiresKey: true },
    amazon: {
      name: "Amazon Creators API",
      configured: Object.values(amazonFields).every(Boolean),
      requiresKey: true,
      savedFields: amazonFields,
      credentialVersion: saved.amazon_credential_version || "3.1",
      marketplace: saved.amazon_marketplace || "www.amazon.com",
    },
    amazonCookie: {
      name: "Amazon session cookie",
      configured: Boolean(saved.amazon_cookie),
      requiresKey: true,
      marketplace: saved.amazon_marketplace || "www.amazon.com",
    },
  };
}

function providerLookupOptions(saved) {
  return {
    googleBooksApiKey: saved.google_books_api_key || "",
    amazonClientId: saved.amazon_client_id || "",
    amazonClientSecret: saved.amazon_client_secret || "",
    amazonCredentialVersion: saved.amazon_credential_version || "3.1",
    amazonPartnerTag: saved.amazon_associate_tag || "",
    amazonMarketplace: saved.amazon_marketplace || "www.amazon.com",
    amazonCookie: saved.amazon_cookie || "",
  };
}

export function createApp({
  database,
  lookup = lookupBookMetadata,
  searchMetadata = searchBookMetadata,
  testAmazonCookie = checkAmazonCookie,
  loadProviderCover = fetchProviderCover,
  recognizePrintedIsbn = recognizeIsbnImage,
  trustProxy = false,
  coverDirectory = null,
  databasePath = null,
}) {
  const app = express();
  const currentConfig = () => {
    const saved = getAppSettings(database);
    const identity = bookshelfIdentity(saved.name || "");
    const storedTagline = Object.hasOwn(saved, "tagline") ? saved.tagline : DEFAULT_TAGLINE;
    const taglineEnabled = Object.hasOwn(saved, "tagline_enabled")
      ? saved.tagline_enabled !== "0"
      : storedTagline !== "";
    return {
      ...identity,
      customName: saved.name || "",
      tagline: taglineEnabled ? storedTagline : "",
      taglineText: storedTagline || DEFAULT_TAGLINE,
      taglineEnabled,
      defaultAppName: "UP Bookshelf",
      providers: providerConfiguration(saved),
    };
  };
  const performLookup = (isbn) => lookup(isbn, providerLookupOptions(getAppSettings(database)));
  const performSearch = (query) => searchMetadata(query, providerLookupOptions(getAppSettings(database)));
  if (trustProxy) app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set("X-UP-Bookshelf-Version", APP_VERSION);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "worker-src": ["'self'", "blob:"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/scan/isbn-text", express.raw({ type: "image/*", limit: "10mb" }), async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return response.status(400).json({ error: "Send a JPEG, PNG, or WebP photo of the printed ISBN." });
      }
      const isbn = cleanIsbn(await recognizePrintedIsbn(request.body));
      if (!isValidIsbn10(isbn) && !isValidIsbn13(isbn)) {
        return response.status(422).json({ error: "No valid printed ISBN was found in that photo." });
      }
      return response.json({ isbn, method: "printed-isbn" });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/health", async (_request, response, next) => {
    try {
      database.prepare("SELECT 1").get();
      const missingAssets = REQUIRED_ASSETS.filter((file) => !fs.existsSync(path.join(ROOT, "public", file)));
      if (missingAssets.length) return response.status(503).json({ status: "error", error: "App assets are missing.", missingAssets });
      response.json({ status: "ok", app: currentConfig().appName, version: APP_VERSION, storage: "sqlite", authentication: false });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config", (_request, response) => {
    response.json(currentConfig());
  });

  app.put("/api/settings", (request, response, next) => {
    try {
      const name = String(request.body?.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
      const tagline = String(request.body?.tagline ?? "").replace(/\r\n?/g, "\n").trim();
      const taglineEnabled = request.body?.taglineEnabled !== false;
      if (name.length > 40) return response.status(400).json({ error: "The bookshelf name must be 40 characters or fewer." });
      if (tagline.length > 240) return response.status(400).json({ error: "The welcome message must be 240 characters or fewer." });
      const updates = { name, tagline: tagline || DEFAULT_TAGLINE, tagline_enabled: taglineEnabled ? "1" : "0" };
      const keysToDelete = [];

      if (request.body?.removeGoogleBooksApiKey) keysToDelete.push("google_books_api_key");
      else {
        const googleKey = String(request.body?.googleBooksApiKey || "").trim();
        if (googleKey.length > 512) return response.status(400).json({ error: "The Google Books API key is too long." });
        if (googleKey) updates.google_books_api_key = googleKey;
      }

      if (request.body?.removeAmazonCreatorsCredentials || request.body?.removeAmazonCredentials) keysToDelete.push(...AMAZON_CREATORS_SETTING_KEYS);
      else {
        const amazonValues = {
          amazon_client_id: String(request.body?.amazonClientId || "").trim(),
          amazon_client_secret: String(request.body?.amazonClientSecret || "").trim(),
          amazon_associate_tag: String(request.body?.amazonAssociateTag || "").trim(),
        };
        if (Object.values(amazonValues).some((value) => value.length > 512)) {
          return response.status(400).json({ error: "An Amazon credential is too long." });
        }
        Object.assign(updates, Object.fromEntries(Object.entries(amazonValues).filter(([, value]) => value)));
        const credentialVersion = String(request.body?.amazonCredentialVersion || "3.1");
        if (!["3.1", "3.2", "3.3"].includes(credentialVersion)) return response.status(400).json({ error: "Choose a valid Amazon credential version." });
        updates.amazon_credential_version = credentialVersion;
      }

      const marketplace = String(request.body?.amazonMarketplace || "www.amazon.com").trim().toLowerCase();
      if (!isSupportedAmazonMarketplace(marketplace)) return response.status(400).json({ error: "Choose a supported Amazon marketplace." });
      updates.amazon_marketplace = marketplace;

      if (request.body?.removeAmazonCookie) keysToDelete.push("amazon_cookie");
      else {
        let amazonCookie = String(request.body?.amazonCookie || "").trim().replace(/^cookie:\s*/i, "");
        if (/^\d{3}-\d{7}-\d{7}$/.test(amazonCookie)) amazonCookie = `session-id=${amazonCookie}`;
        if (amazonCookie.length > 32768) return response.status(400).json({ error: "The Amazon cookie header is too long." });
        if (/[\r\n\u0000-\u001f\u007f]/.test(amazonCookie)) return response.status(400).json({ error: "The Amazon cookie header contains invalid characters." });
        if (amazonCookie && !amazonCookie.includes("=")) return response.status(400).json({ error: "Paste the full Cookie request header from Amazon." });
        if (amazonCookie) updates.amazon_cookie = amazonCookie;
      }

      if (keysToDelete.length) deleteAppSettings(database, keysToDelete);
      saveAppSettings(database, updates);
      return response.json(currentConfig());
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/providers/amazon-cookie/test", async (_request, response) => {
    const saved = getAppSettings(database);
    if (!saved.amazon_cookie) return response.status(400).json({ error: "Save an Amazon cookie before testing it." });
    try {
      const result = await testAmazonCookie(providerLookupOptions(saved));
      return response.json({ ok: true, count: Number(result?.count || 0), marketplace: saved.amazon_marketplace || "www.amazon.com" });
    } catch (error) {
      console.warn("Amazon cookie connection test failed:", error.message);
      return response.status(502).json({ error: `Amazon cookie test failed: ${error.message}` });
    }
  });

  app.get("/api/books", async (request, response, next) => {
    try {
      response.json(
        await listBooks(database, {
          search: request.query.q,
          status: request.query.status,
          sort: request.query.sort,
          order: request.query.order,
          collection: request.query.collection,
          limit: request.query.limit,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/books/:id", numericId, async (request, response, next) => {
    try {
      const book = await getBook(database, request.bookId);
      if (!book) return response.status(404).json({ error: "Book not found." });
      return response.json(book);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/books", async (request, response, next) => {
    try {
      const book = await createBook(database, validateBook(request.body));
      response.status(201).json(book);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/books/:id", numericId, async (request, response, next) => {
    try {
      const book = await updateBook(database, request.bookId, validateBook(request.body));
      if (!book) return response.status(404).json({ error: "Book not found." });
      return response.json(book);
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/books/:id/cover", numericId, async (request, response, next) => {
    try {
      const coverUrl = validateCoverUrl(request.body?.coverUrl);
      if (!coverUrl?.startsWith("/api/covers/custom-")) {
        return response.status(400).json({ error: "Upload a custom Bookshelf cover before saving it." });
      }
      const book = updateBookCover(database, request.bookId, coverUrl);
      if (!book) return response.status(404).json({ error: "Book not found." });
      return response.json(book);
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/books/:id", numericId, async (request, response, next) => {
    try {
      if (!(await deleteBook(database, request.bookId))) return response.status(404).json({ error: "Book not found." });
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/lookup/:isbn", async (request, response, next) => {
    try {
      const isbn = cleanIsbn(request.params.isbn);
      if (!isValidIsbn10(isbn) && !isValidIsbn13(isbn)) {
        return response.status(400).json({ error: "That barcode is not a valid ISBN-10 or ISBN-13." });
      }
      const existing = await findByIsbn(database, isbn);
      if (existing) return response.json({ existing, book: null });
      const metadata = normalizeLookupResult(await performLookup(isbn));
      const book = metadata.book;
      if (!book) return response.status(404).json({ error: "No book metadata was found. You can still add it manually.", isbn });
      const coverCandidates = book.coverCandidates?.length ? book.coverCandidates : [book.coverUrl].filter(Boolean);
      const cachedCover = await cacheBookCover({ isbn, candidates: coverCandidates, directory: coverDirectory });
      if (cachedCover) book.coverUrl = cachedCover;
      return response.json({ existing: null, book, providers: metadata.providers });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/metadata/:isbn", async (request, response, next) => {
    try {
      const isbn = cleanIsbn(request.params.isbn);
      if (!isValidIsbn10(isbn) && !isValidIsbn13(isbn)) {
        return response.status(400).json({ error: "That barcode is not a valid ISBN-10 or ISBN-13." });
      }
      const metadata = normalizeLookupResult(await performLookup(isbn));
      if (!metadata.book) return response.status(404).json({ error: "No provider has metadata for this ISBN.", isbn });
      return response.json(metadata);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/metadata-search", async (request, response, next) => {
    try {
      const isbn = cleanIsbn(request.query.isbn);
      const title = String(request.query.title || "").trim().slice(0, 500);
      const author = String(request.query.author || "").trim().slice(0, 300);
      if (isbn && !isValidIsbn10(isbn) && !isValidIsbn13(isbn)) {
        return response.status(400).json({ error: "Enter a valid ISBN or clear it to search by title and author." });
      }
      if (!isbn && !title && !author) return response.status(400).json({ error: "Enter an ISBN, title, or author to search providers." });
      return response.json(await performSearch({ isbn, title, author }));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/covers/cache", async (request, response, next) => {
    try {
      const isbn = cleanIsbn(request.body?.isbn);
      if (!isValidIsbn10(isbn) && !isValidIsbn13(isbn)) {
        return response.status(400).json({ error: "A valid ISBN is required to save a provider cover." });
      }
      const coverUrl = String(request.body?.coverUrl || "").trim();
      const cachedCover = await cacheBookCover({
        isbn,
        candidates: [coverUrl],
        directory: coverDirectory,
        force: true,
        providerChoiceIndex: Number.isInteger(request.body?.providerCoverIndex) ? request.body.providerCoverIndex : 0,
      });
      if (!cachedCover) return response.status(400).json({ error: "That provider image could not be saved." });
      return response.json({ coverUrl: cachedCover });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/covers/upload", express.raw({ type: "image/jpeg", limit: "8mb" }), async (request, response, next) => {
    try {
      const coverUrl = await saveUploadedCover({ bytes: request.body, directory: coverDirectory });
      if (!coverUrl) return response.status(400).json({ error: "Upload a valid JPEG cover image smaller than 8 MB." });
      return response.status(201).json({ coverUrl });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/covers/preview", async (request, response, next) => {
    try {
      const value = String(request.query.url || "");
      if (!value || value.length > 4096) return response.status(400).send("Invalid cover URL");
      const cover = await loadProviderCover({ value });
      if (!cover) return response.status(404).send("Cover unavailable");
      response.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      response.type(cover.contentType);
      return response.send(cover.bytes);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/covers/:filename", async (request, response, next) => {
    try {
      let state = coverCacheState(coverDirectory, request.params.filename);
      if (!state) return response.status(404).send("Cover not found");
      if (state.provider === "amazon" && state.expired) {
        const metadata = normalizeLookupResult(await performLookup(state.isbn));
        const amazon = metadata.providers.find((provider) => provider.id.startsWith("amazon") && provider.available)?.book;
        const candidates = amazon?.coverCandidates || [];
        const candidate = candidates[state.choiceIndex] || candidates[0];
        if (!candidate) return response.status(503).send("Amazon cover refresh unavailable");
        const refreshed = await cacheBookCover({
          isbn: state.isbn,
          candidates: [candidate],
          directory: coverDirectory,
          force: true,
          providerChoiceIndex: state.choiceIndex,
        });
        if (!refreshed) return response.status(503).send("Amazon cover refresh unavailable");
        state = coverCacheState(coverDirectory, path.basename(refreshed));
        if (!state) return response.status(503).send("Amazon cover refresh unavailable");
      }
      response.set("Cache-Control", state.provider === "amazon"
        ? `public, max-age=${state.maxAge}, must-revalidate`
        : "public, max-age=31536000, immutable");
      return response.sendFile(state.filePath);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/stats", async (_request, response, next) => {
    try {
      response.json(await libraryStats(database));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections", (_request, response, next) => {
    try {
      response.json({ collections: listCollections(database) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/export", async (_request, response, next) => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      response.attachment(`bookshelf-backup-${date}.json`);
      response.json({ version: 1, exportedAt: new Date().toISOString(), books: await exportBooks(database) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/export/excel", async (_request, response, next) => {
    try {
      const exportedAt = new Date();
      const books = exportBooks(database);
      const workbook = createBookshelfWorkbook(books, { appName: currentConfig().appName, exportedAt });
      const bytes = await workbook.xlsx.writeBuffer();
      const date = exportedAt.toISOString().slice(0, 10);
      response.set("Cache-Control", "no-store");
      response.attachment(`bookshelf-library-${date}.xlsx`);
      response.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      response.send(Buffer.from(bytes));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/export/database", (_request, response, next) => {
    try {
      if (!databasePath || !fs.existsSync(databasePath)) {
        return response.status(503).json({ error: "A full database download is only available from a file-backed bookshelf." });
      }
      database.exec("PRAGMA wal_checkpoint(FULL)");
      const date = new Date().toISOString().slice(0, 10);
      response.set("Cache-Control", "no-store");
      return response.download(databasePath, `bookshelf-database-${date}.sqlite`, (error) => {
        if (error && !response.headersSent) next(error);
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/manifest.webmanifest", (_request, response) => {
    const identity = currentConfig();
    response.set("Cache-Control", "no-store");
    response.type("application/manifest+json").json({
      name: identity.appName,
      short_name: identity.appName,
      description: "A private, self-hosted home library.",
      start_url: "/",
      display: "standalone",
      background_color: "#f5f0e6",
      theme_color: "#315c49",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    });
  });

  app.use("/vendor/html5-qrcode", express.static(path.join(ROOT, "node_modules", "html5-qrcode"), { maxAge: "1y", immutable: true }));
  app.use(
    express.static(path.join(ROOT, "public"), {
      etag: true,
      maxAge: 0,
      setHeaders(response, filePath) {
        response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-store" : "no-cache");
      },
    }),
  );
  app.get(/^\/.*\.(?:css|js|svg|png|webmanifest)$/i, (_request, response) => response.status(404).send("Asset not found"));
  app.get("/{*path}", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.sendFile(path.join(ROOT, "public", "index.html"));
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof ValidationError) return response.status(error.status).json({ error: error.message });
    if (error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: books\.isbn_/.test(error.message)) {
      return response.status(409).json({ error: "That ISBN is already in your bookshelf." });
    }
    console.error(error);
    return response.status(error.status || 500).json({ error: "Something went wrong on the bookshelf server." });
  });

  return app;
}
