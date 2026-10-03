import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { initializeDatabase } from "./repository.js";
import { terminateIsbnOcr } from "./ocr.js";

const config = {
  port: Number(process.env.PORT || 3000),
  trustProxy: process.env.TRUST_PROXY === "1",
  databasePath: process.env.DB_PATH || path.resolve("data", "bookshelf.sqlite"),
};

config.coverDirectory = process.env.COVER_PATH || path.join(path.dirname(config.databasePath), "covers");

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const database = new DatabaseSync(config.databasePath, { timeout: 5000 });
initializeDatabase(database);

const app = createApp({
  database,
  trustProxy: config.trustProxy,
  coverDirectory: config.coverDirectory,
  databasePath: config.databasePath,
});
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`UP Bookshelf is listening on port ${config.port}.`);
  console.log(`SQLite database: ${config.databasePath}`);
  console.log(`Cover cache: ${config.coverDirectory}`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing the bookshelf.`);
  terminateIsbnOcr().catch(() => {});
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
