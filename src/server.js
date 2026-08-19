import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { initializeDatabase } from "./repository.js";

const config = {
  port: Number(process.env.PORT || 3000),
  appPassword: process.env.APP_PASSWORD || "",
  trustProxy: process.env.TRUST_PROXY === "1",
  databasePath: process.env.DB_PATH || path.resolve("data", "bookshelf.sqlite"),
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const database = new DatabaseSync(config.databasePath, { timeout: 5000 });
initializeDatabase(database);

const app = createApp({ database, appPassword: config.appPassword, trustProxy: config.trustProxy });
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`JnC Bookshelf is listening on port ${config.port}.`);
  console.log(`SQLite database: ${config.databasePath}`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing the bookshelf.`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
