import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "./isbn.js";
import { lookupBookByIsbn } from "./metadata.js";
import { cacheBookCover, resolveCoverFile } from "./covers.js";
import {
  createBook,
  deleteBook,
  exportBooks,
  findByIsbn,
  getBook,
  libraryStats,
  listBooks,
  updateBook,
} from "./repository.js";
import { validateBook, ValidationError } from "./validation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_VERSION = "1.4.1";
const REQUIRED_ASSETS = ["index.html", "styles.css", "app.js", "icon.svg", "manifest.webmanifest"];

function numericId(request, response, next) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid book id." });
  request.bookId = id;
  return next();
}

export function createApp({ database, lookup = lookupBookByIsbn, trustProxy = false, coverDirectory = null }) {
  const app = express();
  if (trustProxy) app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set("X-JnC-Bookshelf-Version", APP_VERSION);
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
      response.json({ status: "ok", app: "JnC Bookshelf", version: APP_VERSION, storage: "sqlite", authentication: false });
    } catch (error) {
      next(error);
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
      const book = await lookup(isbn);
      if (!book) return response.status(404).json({ error: "No book metadata was found. You can still add it manually.", isbn });
      const coverCandidates = book.coverCandidates?.length ? book.coverCandidates : [book.coverUrl].filter(Boolean);
      const cachedCover = await cacheBookCover({ isbn, candidates: coverCandidates, directory: coverDirectory });
      delete book.coverCandidates;
      delete book.preferredCoverCandidates;
      if (cachedCover) book.coverUrl = cachedCover;
      return response.json({ existing: null, book });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/covers/:filename", async (request, response, next) => {
    try {
      const filePath = resolveCoverFile(coverDirectory, request.params.filename);
      if (!filePath) return response.status(404).send("Cover not found");
      response.set("Cache-Control", "public, max-age=31536000, immutable");
      return response.sendFile(filePath);
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
