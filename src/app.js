import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "./isbn.js";
import { lookupBookByIsbn } from "./metadata.js";
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

function secureCompare(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function optionalBasicAuth(password) {
  return (request, response, next) => {
    if (!password || request.path === "/api/health") return next();
    const [scheme, token] = (request.headers.authorization || "").split(" ");
    if (scheme === "Basic" && token) {
      try {
        const [username, suppliedPassword] = Buffer.from(token, "base64").toString().split(":");
        if (username === "bookshelf" && secureCompare(suppliedPassword || "", password)) return next();
      } catch {
        // Fall through to the authentication prompt.
      }
    }
    response.set("WWW-Authenticate", 'Basic realm="Hearthside Bookshelf", charset="UTF-8"');
    return response.status(401).send("Authentication required");
  };
}

function numericId(request, response, next) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid book id." });
  request.bookId = id;
  return next();
}

export function createApp({ pool, lookup = lookupBookByIsbn, appPassword = "", trustProxy = false }) {
  const app = express();
  if (trustProxy) app.set("trust proxy", 1);

  app.disable("x-powered-by");
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
        },
      },
    }),
  );
  app.use(optionalBasicAuth(appPassword));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/books", async (request, response, next) => {
    try {
      response.json(
        await listBooks(pool, {
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
      const book = await getBook(pool, request.bookId);
      if (!book) return response.status(404).json({ error: "Book not found." });
      return response.json(book);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/books", async (request, response, next) => {
    try {
      const book = await createBook(pool, validateBook(request.body));
      response.status(201).json(book);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/books/:id", numericId, async (request, response, next) => {
    try {
      const book = await updateBook(pool, request.bookId, validateBook(request.body));
      if (!book) return response.status(404).json({ error: "Book not found." });
      return response.json(book);
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/books/:id", numericId, async (request, response, next) => {
    try {
      if (!(await deleteBook(pool, request.bookId))) return response.status(404).json({ error: "Book not found." });
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
      const existing = await findByIsbn(pool, isbn);
      if (existing) return response.json({ existing, book: null });
      const book = await lookup(isbn);
      if (!book) return response.status(404).json({ error: "No book metadata was found. You can still add it manually.", isbn });
      return response.json({ existing: null, book });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/stats", async (_request, response, next) => {
    try {
      response.json(await libraryStats(pool));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/export", async (_request, response, next) => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      response.attachment(`bookshelf-backup-${date}.json`);
      response.json({ version: 1, exportedAt: new Date().toISOString(), books: await exportBooks(pool) });
    } catch (error) {
      next(error);
    }
  });

  app.use("/vendor/html5-qrcode", express.static(path.join(ROOT, "node_modules", "html5-qrcode"), { maxAge: "1y" }));
  app.use(express.static(path.join(ROOT, "public"), { maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(ROOT, "public", "index.html")));

  app.use((error, _request, response, _next) => {
    if (error instanceof ValidationError) return response.status(error.status).json({ error: error.message });
    if (error?.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ error: "That ISBN is already in your bookshelf." });
    }
    console.error(error);
    return response.status(error.status || 500).json({ error: "Something went wrong on the bookshelf server." });
  });

  return app;
}
