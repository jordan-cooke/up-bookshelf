import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "./isbn.js";
import { lookupBookMetadata } from "./metadata.js";
import { cacheBookCover, coverCacheState } from "./covers.js";
import {
  createBook,
  deleteBook,
  exportBooks,
  findByIsbn,
  getAppSettings,
  getBook,
  libraryStats,
  listBooks,
  saveAppSettings,
  updateBook,
} from "./repository.js";
import { validateBook, ValidationError } from "./validation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_VERSION = "2.0.0";
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

function configuredProviders() {
  return {
    google: Boolean(String(process.env.GOOGLE_BOOKS_API_KEY || "").trim()),
    openlibrary: true,
    amazon: Boolean(
      String(process.env.AMAZON_CREATORS_CLIENT_ID || "").trim()
      && String(process.env.AMAZON_CREATORS_CLIENT_SECRET || "").trim()
      && String(process.env.AMAZON_ASSOCIATE_TAG || "").trim(),
    ),
  };
}

export function createApp({ database, lookup = lookupBookMetadata, trustProxy = false, coverDirectory = null, bookshelfName = "" }) {
  const app = express();
  const defaultIdentity = bookshelfIdentity(bookshelfName);
  const currentConfig = () => {
    const saved = getAppSettings(database);
    const identity = bookshelfIdentity(saved.name || defaultIdentity.brandName);
    return {
      ...identity,
      customName: saved.name || "",
      tagline: Object.hasOwn(saved, "tagline") ? saved.tagline : DEFAULT_TAGLINE,
      defaultAppName: "UP Bookshelf",
      providers: configuredProviders(),
    };
  };
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
      if (name.length > 40) return response.status(400).json({ error: "The bookshelf name must be 40 characters or fewer." });
      if (tagline.length > 240) return response.status(400).json({ error: "The welcome message must be 240 characters or fewer." });
      saveAppSettings(database, { name, tagline });
      return response.json(currentConfig());
    } catch (error) {
      return next(error);
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
      const metadata = normalizeLookupResult(await lookup(isbn));
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
      const metadata = normalizeLookupResult(await lookup(isbn));
      if (!metadata.book) return response.status(404).json({ error: "No provider has metadata for this ISBN.", isbn });
      return response.json(metadata);
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

  app.get("/api/covers/:filename", async (request, response, next) => {
    try {
      let state = coverCacheState(coverDirectory, request.params.filename);
      if (!state) return response.status(404).send("Cover not found");
      if (state.provider === "amazon" && state.expired) {
        const metadata = normalizeLookupResult(await lookup(state.isbn));
        const amazon = metadata.providers.find((provider) => provider.id === "amazon" && provider.available)?.book;
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

  app.get("/api/export", async (_request, response, next) => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      response.attachment(`bookshelf-backup-${date}.json`);
      response.json({ version: 1, exportedAt: new Date().toISOString(), books: await exportBooks(database) });
    } catch (error) {
      next(error);
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
